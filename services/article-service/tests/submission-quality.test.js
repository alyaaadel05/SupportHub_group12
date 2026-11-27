"use strict";

// Feature C: submission quality rules before submit-for-review (422 with clear messages).

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unit-test@127.0.0.1:1/none";

const pool = require("../db/pool");
const articles = require("../services/articleService");

const owner = { id: 5, role: "author" };
const good = { id: 10, title: "Reset your router", content: "y".repeat(150), category_id: 1, category_found: 1 };

// Fake transaction: the locked draft row and whether another article has the same title.
function fakeDb(t, { draft = good, duplicate = false } = {}) {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push(sql.trim().split(/\s+/)[0]);
      if (sql.includes("FOR UPDATE OF a")) return { rowCount: draft ? 1 : 0, rows: draft ? [draft] : [] };
      if (sql.includes("WHERE id <> $1")) return { rowCount: duplicate ? 1 : 0, rows: duplicate ? [{ "?column?": 1 }] : [] };
      if (sql.includes("UPDATE articles")) return { rowCount: 1, rows: [{ id: 10, author_id: 5, status: params[0] }] };
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };
  t.mock.method(pool, "connect", async () => client);
  return queries;
}
const submit = () => articles.transitionStatus(10, "draft", "in_review", owner);

test("a valid draft is submitted and its event is written", async t => {
  const q = fakeDb(t);
  const article = await submit();
  assert.equal(article.status, "in_review");
  assert.ok(q.includes("INSERT"));
  assert.equal(q.at(-1), "COMMIT");
});

test("content shorter than 100 characters -> 422 with the current length", async t => {
  const q = fakeDb(t, { draft: { ...good, content: "Too short to review." } });
  await assert.rejects(submit(), e => {
    assert.equal(e.status, 422);
    assert.deepEqual(e.issues, ["Content must be at least 100 characters before it can be submitted for review (currently 20)."]);
    return true;
  });
  assert.ok(!q.includes("UPDATE") && !q.includes("INSERT"), "nothing changed");
  assert.equal(q.at(-1), "ROLLBACK");
});

test("missing category -> 422", async t => {
  fakeDb(t, { draft: { ...good, category_found: null } });
  await assert.rejects(submit(), e => e.status === 422 && e.issues[0] === "A valid category is required before submitting for review.");
});

test("duplicate title -> 422 and no outbox event", async t => {
  const q = fakeDb(t, { duplicate: true });
  await assert.rejects(submit(), e => e.status === 422 && /already uses this title/.test(e.message));
  assert.ok(!q.includes("INSERT"));
});

test("all problems are reported together", async t => {
  fakeDb(t, { draft: { ...good, content: "short", category_found: null }, duplicate: true });
  await assert.rejects(submit(), e => e.status === 422 && e.issues.length === 3 && e.message === e.issues.join(" "));
});

test("whitespace does not count toward the minimum length", async t => {
  fakeDb(t, { draft: { ...good, content: "   " + "z".repeat(99) + "   " } });
  await assert.rejects(submit(), e => e.status === 422 && /currently 99/.test(e.message));
});

test("not the owner / not a draft keeps the existing 409 path (null), no rules leak", async t => {
  fakeDb(t, { draft: null });
  assert.equal(await submit(), null);
});

test("duplicate-title query compares case- and whitespace-insensitively and excludes the article itself", async t => {
  let dupSql, dupParams;
  const client = {
    async query(sql, params) {
      if (sql.includes("FOR UPDATE OF a")) return { rows: [good] };
      if (sql.includes("WHERE id <> $1")) { dupSql = sql; dupParams = params; return { rows: [] }; }
      if (sql.includes("UPDATE articles")) return { rows: [{ id: 10, status: "in_review" }] };
      return { rows: [] };
    },
    release() {}
  };
  t.mock.method(pool, "connect", async () => client);
  await submit();
  assert.match(dupSql, /lower\(regexp_replace\(btrim\(title\)/);
  assert.deepEqual(dupParams, [10, good.title]);
});

test("422 response body carries error and issues", async () => {
  const express = require("express");
  const app = require("../server");
  // The real error handler is the last middleware of the app; drive it with a 422 error.
  const handler = app._router.stack.filter(l => l.handle && l.handle.length === 4).at(-1).handle;
  const err = articles.httpError(422, "A. B."); err.issues = ["A.", "B."];
  let status, body;
  handler(err, {}, { status(s) { status = s; return this; }, json(b) { body = b; return this; } }, () => {});
  assert.equal(status, 422);
  assert.deepEqual(body, { error: "A. B.", issues: ["A.", "B."] });
  assert.ok(express);
});
