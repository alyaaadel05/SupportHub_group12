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

function limiterBlock(name) {
  const match = serverSource.match(
    new RegExp(`const ${name} = rateLimit\\(\\{([\\s\\S]*?)\\}\\);`)
  );
  assert.ok(match, `${name} not found`);
  return match[1];
}

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

test("login/registration limiter stays fixed at 30 and is not configurable", () => {
  const block = limiterBlock("sensitiveAuthLimiter");
  assert.equal((block.match(/limit:/g) || []).length, 1);
  assert.match(block, /limit: 30,/);
  assert.doesNotMatch(block, /resolveRateLimitMax|process\.env/);
  assert.match(block, /windowMs: 15 \* 60 \* 1000/);
});

test("session limiter uses the helper and there are exactly two limiters", () => {
  const block = limiterBlock("sessionLimiter");
  assert.equal((block.match(/limit:/g) || []).length, 1);
  assert.match(block, /limit: generalLimit\(\)/);
  assert.equal((serverSource.match(/rateLimit\(/g) || []).length, 2);
  assert.match(serverSource, /"\/api\/auth\/login",\s*sensitiveAuthLimiter/);
  assert.match(serverSource, /"\/api\/auth\/register",\s*sensitiveAuthLimiter/);
});
