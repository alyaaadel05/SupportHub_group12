"use strict";

/*
 * Editorial Service - HTTP-level security tests (S1-S8).
 *
 * These tests send real HTTP requests to the Editorial Express routes.
 * No database or external service is contacted:
 *   - Tests that need an authenticated user mount the real route files
 *     behind a test-only session middleware.
 *   - Tests for unauthenticated access, forged cookies, security headers
 *     and rate limiting use the real server.js application.
 *   - Article Service calls and database queries are replaced with mocks
 *     so the tests can confirm that a blocked request never reaches them.
 *
 * Results from these tests are recorded in docs/security-test-evidence.md.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:1/editorial_test";
process.env.SESSION_SECRET ||= "test-session-secret-".padEnd(48, "x");
process.env.FRONTEND_ORIGIN ||= "http://localhost:8080";

const ORIGIN = process.env.FRONTEND_ORIGIN;
const CSRF = "c".repeat(64);

const pool = require("../db/pool");
const serviceClient = require("../services/serviceClient");

// Replace outgoing calls before the routes load, so every service module
// picks up these delegating mocks.
const calls = { getArticle: [], transitionArticle: [], query: [] };
let articleLookup = async () => null;

serviceClient.getArticle = async (...args) => {
  calls.getArticle.push(args);
  return articleLookup(...args);
};

serviceClient.transitionArticle = async (...args) => {
  calls.transitionArticle.push(args);
  throw new Error("transitionArticle must not be reached in security tests");
};

let queryHandler = async () => ({ rows: [], rowCount: 0 });

pool.query = async (sql, values) => {
  calls.query.push({ sql, values });
  return queryHandler(sql, values);
};

pool.connect = async () => {
  throw new Error("pool.connect must not be reached in security tests");
};

function resetCalls() {
  calls.getArticle.length = 0;
  calls.transitionArticle.length = 0;
  calls.query.length = 0;
  articleLookup = async () => null;
  queryHandler = async () => ({ rows: [], rowCount: 0 });
}

// Test application: real routes, real middleware, test-only session.
// The session is supplied through an internal test header that exists
// only in this file; server.js has no such header.
function buildRoutedApp() {
  const app = express();
  app.use(express.json({ limit: "100kb" }));

  app.use((req, res, next) => {
    const raw = req.get("x-test-session");
    req.session = raw ? JSON.parse(raw) : {};
    next();
  });

  app.use("/api", require("../routes/reviewRoutes"));
  app.use("/api", require("../routes/publicationRoutes"));
  app.use("/api", require("../routes/flagRoutes"));

  app.use((req, res) => res.status(404).json({ error: "Route not found" }));

  // Same error contract as server.js
  app.use((error, req, res, next) => {
    if (error.status && error.status >= 400 && error.status < 500) {
      return res.status(error.status).json({ error: error.message });
    }

    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

async function withServer(app, run) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });

  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function sessionFor(user, csrfToken = CSRF) {
  return JSON.stringify({ user, csrfToken });
}

const author = { id: 10, role: "author" };
const otherAuthorId = 99;
const reviewer = { id: 20, role: "reviewer" };

async function request(base, method, url, { session, origin = ORIGIN, csrf = CSRF, body } = {}) {
  const headers = { "Content-Type": "application/json" };

  if (session) headers["x-test-session"] = session;
  if (origin) headers.Origin = origin;
  if (csrf) headers["X-CSRF-Token"] = csrf;

  const response = await fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  let json = null;
  try { json = await response.json(); } catch { /* not JSON */ }

  return { status: response.status, body: json, headers: response.headers };
}

const routedApp = buildRoutedApp();

// S1 - Unauthenticated access ------------------------------------------------

test("S1: unauthenticated requests to protected review endpoints return 401 (real server)", async () => {
  resetCalls();
  const app = require("../server");

  await withServer(app, async (base) => {
    const checks = [
      ["GET", "/api/reviews"],
      ["GET", "/api/editorial/flags"],
      ["GET", "/api/editorial/published"],
      ["GET", "/api/articles/1/history"],
      ["POST", "/api/articles/1/reviews"],
      ["POST", "/api/articles/1/submissions"],
      ["PATCH", "/api/articles/1/publication"]
    ];

    for (const [method, url] of checks) {
      const result = await request(base, method, url, { body: method === "GET" ? undefined : {} });
      assert.equal(result.status, 401, `${method} ${url}`);
      assert.deepEqual(result.body, { error: "Login required" });
    }
  });

  assert.equal(calls.query.length, 0, "no database query for unauthenticated requests");
  assert.equal(calls.getArticle.length, 0, "no Article Service call for unauthenticated requests");
});

// S2 - Function-level authorization --------------------------------------------

