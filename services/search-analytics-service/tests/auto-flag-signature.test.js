// The signed request to Editorial: exact URL, headers, body and a signature over that body.
// fetch is replaced by a fake, so nothing is sent over the network.
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeSignature } = require("../middleware/security");
const { requestAutoFlag } = require("../services/serviceClient");

const secret = "s".repeat(64);

test("request is POST /internal/auto-flags, signed over the exact body", async () => {
  process.env.SERVICE_SHARED_SECRET = secret;
  process.env.EDITORIAL_SERVICE_URL = "http://editorial:3002";
  const originalFetch = global.fetch;
  let seen;
  global.fetch = async (url, options) => { seen = { url: String(url), options }; return { status: 201 }; };
  try {
    const status = await requestAutoFlag(12, 6, 8);
    assert.equal(status, 201);
    assert.equal(seen.url, "http://editorial:3002/internal/auto-flags");
    assert.equal(seen.options.method, "POST");
    assert.equal(seen.options.body, '{"articleId":12,"unhelpfulVotes":6,"totalVotes":8}');
    const h = seen.options.headers;
    assert.equal(h["x-service-name"], "search-analytics-service");
    assert.match(h["x-service-timestamp"], /^\d{13}$/);
    assert.equal(h["x-service-signature"],
      makeSignature(secret, "search-analytics-service", h["x-service-timestamp"], "POST", "/internal/auto-flags", seen.options.body));
  } finally { global.fetch = originalFetch; }
});

test("missing Editorial URL is refused before any request (503)", async () => {
  process.env.SERVICE_SHARED_SECRET = secret;
  delete process.env.EDITORIAL_SERVICE_URL;
  await assert.rejects(requestAutoFlag(12, 6, 8), err => err.status === 503);
});

test("Editorial unreachable becomes a 502 error (caught by the vote)", async () => {
  process.env.SERVICE_SHARED_SECRET = secret;
  process.env.EDITORIAL_SERVICE_URL = "http://editorial:3002";
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("connect ECONNREFUSED"); };
  try { await assert.rejects(requestAutoFlag(12, 6, 8), err => err.status === 502); }
  finally { global.fetch = originalFetch; }
});