"use strict";

// Automatic re-review flags requested by Search Service
// (POST /internal/auto-flags, migration 009).

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:1/editorial_test";
process.env.SESSION_SECRET ||= "test-session-secret-".padEnd(48, "x");
process.env.FRONTEND_ORIGIN ||= "http://localhost:8080";
process.env.SERVICE_SHARED_SECRET = "s".repeat(48);

const { createFlagService } = require("../services/flagService");
const { requireServiceSignature, serviceSignature } = require("../middleware/security");
const { signedHeaders } = require("../services/serviceClient");
const { HttpError } = require("../services/http");

const published = { id: 7, status: "published", author_id: 2 };

function makePool(handler) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      return handler(sql, params);
    }
  };
}

function serviceWith({ article = published, rows } = {}) {
  const pool = makePool(async (sql, params) => ({
    rows: rows ? rows(sql, params) : [{
      flag_id: 1, article_id: params[0], flagged_by: null,
      reason: params[1], source: "search", status: "open"
    }]
  }));
  const service = createFlagService({ pool, getArticle: async () => article });
  return { service, pool };
}

async function rejects(promise, status) {
  await assert.rejects(promise, error => error instanceof HttpError && error.status === status);
}

test("opens an automatic flag when the rule is met (6 of 8 unhelpful)", async () => {
  const { service, pool } = serviceWith();
  const flag = await service.autoFlag({ articleId: 7, unhelpfulVotes: 6, totalVotes: 8 });

  assert.equal(flag.duplicate, false);
  assert.equal(flag.source, "search");
  assert.equal(flag.flagged_by, null);
  assert.match(flag.reason, /6 of 8 votes/);
  assert.match(pool.calls[0].sql, /VALUES \(\$1, NULL, \$2, 'search'\)/);
  assert.deepEqual(pool.calls[0].params.slice(0, 1), [7]);
});

test("returns the existing open flag instead of a second re-review", async () => {
  const { service } = serviceWith({
    rows: sql => sql.startsWith("INSERT") ? [] : [{ flag_id: 3, article_id: 7, status: "open" }]
  });
  const flag = await service.autoFlag({ articleId: 7, unhelpfulVotes: 5, totalVotes: 5 });
  assert.equal(flag.duplicate, true);
  assert.equal(flag.flag_id, 3);
});

test("refuses when the rule is not met (422) and runs no query", async () => {
  for (const counts of [
    { unhelpfulVotes: 4, totalVotes: 4 },   // fewer than 5 unhelpful
    { unhelpfulVotes: 6, totalVotes: 10 },  // exactly 60%, needs more than 60%
    { unhelpfulVotes: 5, totalVotes: 20 }
  ]) {
    const { service, pool } = serviceWith();
    await rejects(service.autoFlag({ articleId: 7, ...counts }), 422);
    assert.equal(pool.calls.length, 0);
  }
});

test("rejects invalid input (400)", async () => {
  for (const body of [
    { articleId: "7 OR 1=1", unhelpfulVotes: 6, totalVotes: 8 },
    { articleId: 7, unhelpfulVotes: "6", totalVotes: 8 },
    { articleId: 7, unhelpfulVotes: 9, totalVotes: 8 },
    { articleId: 7, unhelpfulVotes: 0, totalVotes: 0 },
    undefined
  ]) {
    const { service } = serviceWith();
    await rejects(service.autoFlag(body), 400);
  }
});

test("only published articles can be flagged (404 / 409)", async () => {
  await rejects(serviceWith({ article: null }).service
    .autoFlag({ articleId: 7, unhelpfulVotes: 6, totalVotes: 8 }), 404);
  await rejects(serviceWith({ article: { ...published, status: "draft" } }).service
    .autoFlag({ articleId: 7, unhelpfulVotes: 6, totalVotes: 8 }), 409);
});

// Signature middleware on a small app with the same raw-body capture as server.js
async function withApp(fn) {
  const app = express();
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf.toString("utf8"); } }));
  app.post("/internal/auto-flags", requireServiceSignature("search-analytics-service"),
    (req, res) => res.status(201).json({ ok: true }));
  const server = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

const body = JSON.stringify({ articleId: 7, unhelpfulVotes: 6, totalVotes: 8 });
const path = "/internal/auto-flags";

async function post(base, headers, payload = body) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: payload
  });
  return res.status;
}

test("accepts a correctly signed request from Search", async () => {
  await withApp(async base => {
    assert.equal(await post(base, signedHeaders("search-analytics-service", "POST", path, body)), 201);
  });
});

test("rejects unsigned, wrong-sender, tampered, old and wrong-secret requests (401)", async () => {
  await withApp(async base => {
    assert.equal(await post(base, {}), 401);

    // Article Service is not allowed to request automatic flags.
    assert.equal(await post(base, signedHeaders("article-service", "POST", path, body)), 401);

    // Body changed after signing.
    const signed = signedHeaders("search-analytics-service", "POST", path, body);
    assert.equal(await post(base, signed,
      JSON.stringify({ articleId: 8, unhelpfulVotes: 6, totalVotes: 8 })), 401);

    // Replay of a request older than 5 minutes.
    const old = String(Date.now() - 10 * 60 * 1000);
    assert.equal(await post(base, {
      "x-service-name": "search-analytics-service",
      "x-service-timestamp": old,
      "x-service-signature": serviceSignature(process.env.SERVICE_SHARED_SECRET,
        "search-analytics-service", old, "POST", path, body)
    }), 401);

    // Signed with a different secret.
    const now = String(Date.now());
    assert.equal(await post(base, {
      "x-service-name": "search-analytics-service",
      "x-service-timestamp": now,
      "x-service-signature": serviceSignature("w".repeat(48),
        "search-analytics-service", now, "POST", path, body)
    }), 401);
  });
});

test("real server: /internal/auto-flags without a signature is rejected (401)", async () => {
  const app = require("../server");
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});