test("S2: an author cannot approve, publish, list reviews or manage flags (403)", async () => {
  resetCalls();

  await withServer(routedApp, async (base) => {
    const session = sessionFor(author);

    const checks = [
      ["POST", "/api/articles/42/reviews", { decision: "approved" }],
      ["PATCH", "/api/articles/42/publication", {}],
      ["GET", "/api/reviews", undefined],
      ["GET", "/api/editorial/flags", undefined],
      ["PATCH", "/api/flags/1", { resolution: "done" }]
    ];

    for (const [method, url, body] of checks) {
      const result = await request(base, method, url, { session, body });
      assert.equal(result.status, 403, `${method} ${url}`);
      assert.deepEqual(result.body, { error: "Reviewer permission required" });
    }
  });

  assert.equal(calls.query.length, 0);
  assert.equal(calls.getArticle.length, 0);
  assert.equal(calls.transitionArticle.length, 0);
});

// S3 - Object-level authorization (ownership) --------------------------------

test("S3: an author cannot submit another author's article by changing the ID (403)", async () => {
  resetCalls();

  articleLookup = async (articleId) => ({
    id: articleId,
    author_id: otherAuthorId,
    status: "draft",
    title: "Someone else's draft",
    content: "Body",
    category_id: 1
  });

  await withServer(routedApp, async (base) => {
    const result = await request(base, "POST", "/api/articles/42/submissions", {
      session: sessionFor(author)
    });

    assert.equal(result.status, 403);
    assert.deepEqual(result.body, { error: "Only the author can submit" });
  });

  assert.equal(calls.getArticle.length, 1, "ownership is checked against the Article Service record");
  assert.equal(calls.transitionArticle.length, 0, "the article status is never changed");
  assert.equal(calls.query.length, 0, "no workflow record is written");
});

