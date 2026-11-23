"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  DEFAULT_RATE_LIMIT_MAX,
  resolveRateLimitMax
} = require("../config/rateLimit");

const serverSource = fs.readFileSync(
  path.join(__dirname, "../server.js"),
  "utf8"
);

test("production default stays 300 requests per 15 minutes", () => {
  assert.equal(DEFAULT_RATE_LIMIT_MAX, 300);
  assert.equal(resolveRateLimitMax(undefined), 300);
});

test("a valid RATE_LIMIT_MAX is used for local load testing", () => {
  assert.equal(resolveRateLimitMax("5000"), 5000);
  assert.equal(resolveRateLimitMax(" 1200 "), 1200);
});

test("invalid values fall back to 300 and never disable limiting", () => {
  for (const value of ["", "   ", "0", "-5", "1.5", "abc", "NaN", "Infinity", null]) {
    assert.equal(resolveRateLimitMax(value), 300, `value: ${value}`);
  }
});

test("server.js has exactly one general /api limiter using the helper", () => {
  assert.equal((serverSource.match(/rateLimit\(/g) || []).length, 1);
  assert.match(serverSource, /limit: resolveRateLimitMax\(\)/);
  assert.doesNotMatch(serverSource, /limit:\s*300\b/);
  assert.match(serverSource, /windowMs: 15 \* 60 \* 1000/);
});
