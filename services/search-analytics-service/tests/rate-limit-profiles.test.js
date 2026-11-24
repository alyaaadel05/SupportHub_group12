"use strict";

// Production vs load-test rate-limit profiles (config/rateLimitProfiles.js).

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveProfile, limitFor, generalLimit, createLimiter, LOADTEST_LIMIT
} = require("../config/rateLimitProfiles");

test("default profile is production", () => {
  assert.equal(resolveProfile({}), "production");
  assert.equal(limitFor(30, {}), 30);
  assert.equal(generalLimit({}), 300);
});

test("loadtest profile relaxes limits outside production", () => {
  const env = { RATE_LIMIT_PROFILE: "loadtest", NODE_ENV: "development" };
  assert.equal(resolveProfile(env), "loadtest");
  assert.equal(limitFor(30, env), LOADTEST_LIMIT);
  assert.equal(generalLimit(env), 100000);
});

test("loadtest profile is refused when NODE_ENV=production", () => {
  const env = { RATE_LIMIT_PROFILE: "loadtest", NODE_ENV: "production" };
  assert.equal(resolveProfile(env), "production");
  assert.equal(limitFor(30, env), 30);
  assert.equal(generalLimit(env), 300);
});

test("unknown profile names fall back to production", () => {
  assert.equal(resolveProfile({ RATE_LIMIT_PROFILE: "off" }), "production");
  assert.equal(resolveProfile({ RATE_LIMIT_PROFILE: "" }), "production");
});

test("explicit RATE_LIMIT_MAX is validated and still wins", () => {
  assert.equal(generalLimit({ RATE_LIMIT_MAX: "5000" }), 5000);
  assert.equal(generalLimit({ RATE_LIMIT_MAX: "abc" }), 300);
});

test("a production limiter returns 429 after its budget", async () => {
  const express = require("express");
  const app = express();
  app.post("/x", createLimiter("unit-test", 2, { env: {} }), (req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/x`;
  const statuses = [];
  const lines = [];
  const original = console.warn;
  console.warn = line => lines.push(line);
  try {
    for (let i = 0; i < 3; i++) statuses.push((await fetch(url, { method: "POST" })).status);
  } finally {
    console.warn = original;
    server.close();
  }
  assert.deepEqual(statuses, [200, 200, 429]);
  const event = JSON.parse(lines[0]);
  assert.equal(event.type, "security_event");
  assert.equal(event.event, "rate_limited");
  assert.equal(event.limiter, "unit-test");
});
