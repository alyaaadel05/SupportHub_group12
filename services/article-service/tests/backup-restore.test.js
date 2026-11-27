"use strict";

// Feature A: restore a draft from its S3 backup.
// POST /api/articles/:id/versions/:versionId/restore-backup (authors only, owner only).

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AWS_S3_BUCKET = "supporthub-unit-test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unit-test@127.0.0.1:1/none";

const s3 = require("../services/s3Client");
const versionService = require("../services/versionService");
const backupService = require("../services/articleBackupService");

const author = { id: 5, role: "author" };
const otherAuthor = { id: 9, role: "author" };
const fakePool = {};

const stored = {
  articleId: 6,
  versionId: 14,
  exportedAt: "2026-11-27T10:00:00.000Z",
  version: { version_id: 14, article_id: 6, title: "Router Instructions", content: "How to reset the router safely.", category_id: 2 }
};

function s3Returns(t, document) {
  const calls = [];
  t.mock.method(s3, "send", async command => {
    calls.push(command);
    return { Body: { transformToString: async () => JSON.stringify(document) } };
  });
  return calls;
}

// ------------------------------------------------------------ service level

test("restores the draft from the S3 snapshot (not from the database copy)", async t => {
  t.mock.method(versionService, "detail", async () => ({ version_id: 14, title: "DB copy - must not be used" }));
  const calls = s3Returns(t, stored);
  let snapshot;
  t.mock.method(versionService, "restoreFromSnapshot", async (pool, id, snap, user) => {
    snapshot = { id, snap, user };
    return { id: 6, title: snap.title, status: "draft" };
  });

  const result = await backupService.restoreFromBackup(fakePool, 6, 14, author);

  assert.equal(calls[0].constructor.name, "GetObjectCommand");
  assert.equal(calls[0].input.Key, "articles/6/versions/14.json");
  assert.deepEqual(snapshot.snap, { title: "Router Instructions", content: "How to reset the router safely.", category_id: 2 });
  assert.equal(snapshot.user, author);
  assert.equal(result.restoredFrom, "articles/6/versions/14.json");
  assert.equal(result.article.title, "Router Instructions");
});

test("another author gets 403 and S3 is never read", async t => {
  t.mock.method(versionService, "detail", async () => { const e = new Error("Forbidden"); e.status = 403; throw e; });
  let s3Called = false;
  t.mock.method(s3, "send", async () => { s3Called = true; return {}; });
  t.mock.method(versionService, "restoreFromSnapshot", async () => assert.fail("must not restore"));

  await assert.rejects(backupService.restoreFromBackup(fakePool, 6, 14, otherAuthor), e => e.status === 403);
  assert.equal(s3Called, false);
});

test("404 when no backup exists for the version", async t => {
  t.mock.method(versionService, "detail", async () => stored.version);
  t.mock.method(s3, "send", async () => { const e = new Error("missing"); e.name = "NoSuchKey"; throw e; });
  t.mock.method(versionService, "restoreFromSnapshot", async () => assert.fail("must not restore"));

  await assert.rejects(backupService.restoreFromBackup(fakePool, 6, 14, author),
    e => e.status === 404 && e.message === "Article backup not found");
});

test("a backup belonging to another article/version is rejected (502), nothing restored", async t => {
  t.mock.method(versionService, "detail", async () => stored.version);
  s3Returns(t, { ...stored, articleId: 7 });
  t.mock.method(versionService, "restoreFromSnapshot", async () => assert.fail("must not restore"));

  await assert.rejects(backupService.restoreFromBackup(fakePool, 6, 14, author), e => e.status === 502);
});

test("a backup without title/content is rejected (502)", async t => {
  t.mock.method(versionService, "detail", async () => stored.version);
  s3Returns(t, { ...stored, version: { ...stored.version, content: "  " } });
  t.mock.method(versionService, "restoreFromSnapshot", async () => assert.fail("must not restore"));

  await assert.rejects(backupService.restoreFromBackup(fakePool, 6, 14, author), e => e.status === 502);
});

test("S3 unavailable -> 503", async t => {
  t.mock.method(versionService, "detail", async () => stored.version);
  t.mock.method(s3, "send", async () => { const e = new Error("down"); e.name = "TimeoutError"; throw e; });
  await assert.rejects(backupService.restoreFromBackup(fakePool, 6, 14, author), e => e.status === 503);
});

// ------------------------------------------------------------ transaction rules (restoreFromSnapshot)

function fakeDb(article) {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push(sql.trim().split(/\s+/).slice(0, 2).join(" "));
      if (/^SELECT \*\s+FROM articles/i.test(sql.trim())) return { rows: article ? [article] : [] };
      if (/^UPDATE articles/i.test(sql.trim())) return { rows: [{ ...article, title: params[0], content: params[1], category_id: params[2] }] };
      if (/MAX\(version_number\)/i.test(sql)) return { rows: [{ n: 3 }] };
      return { rows: [] };
    },
    release() {}
  };
  return { pool: { connect: async () => client }, queries };
}
const snap = { title: "From backup", content: "Restored content from S3.", category_id: 2 };

test("restoreFromSnapshot updates the owner's draft and adds version 4", async () => {
  const { pool, queries } = fakeDb({ id: 6, author_id: 5, status: "draft" });
  const article = await versionService.restoreFromSnapshot(pool, 6, snap, author);
  assert.equal(article.title, "From backup");
  assert.ok(queries.includes("INSERT INTO"));
  assert.equal(queries.at(-1), "COMMIT");
});

test("restoreFromSnapshot: non-owner 403, published article 409, missing 404 (all rolled back)", async () => {
  for (const [article, user, status] of [
    [{ id: 6, author_id: 5, status: "draft" }, otherAuthor, 403],
    [{ id: 6, author_id: 5, status: "published" }, author, 409],
    [null, author, 404]
  ]) {
    const { pool, queries } = fakeDb(article);
    await assert.rejects(versionService.restoreFromSnapshot(pool, 6, snap, user), e => e.status === status);
    assert.equal(queries.at(-1), "ROLLBACK");
    assert.ok(!queries.includes("UPDATE articles"));
  }
});

test("the existing restore-by-version still works through the shared transaction", async () => {
  const { pool } = fakeDb({ id: 6, author_id: 5, status: "draft" });
  // version lookup returns nothing in this fake -> 404 "Version not found"
  await assert.rejects(versionService.restore(pool, 6, 14, author), e => e.status === 404 && e.message === "Version not found");
});

// ------------------------------------------------------------ route guard: authors only

test("route is author-only: editor and admin 403, anonymous 401", async () => {
  const express = require("express");
  const app = express();
  app.use(express.json());
  let role = null;
  app.use((req, res, next) => { req.session = role ? { user: { id: 5, role } } : {}; next(); });
  app.use("/api", require("../routes/versionRoutes"));
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/api/articles/6/versions/14/restore-backup`;
  try {
    const statuses = {};
    for (const r of [null, "editor", "admin"]) { role = r; statuses[r || "anonymous"] = (await fetch(url, { method: "POST" })).status; }
    assert.deepEqual(statuses, { anonymous: 401, editor: 403, admin: 403 });
  } finally { server.close(); }
});
