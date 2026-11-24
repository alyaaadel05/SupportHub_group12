"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const PORT = Number(process.env.FRONTEND_PORT || 8080);

// Backend URLs come from the environment so no machine-specific address
// (for example a teammate's temporary Tailscale IP) is hard-coded.
// Defaults match the team's existing local ports (identity 3006, article
// 3005, editorial 3007 in Docker; search 3004 run with node).
const targets = {
  identity: process.env.IDENTITY_URL || "http://127.0.0.1:3006",
  article: process.env.ARTICLE_URL || "http://127.0.0.1:3005",
  editorial: process.env.EDITORIAL_URL || "http://127.0.0.1:3007",
  search: process.env.SEARCH_URL || "http://127.0.0.1:3004"
};

// Same routing table as functions/api/[[path]].js (Cloudflare Pages).
function chooseTarget(pathname, method = "GET") {
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) {
    return { target: targets.identity };
  }

  if (
    pathname === "/api/csrf-token" ||
    pathname === "/api/reviews" ||
    pathname.startsWith("/api/reviews/") ||
    pathname.startsWith("/api/editorial/") ||
    /^\/api\/flags\/\d+$/.test(pathname) ||
    /^\/api\/review-operations\//.test(pathname) ||
    (method === "POST" && /^\/api\/articles\/\d+\/(reviews|submissions|flags)$/.test(pathname)) ||
    (method === "PATCH" && /^\/api\/articles\/\d+\/publication$/.test(pathname)) ||
    (method === "GET" && /^\/api\/articles\/\d+\/history$/.test(pathname))
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
  const route = chooseTarget(pathname, req.method);

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

// Apply the same static-page headers as Cloudflare Pages (_headers, "/*" block)
// so the Content-Security-Policy is exercised during local testing too.
function loadPagesHeaders() {
  try {
    const lines = fs.readFileSync(path.join(ROOT, "_headers"), "utf8").split(/\r?\n/);
    const headers = {};
    let inAll = false;
    for (const line of lines) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      if (!/^\s/.test(line)) { inAll = line.trim() === "/*"; continue; }
      if (inAll) {
        const index = line.indexOf(":");
        if (index > 0) headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
      }
    }
    return headers;
  } catch {
    return {};
  }
}

const pagesHeaders = loadPagesHeaders();

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
      ...pagesHeaders,
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