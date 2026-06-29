#!/usr/bin/env node

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { Readable } = require("node:stream");
const { URL } = require("node:url");

const rootDir = path.resolve(__dirname, "..");
const host = "127.0.0.1";
const port = Number(process.env.PORT || readArg("--port") || 4173);

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

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function send(res, status, headers = {}, body = "") {
  res.writeHead(status, headers);
  res.end(body);
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

const server = http.createServer(async (req, res) => {
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
    serveStatic(req, res, requestUrl);
  } catch (error) {
    console.error(error);
    send(res, 500, { "Content-Type": "text/plain; charset=utf-8" }, error.message || "Server Error");
  }
});

server.listen(port, host, () => {
  console.log(`Arcana Cube local server running at http://${host}:${port}/`);
  console.log("Use this localhost URL instead of opening index.html directly.");
});
