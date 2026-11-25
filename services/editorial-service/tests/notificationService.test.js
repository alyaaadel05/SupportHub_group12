"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { HttpError } = require("../services/http");
const { createNotificationService } = require("../services/notificationService");

function createPool() {
  const calls = [];

  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes("UPDATE publication_outbox") && sql.includes("RETURNING *")) {
        return {
          rows: [{
            outbox_id: 1,
            article_id: 42,
            attempts: 0,
            claim_token: params[1],
            state: "processing"
          }]
        };
      }

      return { rows: [], rowCount: 1 };
    }
  };
}

test("claims a notification before delivering it", async () => {
  const pool = createPool();
  let deliveredArticleId;

  const service = createNotificationService({
    pool,
    notifySearch: async articleId => {
      deliveredArticleId = articleId;
    }
  });

  const result = await service.attempt(1);

  assert.equal(deliveredArticleId, 42);
  assert.equal(result.status, "delivered");
  assert.equal(pool.calls.length, 2);
  assert.match(pool.calls[0].sql, /state = 'processing'/);
  assert.match(pool.calls[1].sql, /state = 'delivered'/);
});

test("moves uncertain Search delivery outcomes to reconciliation", async () => {
  const pool = createPool();

  const service = createNotificationService({
    pool,
    notifySearch: async () => {
      throw new Error("Network timeout");
    }
  });

  const result = await service.attempt(1);

  assert.equal(result.status, "needs_reconciliation");
  assert.match(pool.calls[1].sql, /state = \$3/);
  assert.equal(pool.calls[1].params[2], "needs_reconciliation");
  assert.match(pool.calls[1].sql, /claim_token = NULL/);
});

test("marks a definite Search client rejection as failed", async () => {
  const pool = createPool();

  const service = createNotificationService({
    pool,
    notifySearch: async () => {
      throw new HttpError(400, "Invalid publication request");
    }
  });

  const result = await service.attempt(1);

  assert.equal(result.status, "failed");
  assert.equal(pool.calls[1].params[2], "failed");
});

test("does not deliver when the notification cannot be claimed", async () => {
  const pool = {
    async query() {
      return { rows: [], rowCount: 0 };
    }
  };

  let called = false;

  const service = createNotificationService({
    pool,
    notifySearch: async () => {
      called = true;
    }
  });

  const result = await service.attempt(1);

  assert.equal(result.status, "already_handled_or_not_due");
  assert.equal(called, false);
});

test("does not treat a local delivered-state update failure as a Search failure", async () => {
  const calls = [];

  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes("RETURNING *")) {
        return {
          rows: [{
            outbox_id: 1,
            article_id: 42,
            attempts: 0,
            claim_token: params[1],
            state: "processing"
          }]
        };
      }

      throw new Error("Database connection lost");
    }
  };

  const service = createNotificationService({
    pool,
    notifySearch: async () => {}
  });

  await assert.rejects(
    service.attempt(1),
    /Database connection lost/
  );

  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /state = 'delivered'/);
});
