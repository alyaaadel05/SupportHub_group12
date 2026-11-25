"use strict";

// FRONTEND_ORIGIN allow-list for browser writes (Search & Analytics).
// Same rule as the Editorial service (votes, feedback, analytics exports).


const test = require("node:test");
const assert = require("node:assert/strict");
const { allowedOrigins, isAllowedOrigin, requireBrowserWrite } = require("../middleware/security");

const LIST = "http://localhost:8080, http://127.0.0.1:8080,https://supporthub-group12.pages.dev";
const TOKEN = "a".repeat(64);

function run(origin, { token = TOKEN, list = LIST } = {}) {
  const previous = process.env.FRONTEND_ORIGIN;
  process.env.FRONTEND_ORIGIN = list;
  const req = {
    method: "POST",
    session: { csrfToken: TOKEN },
    get: name => ({ origin, "x-csrf-token": token })[name.toLowerCase()]
  };
  const result = { status: 200, next: false };
  const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
  try {
    requireBrowserWrite(req, res, () => { result.next = true; });
  } finally {
    process.env.FRONTEND_ORIGIN = previous;
  }
  return result;
}

test("parses a comma-separated list and trims spaces", () => {
  assert.deepEqual(allowedOrigins(LIST), [
    "http://localhost:8080", "http://127.0.0.1:8080", "https://supporthub-group12.pages.dev"
  ]);
});

test("every listed origin may write (with a valid CSRF token)", () => {
  for (const origin of allowedOrigins(LIST)) assert.equal(run(origin).next, true, origin);
});

test("a single origin still works exactly as before", () => {
  assert.equal(run("http://localhost:8080", { list: "http://localhost:8080" }).next, true);
});

test("unlisted, look-alike and missing origins are rejected with 403", () => {
  for (const origin of [
    "https://evil.example", "http://localhost:8081", "http://localhost:8080.evil.example",
    "http://localhost", "HTTP://LOCALHOST:8080", "null", "", undefined,
    "http://localhost:8080, http://127.0.0.1:8080"
  ]) {
    const result = run(origin);
    assert.equal(result.status, 403, String(origin));
    assert.equal(result.next, false, String(origin));
  }
});

test("an allowed origin without a valid CSRF token is still rejected", () => {
  const result = run("http://127.0.0.1:8080", { token: "b".repeat(64) });
  assert.equal(result.status, 403);
  assert.equal(result.status, 403);
});

test("an empty FRONTEND_ORIGIN allows nothing", () => {
  assert.equal(isAllowedOrigin("http://localhost:8080", ""), false);
  assert.equal(run("http://localhost:8080", { list: "" }).status, 403);
});
