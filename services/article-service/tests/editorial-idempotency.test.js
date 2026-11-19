
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db/pool");
const articles = require("../services/articleService");

const UUID = "550e8400-e29b-41d4-a716-446655440000";

function mockDatabase() {
  let status = "in_review";
  let updates = 0;
  const operations = new Map();

  const client = {
    async query(sql, params = []) {
      if (
        sql === "BEGIN" ||
        sql === "COMMIT" ||
        sql === "ROLLBACK" ||
        sql.includes("pg_advisory_xact_lock")
      ) {
        return { rows: [] };
      }

      if (sql.includes("FROM article_transition_operations")) {
        const saved = operations.get(params[0]);
        return { rows: saved ? [saved] : [] };
      }

      if (sql.includes("UPDATE articles")) {
        const [to, id, from] = params;

        if (id !== 10 || status !== from) {
          return { rows: [] };
        }

        status = to;
        updates++;

        return {
          rows: [{ id: 10, status: to }]
        };
      }

      if (sql.includes("INSERT INTO article_transition_operations")) {
        const [operationId, articleId, from, to, response] = params;

        operations.set(operationId, {
          article_id: articleId,
          from_status: from,
          to_status: to,
          response: JSON.parse(response)
        });

        return { rows: [] };
      }

      if (sql.includes("INSERT INTO article_event_outbox")) {
        return { rows: [] };
      }

      throw new Error("Unexpected SQL: " + sql);
    },

    release() {}
  };

  return {
    client,
    getStatus: () => status,
    getUpdates: () => updates,
    getOperations: () => operations.size
  };
}

test("First Editorial operation succeeds", async (t) => {
  const db = mockDatabase();
  t.mock.method(pool, "connect", async () => db.client);

  const result = await articles.transitionEditorialStatus(
    10, "in_review", "approved", UUID
  );

  assert.equal(result.article.status, "approved");
  assert.equal(db.getStatus(), "approved");
  assert.equal(db.getUpdates(), 1);
  assert.equal(db.getOperations(), 1);
});

test("Same operationId returns original result without updating twice", async (t) => {
  const db = mockDatabase();
  t.mock.method(pool, "connect", async () => db.client);

  const first = await articles.transitionEditorialStatus(
    10, "in_review", "approved", UUID
  );

  const retry = await articles.transitionEditorialStatus(
    10, "in_review", "approved", UUID
  );

  assert.deepEqual(retry, first);
  assert.equal(db.getUpdates(), 1);
  assert.equal(db.getOperations(), 1);
});

test("Reusing operationId for another article is rejected", async (t) => {
  const db = mockDatabase();
  t.mock.method(pool, "connect", async () => db.client);

  await articles.transitionEditorialStatus(
    10, "in_review", "approved", UUID
  );

  await assert.rejects(
    articles.transitionEditorialStatus(
      11, "in_review", "approved", UUID
    ),
    { status: 409 }
  );

  assert.equal(db.getUpdates(), 1);
});

test("Reusing operationId for another transition is rejected", async (t) => {
  const db = mockDatabase();
  t.mock.method(pool, "connect", async () => db.client);

  await articles.transitionEditorialStatus(
    10, "in_review", "approved", UUID
  );

  await assert.rejects(
    articles.transitionEditorialStatus(
      10, "approved", "published", UUID
    ),
    { status: 409 }
  );

  assert.equal(db.getUpdates(), 1);
});

test("Wrong expected status is rejected", async (t) => {
  const db = mockDatabase();
  t.mock.method(pool, "connect", async () => db.client);

  await assert.rejects(
    articles.transitionEditorialStatus(
      10, "approved", "published", UUID
    ),
    { status: 409 }
  );

  assert.equal(db.getUpdates(), 0);
  assert.equal(db.getOperations(), 0);
});

test("Invalid operationId is rejected", async () => {
  await assert.rejects(
    articles.transitionEditorialStatus(
      10, "in_review", "approved", "invalid-id"
    ),
    { status: 400 }
  );
});


test("Concurrent identical Editorial requests update only once", async (t) => {
  const db = mockDatabase();

  let lockQueue = Promise.resolve();

  const originalQuery = db.client.query.bind(db.client);

  db.client.query = async (sql, params = []) => {
    if (sql.includes("pg_advisory_xact_lock")) {
      let unlock;
      const current = new Promise(resolve => {
        unlock = resolve;
      });

      const previous = lockQueue;
      lockQueue = current;

      await previous;
      db.unlock = unlock;

      return { rows: [] };
    }

    if (sql === "COMMIT" || sql === "ROLLBACK") {
      const result = await originalQuery(sql, params);
      db.unlock?.();
      return result;
    }

    return originalQuery(sql, params);
  };

  t.mock.method(pool, "connect", async () => db.client);

  const [first, second] = await Promise.all([
    articles.transitionEditorialStatus(
      10, "in_review", "approved", UUID
    ),
    articles.transitionEditorialStatus(
      10, "in_review", "approved", UUID
    )
  ]);

  assert.deepEqual(first, second);
  assert.equal(db.getUpdates(), 1);
  assert.equal(db.getOperations(), 1);
});

