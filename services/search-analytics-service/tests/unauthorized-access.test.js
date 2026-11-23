const test = require("node:test");
const assert = require("node:assert/strict");
const {
  requireLogin, requireReviewer, requireBrowserWrite,
  makeSignature, requireEditorialSignature
} = require("../middleware/security");

// Small fake request/response helpers (no server or database needed).
function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; }
  };
}
function fakeReq({ user, headers = {}, csrfToken } = {}) {
  return {
    session: { user, csrfToken },
    get(name) { return headers[name.toLowerCase()]; },
    method: "POST", originalUrl: "/internal/publications", rawBody: ""
  };
}
function run(middleware, req) {
  const res = fakeRes();
  let passed = false;
  middleware(req, res, () => { passed = true; });
  return { res, passed };
}

test("vote/feedback without login is rejected with 401", () => {
  const { res, passed } = run(requireLogin, fakeReq());
  assert.equal(passed, false);
  assert.equal(res.statusCode, 401);
});

test("logged-in user passes the login check", () => {
  const { passed } = run(requireLogin, fakeReq({ user: { id: 7, role: "reader" } }));
  assert.equal(passed, true);
});

test("analytics without login is rejected with 401", () => {
  const { res, passed } = run(requireReviewer, fakeReq());
  assert.equal(passed, false);
  assert.equal(res.statusCode, 401);
});

test("reader cannot open analytics (403)", () => {
  const { res, passed } = run(requireReviewer, fakeReq({ user: { id: 7, role: "reader" } }));
  assert.equal(passed, false);
  assert.equal(res.statusCode, 403);
});

test("author cannot open analytics (403)", () => {
  const { res, passed } = run(requireReviewer, fakeReq({ user: { id: 8, role: "author" } }));
  assert.equal(passed, false);
  assert.equal(res.statusCode, 403);
});

test("reviewer can open analytics", () => {
  const { passed } = run(requireReviewer, fakeReq({ user: { id: 9, role: "reviewer" } }));
  assert.equal(passed, true);
});

test("editor can open analytics", () => {
  const { passed } = run(requireReviewer, fakeReq({ user: { id: 10, role: "editor" } }));
  assert.equal(passed, true);
});

test("admin can open analytics", () => {
  const { passed } = run(requireReviewer, fakeReq({ user: { id: 11, role: "admin" } }));
  assert.equal(passed, true);
});

test("write request from another website is rejected (403)", () => {
  process.env.FRONTEND_ORIGIN = "http://localhost:8788";
  const req = fakeReq({ csrfToken: "abc", headers: { origin: "http://evil.example", "x-csrf-token": "abc" } });
  const { res, passed } = run(requireBrowserWrite, req);
  assert.equal(passed, false);
  assert.equal(res.statusCode, 403);
});

test("write request without CSRF token is rejected (403)", () => {
  process.env.FRONTEND_ORIGIN = "http://localhost:8788";
  const req = fakeReq({ csrfToken: "abc", headers: { origin: "http://localhost:8788" } });
  const { res, passed } = run(requireBrowserWrite, req);
  assert.equal(passed, false);
  assert.equal(res.statusCode, 403);
});

test("write request with wrong CSRF token is rejected (403)", () => {
  process.env.FRONTEND_ORIGIN = "http://localhost:8788";
  const req = fakeReq({ csrfToken: "abc", headers: { origin: "http://localhost:8788", "x-csrf-token": "xyz" } });
  const { res, passed } = run(requireBrowserWrite, req);
  assert.equal(passed, false);
  assert.equal(res.statusCode, 403);
});

test("write request with correct origin and CSRF token passes", () => {
  process.env.FRONTEND_ORIGIN = "http://localhost:8788";
  const req = fakeReq({ csrfToken: "abc", headers: { origin: "http://localhost:8788", "x-csrf-token": "abc" } });
  const { passed } = run(requireBrowserWrite, req);
  assert.equal(passed, true);
});

test("internal request from an unknown service is rejected (401)", () => {
  const secret = "s".repeat(64);
  process.env.SERVICE_SHARED_SECRET = secret;
  const ts = String(Date.now());
  const req = fakeReq({ headers: {
    "x-service-name": "unknown-service", "x-service-timestamp": ts,
    "x-service-signature": makeSignature(secret, "unknown-service", ts, "POST", "/internal/publications")
  } });
  const { res, passed } = run(requireEditorialSignature, req);
  assert.equal(passed, false);
  assert.equal(res.statusCode, 401);
});

test("internal request with a forged signature is rejected (401)", () => {
  process.env.SERVICE_SHARED_SECRET = "s".repeat(64);
  const ts = String(Date.now());
  const req = fakeReq({ headers: {
    "x-service-name": "editorial-service", "x-service-timestamp": ts,
    "x-service-signature": makeSignature("w".repeat(64), "editorial-service", ts, "POST", "/internal/publications")
  } });
  const { res, passed } = run(requireEditorialSignature, req);
  assert.equal(passed, false);
  assert.equal(res.statusCode, 401);
});

test("old (replayed) internal request is rejected (401)", () => {
  const secret = "s".repeat(64);
  process.env.SERVICE_SHARED_SECRET = secret;
  const old = String(Date.now() - 10 * 60 * 1000);
  const req = fakeReq({ headers: {
    "x-service-name": "editorial-service", "x-service-timestamp": old,
    "x-service-signature": makeSignature(secret, "editorial-service", old, "POST", "/internal/publications")
  } });
  const { res, passed } = run(requireEditorialSignature, req);
  assert.equal(passed, false);
  assert.equal(res.statusCode, 401);
});