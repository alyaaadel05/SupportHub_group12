"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { HttpError } = require("../services/http");
const { createFlagService } = require("../services/flagService");

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

const reviewer = { id: 10, role: "reviewer" };

test("creates a flag for a published article and records the reviewer", async () => {
  const pool = makePool(async (sql, params) => ({
    rows: [{
      flag_id: 1,
      article_id: params[0],
      flagged_by: params[1],
      reason: params[2],
      status: "open"
    }]
  }));

  const service = createFlagService({
    pool,
    getArticle: async id => ({ id, status: "published" })
  });

  const result = await service.flag(20, reviewer, {
    reason: "The information is outdated"
  });

  assert.equal(result.article_id, 20);
  assert.equal(result.flagged_by, 10);
  assert.equal(result.status, "open");
  assert.match(pool.calls[0].sql, /INSERT INTO editorial_outdated_flags/);
});

test("does not flag an article that is not published", async () => {
  const pool = makePool(async () => ({ rows: [] }));
  const service = createFlagService({
    pool,
    getArticle: async () => ({ status: "draft" })
  });

  await assert.rejects(
    service.flag(20, reviewer, { reason: "Outdated" }),
    error => error instanceof HttpError && error.status === 409
  );

  assert.equal(pool.calls.length, 0);
});

test("returns 404 when the article does not exist", async () => {
  const pool = makePool(async () => ({ rows: [] }));
  const service = createFlagService({
    pool,
    getArticle: async () => null
  });

  await assert.rejects(
    service.flag(20, reviewer, { reason: "Outdated" }),
    error => error instanceof HttpError && error.status === 404
  );
});

test("rejects an empty flag reason", async () => {
  const pool = makePool(async () => ({ rows: [] }));
  const service = createFlagService({
    pool,
    getArticle: async () => ({ status: "published" })
  });

  await assert.rejects(
    service.flag(20, reviewer, { reason: "   " }),
    error => error instanceof HttpError && error.status === 400
  );

  assert.equal(pool.calls.length, 0);
});

test("rejects invalid pagination values", async () => {
  const pool = makePool(async () => ({ rows: [] }));
  const service = createFlagService({
    pool,
    getArticle: async () => null
  });

  await assert.rejects(
    service.listOpen({ limit: 1000 }),
    error => error instanceof HttpError && error.status === 400
  );

  assert.equal(pool.calls.length, 0);
});

test("lists open flags and preserves them when Article Service is unavailable", async () => {
  const pool = makePool(async sql => {
    if (sql.includes("COUNT(*)")) {
      return { rows: [{ total: 1 }] };
    }

    return {
      rows: [{ flag_id: 1, article_id: 20, status: "open" }]
    };
  });

  const service = createFlagService({
    pool,
    getArticle: async () => {
      throw new Error("Article Service unavailable");
    }
  });

  const result = await service.listOpen({ limit: 10, offset: 0 });

  assert.equal(result.total, 1);
  assert.equal(result.flags.length, 1);
  assert.equal(result.flags[0].article, null);
  assert.equal(result.flags[0].articleUnavailable, true);
  assert.equal(result.hasMore, false);
});

test("resolves a flag and records reviewer and resolution", async () => {
  const pool = makePool(async (sql, params) => {
    if (sql.includes("SELECT flag_id, article_id, status")) {
      return { rows: [{ flag_id: params[0], article_id: 20, status: "open" }] };
    }

    return {
      rows: [{
        flag_id: params[0],
        status: "resolved",
        resolved_by: params[1],
        resolution: params[2],
        resolved_at: new Date()
      }]
    };
  });

  const service = createFlagService({
    pool,
    getArticle: async () => null
  });

  const result = await service.resolve(1, reviewer, {
    resolution: "Content was reviewed and corrected"
  });

  assert.equal(result.status, "resolved");
  assert.equal(result.resolved_by, 10);
  assert.equal(result.resolution, "Content was reviewed and corrected");
  assert.match(pool.calls[1].sql, /status = 'open'/);
});

test("requires a non-empty resolution explanation", async () => {
  const pool = makePool(async () => ({ rows: [] }));
  const service = createFlagService({
    pool,
    getArticle: async () => null
  });

  await assert.rejects(
    service.resolve(1, reviewer, { resolution: " " }),
    error => error instanceof HttpError && error.status === 400
  );

  assert.equal(pool.calls.length, 0);
});