test("S3: a reviewer cannot approve an article they authored (403)", async () => {
  resetCalls();

  articleLookup = async (articleId) => ({
    id: articleId,
    author_id: reviewer.id,
    status: "in_review"
  });

  queryHandler = async (sql) => {
    if (/FROM editorial_reviews/i.test(sql)) {
      return { rows: [{ review_id: 7, article_id: 42, decision: "pending" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };

  await withServer(routedApp, async (base) => {
    const result = await request(base, "POST", "/api/articles/42/reviews", {
      session: sessionFor(reviewer),
      body: { decision: "approved" }
    });

    assert.equal(result.status, 403);
    assert.deepEqual(result.body, { error: "Cannot review your own article" });
  });

  assert.equal(calls.transitionArticle.length, 0);
});

// S4 - CSRF and Origin ---------------------------------------------------------

test("S4: state-changing requests without a valid CSRF token or Origin are rejected (403)", async () => {
  resetCalls();
  const session = sessionFor(reviewer);

  await withServer(routedApp, async (base) => {
    const cases = [
      { label: "missing token", csrf: null, error: "Invalid CSRF token" },
      { label: "malformed token", csrf: "not-a-token", error: "Invalid CSRF token" },
      { label: "mismatched token", csrf: "d".repeat(64), error: "Invalid CSRF token" },
      { label: "foreign Origin", origin: "https://evil.example", error: "Origin not allowed" },
      { label: "missing Origin", origin: null, error: "Origin not allowed" }
    ];

    for (const c of cases) {
      const result = await request(base, "POST", "/api/articles/42/reviews", {
        session,
        csrf: c.csrf === undefined ? CSRF : c.csrf,
        origin: c.origin === undefined ? ORIGIN : c.origin,
        body: { decision: "approved" }
      });

      assert.equal(result.status, 403, c.label);
      assert.deepEqual(result.body, { error: c.error }, c.label);
    }
  });

  assert.equal(calls.query.length, 0, "rejected writes never reach the database");
  assert.equal(calls.getArticle.length, 0);
});

// S5 - SQL injection -----------------------------------------------------------

test("S5: SQL injection payloads in route IDs are rejected before any query (400)", async () => {
  resetCalls();
  const session = sessionFor(reviewer);

  await withServer(routedApp, async (base) => {
    const payloads = [
      "1 OR 1=1",
      "1; DROP TABLE editorial_reviews;--",
      "1' OR '1'='1",
      "0x1",
      "-1"
    ];

    for (const payload of payloads) {
      const encoded = encodeURIComponent(payload);

      const read = await request(base, "GET", `/api/articles/${encoded}/history`, { session });
      assert.equal(read.status, 400, `history ${payload}`);
      assert.deepEqual(read.body, { error: "Invalid positive integer ID" });

      const write = await request(base, "POST", `/api/articles/${encoded}/reviews`, {
        session,
        body: { decision: "approved" }
      });
      assert.equal(write.status, 400, `review ${payload}`);
    }
  });

  assert.equal(calls.query.length, 0, "no query executed for malicious IDs");
});

test("S5: SQL injection payloads in text fields are sent as bound parameters, not SQL", async () => {
  resetCalls();
  const payload = "x'); DROP TABLE editorial_outdated_flags;--";

  articleLookup = async (articleId) => ({ id: articleId, author_id: 1, status: "published" });
  queryHandler = async (sql, values) => ({
    rows: [{ flag_id: 1, article_id: values[0], flagged_by: values[1], reason: values[2], status: "open" }],
    rowCount: 1
  });

  await withServer(routedApp, async (base) => {
    const result = await request(base, "POST", "/api/articles/42/flags", {
      session: sessionFor(reviewer),
      body: { reason: payload }
    });

    assert.equal(result.status, 201);
    assert.equal(result.body.flag.reason, payload, "payload stored as ordinary text");
  });

  assert.equal(calls.query.length, 1);
  assert.ok(!calls.query[0].sql.includes("DROP TABLE"), "payload is not part of the SQL text");
  assert.match(calls.query[0].sql, /\$3/, "reason uses a positional parameter");
  assert.deepEqual(calls.query[0].values, [42, reviewer.id, payload]);
});

test("S5: no Editorial source file builds SQL by interpolating values into query text", () => {
  const root = path.join(__dirname, "..");
  const offenders = [];

  for (const dir of ["services", "workers", "lambda/publicationOutcome", "controllers", "routes"]) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;

    for (const name of fs.readdirSync(full)) {
      if (!name.endsWith(".js")) continue;
      const source = fs.readFileSync(path.join(full, name), "utf8");

      // Any .query(`...${...}...`) call is a dynamic SQL string.
      const pattern = /\.query\(\s*`[^`]*\$\{[^`]*`/g;
      for (const match of source.matchAll(pattern)) {
        offenders.push(`${dir}/${name}: ${match[0].slice(0, 80)}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});

// S6 - Stored XSS --------------------------------------------------------------

test("S6: XSS payloads are stored and returned as inert JSON text", async () => {
  resetCalls();
  const payload = "<script>alert(1)</script><img src=x onerror=alert(2)>";

  articleLookup = async (articleId) => ({ id: articleId, author_id: 1, status: "published" });
  queryHandler = async (sql, values) => ({
    rows: [{ flag_id: 2, article_id: values[0], flagged_by: values[1], reason: values[2], status: "open" }],
    rowCount: 1
  });

  await withServer(routedApp, async (base) => {
    const result = await request(base, "POST", "/api/articles/42/flags", {
      session: sessionFor(reviewer),
      body: { reason: payload }
    });

    assert.equal(result.status, 201);
    assert.match(result.headers.get("content-type"), /^application\/json/);
    assert.equal(result.body.flag.reason, payload, "content is not altered or executed by the API");
  });
});

test("S6: real server sends headers that stop responses being run as HTML/script", async () => {
  const app = require("../server");

  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/reviews`);

    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
    assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
    assert.equal(response.headers.get("x-powered-by"), null);
  });
});

test("S6: the Editorial frontend renders text with textContent, never innerHTML", (t) => {
  const file = path.join(__dirname, "..", "..", "..", "frontend", "js", "editorial.js");

  if (!fs.existsSync(file)) {
    t.skip("frontend/js/editorial.js not present in this checkout");
    return;
  }

  const source = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(source, /\.innerHTML\s*=|insertAdjacentHTML|document\.write/);
  assert.match(source, /\.textContent\s*=/);
});

// S7 - Invalid or expired session ---------------------------------------------

test("S7: sessions with missing or tampered user data are denied (401)", async () => {
  resetCalls();

  await withServer(routedApp, async (base) => {
    const sessions = [
      JSON.stringify({}),                                   // expired / logged out
      JSON.stringify({ user: { id: "abc", role: "admin" } }),
      JSON.stringify({ user: { id: 0, role: "admin" } }),
      JSON.stringify({ user: { id: -5, role: "reviewer" } }),
      JSON.stringify({ user: { role: "admin" } })
    ];

    for (const session of sessions) {
      const result = await request(base, "GET", "/api/reviews", { session });
      assert.equal(result.status, 401, session);
    }
  });

  assert.equal(calls.query.length, 0);
});

test("S7: a forged or tampered session cookie is denied by the real server (401)", async () => {
  const app = require("../server");

  await withServer(app, async (base) => {
    for (const cookie of [
      "supporthub.sid=s%3Aforged-session-id.invalidsignature",
      "supporthub.sid=unsigned-session-id",
      "supporthub.sid="
    ]) {
      const response = await fetch(`${base}/api/reviews`, { headers: { cookie } });
      assert.equal(response.status, 401, cookie);
    }
  });
});

// S8 - Rate limiting -----------------------------------------------------------

test("S8: excessive API requests are rate limited (429) by the real server", async () => {
  // A fresh copy of server.js gives this test its own limiter counters.
  delete require.cache[require.resolve("../server")];
  const app = require("../server");

  await withServer(app, async (base) => {
    let last;
    let firstLimited = null;

    for (let i = 1; i <= 305; i += 1) {
      last = await fetch(`${base}/api/reviews`);
      if (last.status === 429 && firstLimited === null) firstLimited = i;
      await last.arrayBuffer();
    }

    assert.equal(firstLimited, 301, "the 301st request in 15 minutes is refused");
    assert.equal(last.status, 429);
    assert.ok(last.headers.get("retry-after"), "Retry-After header is sent");
  });
});
