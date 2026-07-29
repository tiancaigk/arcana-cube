#!/usr/bin/env node

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { Readable } = require("node:stream");
const { URL } = require("node:url");
const { createMtgjsonHistoryService } = require("./mtgjson-history-service.js");

const rootDir = path.resolve(__dirname, "..");

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"]
]);

function readArg(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : "";
}

function readServerOptions(argv = process.argv.slice(2), env = process.env) {
  const host = String(readArg(argv, "--host") || env.HOST || "127.0.0.1").trim();
  const rawPort = env.PORT || readArg(argv, "--port") || "4173";
  const port = Number(rawPort);
  if (!host) throw new Error("服务器地址不能为空");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("服务器端口必须是 1 到 65535 的整数");
  return { host, port };
}

function send(res, status, headers = {}, body = "") {
  res.writeHead(status, headers);
  res.end(body);
}

function historyCorsHeaders(req) {
  const origin = String(req.headers.origin || "");
  if (!origin) return {};
  const host = String(req.headers.host || "").toLowerCase();
  let isSameOrigin = false;
  try {
    const parsedOrigin = new URL(origin);
    isSameOrigin = parsedOrigin.protocol === "http:" && parsedOrigin.host.toLowerCase() === host;
  } catch (_error) {
    // Keep malformed origins outside the allowlist.
  }
  if (origin === "null" || isSameOrigin || /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin)) {
    return { "Access-Control-Allow-Origin": origin, "Vary": "Origin" };
  }
  return null;
}

function readJsonBody(req, maxBytes = 128 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        reject(new Error("请求内容过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      try {
        settled = true;
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (_error) {
        settled = true;
        reject(new Error("请求 JSON 格式无效"));
      }
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

async function serveMtgjsonHistory(req, res, historyService) {
  const cors = historyCorsHeaders(req);
  if (!cors) {
    send(res, 403, { "Content-Type": "application/json; charset=utf-8" }, JSON.stringify({ error: "Origin not allowed" }));
    return;
  }
  if (req.method === "OPTIONS") {
    send(res, 204, {
      ...cors,
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Max-Age": "600"
    });
    return;
  }
  if (req.method !== "POST") {
    send(res, 405, { ...cors, "Allow": "POST, OPTIONS", "Content-Type": "application/json; charset=utf-8" }, JSON.stringify({ error: "Method Not Allowed" }));
    return;
  }
  try {
    const payload = await readJsonBody(req);
    const result = await historyService.getHistory(payload.scryfallIds);
    send(res, 200, {
      ...cors,
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    }, JSON.stringify(result));
  } catch (error) {
    send(res, 400, {
      ...cors,
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    }, JSON.stringify({ error: error.message || "MTGJSON 历史补全失败" }));
  }
}

function getStaticFilePath(pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch (error) {
    return null;
  }
  const normalizedPath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const requestedPath = normalizedPath === "/" ? "index.html" : normalizedPath.replace(/^[/\\]+/, "");
  const filePath = path.join(rootDir, requestedPath);
  return filePath.startsWith(rootDir + path.sep) || filePath === rootDir ? filePath : null;
}

async function proxyImage(req, res, requestUrl) {
  const rawUrl = requestUrl.searchParams.get("url") || "";
  let targetUrl;
  try {
    targetUrl = new URL(rawUrl);
  } catch (error) {
    send(res, 400, { "Content-Type": "text/plain; charset=utf-8" }, "Invalid image URL");
    return;
  }

  if (targetUrl.protocol !== "https:" || targetUrl.hostname !== "cards.scryfall.io") {
    send(res, 403, { "Content-Type": "text/plain; charset=utf-8" }, "Only Scryfall card images can be proxied");
    return;
  }

  const upstream = await fetch(targetUrl, {
    headers: {
      "User-Agent": "ArcanaCubeLocalServer/1.0"
    }
  });

  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  if (!upstream.ok) {
    send(res, upstream.status, { "Content-Type": "text/plain; charset=utf-8" }, `Image fetch failed: HTTP ${upstream.status}`);
    return;
  }

  const headers = {
    "Cache-Control": "public, max-age=86400",
    "Content-Type": contentType
  };
  if (req.method === "HEAD") {
    send(res, 200, headers);
    return;
  }

  res.writeHead(200, headers);
  if (upstream.body) {
    Readable.fromWeb(upstream.body).pipe(res);
    return;
  }
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

function serveStatic(req, res, requestUrl) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, { "Allow": "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" }, "Method Not Allowed");
    return;
  }

  let filePath = getStaticFilePath(requestUrl.pathname);
  if (!filePath) {
    send(res, 403, { "Content-Type": "text/plain; charset=utf-8" }, "Forbidden");
    return;
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch (error) {
    send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not Found");
    return;
  }

  const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

function createLocalServer(options = {}) {
  const host = options.host || "127.0.0.1";
  const port = options.port || 4173;
  const historyService = options.historyService || createMtgjsonHistoryService({ rootDir });
  return http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
      if (requestUrl.pathname === "/image-proxy") {
        if (req.method !== "GET" && req.method !== "HEAD") {
          send(res, 405, { "Allow": "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" }, "Method Not Allowed");
          return;
        }
        await proxyImage(req, res, requestUrl);
        return;
      }
      if (requestUrl.pathname === "/mtgjson-price-history") {
        await serveMtgjsonHistory(req, res, historyService);
        return;
      }
      serveStatic(req, res, requestUrl);
    } catch (error) {
      console.error(error);
      send(res, 500, { "Content-Type": "text/plain; charset=utf-8" }, error.message || "Server Error");
    }
  });
}

if (require.main === module) {
  const options = readServerOptions();
  const server = createLocalServer(options);
  server.listen(options.port, options.host, () => {
    console.log(`Arcana Cube local server running at http://${options.host}:${options.port}/`);
    console.log(options.host === "127.0.0.1" ? "Use this localhost URL instead of opening index.html directly." : "Devices on the same network can use this computer's LAN IP with the same port.");
  });
}

module.exports = { createLocalServer, historyCorsHeaders, readJsonBody, readServerOptions, serveMtgjsonHistory };