test("returns 404 when resolving a nonexistent flag", async () => {
  const pool = makePool(async sql => {
    if (sql.includes("UPDATE editorial_outdated_flags")) {
      return { rows: [] };
    }

    return { rows: [] };
  });

  const service = createFlagService({
    pool,
    getArticle: async () => null
  });

  await assert.rejects(
    service.resolve(999, reviewer, {
      resolution: "Reviewed"
    }),
    error => error instanceof HttpError && error.status === 404
  );

  assert.equal(pool.calls.length, 1);
});

test("returns 409 when a flag was already resolved", async () => {
  const pool = makePool(async sql => {
    if (sql.includes("UPDATE editorial_outdated_flags")) {
      return { rows: [] };
    }

    return { rows: [{ flag_id: 1, status: "resolved" }] };
  });

  const service = createFlagService({
    pool,
    getArticle: async () => null
  });

  await assert.rejects(
    service.resolve(1, reviewer, {
      resolution: "Reviewed"
    }),
    error => error instanceof HttpError && error.status === 409
  );
});

// ---- Phase 4: one open re-review per article, no self re-review ----

test("a repeated report returns the existing open flag instead of a new re-review", async () => {
  const pool = makePool(async sql => {
    if (sql.includes("INSERT INTO editorial_outdated_flags")) {
      assert.match(sql, /ON CONFLICT \(article_id\) WHERE status = 'open' DO NOTHING/);
      return { rows: [] };
    }

    return { rows: [{ flag_id: 7, article_id: 20, status: "open", flagged_by: 11 }] };
  });

  const service = createFlagService({
    pool,
    getArticle: async id => ({ id, status: "published" })
  });

  const result = await service.flag(20, reviewer, { reason: "Still outdated" });

  assert.equal(result.flag_id, 7);
  assert.equal(result.duplicate, true);
  assert.equal(pool.calls.length, 2);
});

test("a new report on an article without an open flag is not a duplicate", async () => {
  const pool = makePool(async (sql, params) => ({
    rows: [{ flag_id: 8, article_id: params[0], status: "open" }]
  }));

  const service = createFlagService({
    pool,
    getArticle: async id => ({ id, status: "published" })
  });

  const result = await service.flag(20, reviewer, { reason: "Outdated" });

  assert.equal(result.duplicate, false);
  assert.equal(pool.calls.length, 1);
});

test("the author of an article cannot resolve its re-review", async () => {
  const pool = makePool(async sql => {
    if (sql.includes("SELECT flag_id, article_id, status")) {
      return { rows: [{ flag_id: 1, article_id: 20, status: "open" }] };
    }

    throw new Error("must not update");
  });

  const service = createFlagService({
    pool,
    getArticle: async id => ({ id, status: "published", author_id: reviewer.id })
  });

  await assert.rejects(
    service.resolve(1, reviewer, { resolution: "Checked my own article" }),
    error => error instanceof HttpError && error.status === 403
  );

  assert.equal(pool.calls.length, 1);
});

test("resolution fails closed when Article Service is unavailable", async () => {
  const pool = makePool(async () => ({
    rows: [{ flag_id: 1, article_id: 20, status: "open" }]
  }));

  const service = createFlagService({
    pool,
    getArticle: async () => {
      throw new HttpError(503, "Article Service unavailable");
    }
  });

  await assert.rejects(
    service.resolve(1, reviewer, { resolution: "Reviewed" }),
    error => error instanceof HttpError && error.status === 503
  );

  assert.equal(pool.calls.length, 1);
});

test("a re-review resolved concurrently by another editor returns 409", async () => {
  const pool = makePool(async sql => {
    if (sql.includes("SELECT flag_id, article_id, status")) {
      return { rows: [{ flag_id: 1, article_id: 20, status: "open" }] };
    }

    return { rows: [] };
  });

  const service = createFlagService({
    pool,
    getArticle: async id => ({ id, status: "published", author_id: 99 })
  });

  await assert.rejects(
    service.resolve(1, reviewer, { resolution: "Reviewed" }),
    error => error instanceof HttpError && error.status === 409
  );
});
