#!/usr/bin/env node

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { URL } = require("node:url");
const zlib = require("node:zlib");
const { createMtgjsonHistoryService } = require("./mtgjson-history-service.js");
const { createLocalPriceIndexService } = require("./local-price-index-service.js");
const { createLocalProductSourceIndexService } = require("./local-product-source-index-service.js");

const rootDir = path.resolve(__dirname, "..");
const IMAGE_PROXY_TIMEOUT_MS = 30000;

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

function isLoopbackRequest(req) {
  const address = String(req.socket && req.socket.remoteAddress || "");
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function serveLocalIndex(req, res, indexService, messages) {
  const cors = historyCorsHeaders(req);
  if (!cors || !isLoopbackRequest(req)) {
    send(res, 403, { "Content-Type": "application/json; charset=utf-8" }, JSON.stringify({ error: "Local request required" }));
    return;
  }
  if (req.method === "OPTIONS") {
    send(res, 204, {
      ...cors,
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Max-Age": "600"
    });
    return;
  }
  if (req.method !== "GET" && req.method !== "POST") {
    send(res, 405, { ...cors, "Allow": "GET, POST, OPTIONS", "Content-Type": "application/json; charset=utf-8" }, JSON.stringify({ error: "Method Not Allowed" }));
    return;
  }
  try {
    const index = req.method === "POST"
      ? await indexService.update((await readJsonBody(req, 1024 * 1024)).cubeData)
      : await indexService.readIndex();
    send(res, 200, {
      ...cors,
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    }, JSON.stringify(index));
  } catch (error) {
    const missing = req.method === "GET" && error && error.code === "ENOENT";
    send(res, missing ? 404 : 500, {
      ...cors,
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    }, JSON.stringify({ error: missing ? messages.missing : error.message || messages.failed }));
  }
}

function serveLocalPriceIndex(req, res, priceIndexService) {
  return serveLocalIndex(req, res, priceIndexService, {
    missing: "本地价格索引尚未建立",
    failed: "本地价格索引更新失败"
  });
}

function serveLocalProductSourceIndex(req, res, productSourceIndexService) {
  return serveLocalIndex(req, res, productSourceIndexService, {
    missing: "本地产品来源索引尚未建立",
    failed: "本地产品来源索引更新失败"
  });
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_PROXY_TIMEOUT_MS);
  const abortOnDisconnect = () => {
    if (!res.writableEnded) controller.abort();
  };
  const cleanup = () => {
    clearTimeout(timeout);
    res.off("close", abortOnDisconnect);
  };
  res.once("close", abortOnDisconnect);
  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      headers: { "User-Agent": "ArcanaCubeLocalServer/1.0" },
      signal: controller.signal
    });
  } catch (error) {
    cleanup();
    if (!res.headersSent) {
      send(res, error && error.name === "AbortError" ? 504 : 502, { "Content-Type": "text/plain; charset=utf-8" }, "Image fetch failed");
    }
    return;
  }

  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  if (!upstream.ok) {
    if (upstream.body) await upstream.body.cancel().catch(() => {});
    cleanup();
    send(res, upstream.status, { "Content-Type": "text/plain; charset=utf-8" }, `Image fetch failed: HTTP ${upstream.status}`);
    return;
  }
  if (!contentType.toLowerCase().startsWith("image/")) {
    if (upstream.body) await upstream.body.cancel().catch(() => {});
    cleanup();
    send(res, 502, { "Content-Type": "text/plain; charset=utf-8" }, "Image fetch returned invalid content");
    return;
  }

  const headers = {
    "Cache-Control": "public, max-age=86400",
    "Content-Type": contentType
  };
  if (req.method === "HEAD") {
    if (upstream.body) await upstream.body.cancel().catch(() => {});
    cleanup();
    send(res, 200, headers);
    return;
  }

  res.writeHead(200, headers);
  if (upstream.body) {
    try {
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch (error) {
      if (!res.destroyed) res.destroy(error);
    } finally {
      cleanup();
    }
    return;
  }
  try {
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } finally {
    cleanup();
  }
}

async function serveStatic(req, res, requestUrl) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, { "Allow": "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" }, "Method Not Allowed");
    return;
  }

  let filePath = getStaticFilePath(requestUrl.pathname);
  if (!filePath) {
    send(res, 403, { "Content-Type": "text/plain; charset=utf-8" }, "Forbidden");
    return;
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
    stat = fs.statSync(filePath);
  } catch (error) {
    send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not Found");
    return;
  }

  const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
  const extension = path.extname(filePath).toLowerCase();
  const compressible = [".css", ".html", ".js", ".json", ".svg"].includes(extension);
  const useGzip = req.method === "GET" && compressible && stat.size >= 1024 && /(?:^|,)\s*gzip\s*(?:,|$)/i.test(String(req.headers["accept-encoding"] || ""));
  const etag = `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
  const headers = {
    "Cache-Control": [".png", ".jpg", ".jpeg", ".svg", ".webp"].includes(extension) ? "public, max-age=86400" : "no-cache",
    "Content-Type": contentType,
    "ETag": etag,
    "Last-Modified": stat.mtime.toUTCString()
  };
  if (compressible) headers.Vary = "Accept-Encoding";
  if (useGzip) headers["Content-Encoding"] = "gzip";
  if (req.headers["if-none-match"] === etag) {
    send(res, 304, headers);
    return;
  }
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  try {
    if (useGzip) await pipeline(fs.createReadStream(filePath), zlib.createGzip(), res);
    else await pipeline(fs.createReadStream(filePath), res);
  } catch (error) {
    if (!res.headersSent) send(res, 500, { "Content-Type": "text/plain; charset=utf-8" }, "Static file read failed");
    else if (!res.destroyed) res.destroy(error);
  }
}

function createLocalServer(options = {}) {
  const host = options.host || "127.0.0.1";
  const port = options.port || 4173;
  const historyService = options.historyService || createMtgjsonHistoryService({ rootDir });
  const priceIndexService = options.priceIndexService || createLocalPriceIndexService({ rootDir });
  const productSourceIndexService = options.productSourceIndexService || createLocalProductSourceIndexService({ rootDir });
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
      if (requestUrl.pathname === "/mtgjson-price-index/local") {
        await serveLocalPriceIndex(req, res, priceIndexService);
        return;
      }
      if (requestUrl.pathname === "/product-source-index/local") {
        await serveLocalProductSourceIndex(req, res, productSourceIndexService);
        return;
      }
      await serveStatic(req, res, requestUrl);
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

module.exports = { createLocalServer, historyCorsHeaders, isLoopbackRequest, readJsonBody, readServerOptions, serveLocalPriceIndex, serveLocalProductSourceIndex, serveMtgjsonHistory };
