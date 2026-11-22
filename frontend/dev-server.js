"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const PORT = 8080;

const targets = {
  identity: "http://127.0.0.1:3006",
  article: "http://127.0.0.1:3005",
  editorial: "http://100.69.198.126:3002",
  search: "http://100.69.7.28:3004"
};

function chooseTarget(pathname) {
  if (pathname === "/api/csrf-token") {
    return {
      target: targets.identity,
      path: "/api/auth/csrf"
    };
  }

  if (pathname.startsWith("/api/auth/")) {
    return { target: targets.identity };
  }

  if (
    pathname === "/api/reviews" ||
    pathname.startsWith("/api/reviews/") ||
    pathname.startsWith("/api/editorial/") ||
    /^\/api\/articles\/\d+\/(reviews|submissions)$/.test(pathname)
  ) {
    return { target: targets.editorial };
  }

  if (
    pathname.startsWith("/api/analytics") ||
    pathname.startsWith("/api/public") ||
    /^\/api\/articles\/\d+\/(votes|feedback|view)$/.test(pathname)
  ) {
    return { target: targets.search };
  }

  return { target: targets.article };
}

function proxyRequest(req, res, pathname, search) {
  const route = chooseTarget(pathname);

  const upstream = new URL(route.target);
  const requestPath = (route.path || pathname) + search;

  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;

  const upstreamRequest = http.request({
    hostname: upstream.hostname,
    port: upstream.port,
    method: req.method,
    path: requestPath,
    headers,
    timeout: 10000
  }, upstreamResponse => {
    res.writeHead(
      upstreamResponse.statusCode || 502,
      upstreamResponse.headers
    );
    upstreamResponse.pipe(res);
  });

  upstreamRequest.on("timeout", () => {
    upstreamRequest.destroy(new Error("Backend timeout"));
  });

  upstreamRequest.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, {
        "Content-Type": "application/json"
      });
      res.end(JSON.stringify({
        error: "Backend unavailable"
      }));
    } else {
      res.destroy();
    }
  });

  req.pipe(upstreamRequest);
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const server = http.createServer((req, res) => {
  let url;

  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }

  if (url.pathname === "/api" ||
      url.pathname.startsWith("/api/")) {
    proxyRequest(req, res, url.pathname, url.search);
    return;
  }

  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  let requestedPath;

  try {
    requestedPath = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    res.end("Invalid path");
    return;
  }

  const absolutePath = path.resolve(
    ROOT,
    "." + (requestedPath === "/" ? "/index.html" : requestedPath)
  );

  if (
    absolutePath !== ROOT &&
    !absolutePath.startsWith(ROOT + path.sep)
  ) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(absolutePath, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type":
        mimeTypes[path.extname(absolutePath).toLowerCase()] ||
        "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    fs.createReadStream(absolutePath).pipe(res);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `SupportHub Development proxy running on port ${PORT}`
  );
});