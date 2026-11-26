// TEST-ONLY stand-in for Cloudflare Tunnel + Cloudflare Access in the isolated
// stack. Forwards to Floci ONLY when the Access service-token headers match
// (constant-time compare), strips them, and answers 403 otherwise - like an
// Access application with a Service Auth policy. Never used in production;
// production uses the real Cloudflare edge (see infra/floci/remote/README.md).
"use strict";
const http = require("node:http");
const crypto = require("node:crypto");

const UPSTREAM = new URL(process.env.UPSTREAM || "http://floci:4566");
const ID = process.env.EXPECT_ID || "";
const SECRET = process.env.EXPECT_SECRET || "";
if (ID.length < 16 || SECRET.length < 32) throw new Error("EXPECT_ID/EXPECT_SECRET too short");

const same = (a, b) => {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

http.createServer((req, res) => {
  if (!same(req.headers["cf-access-client-id"], ID) || !same(req.headers["cf-access-client-secret"], SECRET)) {
    console.log(`DENY ${req.method} ${req.url.split("?")[0]}`);
    res.writeHead(403, { "content-type": "text/plain" });
    return res.end("Forbidden (Access service token required)");
  }
  const headers = { ...req.headers };
  delete headers["cf-access-client-id"];
  delete headers["cf-access-client-secret"];
  const up = http.request({ hostname: UPSTREAM.hostname, port: UPSTREAM.port, method: req.method, path: req.url, headers }, r => {
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
  });
  up.on("error", () => { res.writeHead(502); res.end("upstream error"); });
  console.log(`ALLOW ${req.method} ${req.url.split("?")[0]}`);
  req.pipe(up);
}).listen(8080, () => console.log("access gate listening on 8080 ->", UPSTREAM.origin));
