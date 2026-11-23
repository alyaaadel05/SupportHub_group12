
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../db/pool");
const articles = require("../services/articleService");

function mockArticleDatabase() {
  let status = "draft";
  let eventCount = 0;
  const queries = [];

  const client = {
    async query(sql, params = []) {
      queries.push(sql);

      if (sql.includes("UPDATE articles")) {
        const [to, id, from, role, userId] = params;

        // Simulate PostgreSQL's status and ownership
        // restrictions for article 10, owned by user 5.
        const allowed =
          id === 10 &&
          status === from &&
          (role === "admin" || userId === 5) &&
          sql.includes("author_id = $5");

        if (!allowed) {
          return { rowCount: 0, rows: [] };
        }

        status = to;

        return {
          rowCount: 1,
          rows: [{ id: 10, author_id: 5, status }]
        };
      }

      if (sql.includes("INSERT INTO article_event_outbox")) {
        eventCount++;
        return { rowCount: 1, rows: [] };
      }

      return { rowCount: 1, rows: [] };
    },

    release() {}
  };

  return {
    client,
    queries,
    getStatus: () => status,
    getEventCount: () => eventCount
  };
}

test("Another author cannot submit someone else's draft", async (t) => {
  const db = mockArticleDatabase();

  t.mock.method(pool, "connect", async () => db.client);

  const result = await articles.transitionStatus(
    10,
    "draft",
    "in_review",
    { id: 99, role: "author" }
  );

  assert.equal(result, null);
  assert.equal(db.getStatus(), "draft");
  assert.equal(db.getEventCount(), 0);
  assert.ok(db.queries.includes("ROLLBACK"));
});

test("Owner submission creates one outbox event", async (t) => {
  const db = mockArticleDatabase();

  t.mock.method(pool, "connect", async () => db.client);

  const result = await articles.transitionStatus(
    10,
    "draft",
    "in_review",
    { id: 5, role: "author" }
  );

  assert.equal(result.status, "in_review");
  assert.equal(db.getEventCount(), 1);
  assert.ok(db.queries.includes("COMMIT"));
});

test("Repeated submission does not create duplicate events", async (t) => {
  const db = mockArticleDatabase();

  t.mock.method(pool, "connect", async () => db.client);

  const author = { id: 5, role: "author" };

  const first = await articles.transitionStatus(
    10,
    "draft",
    "in_review",
    author
  );

  const second = await articles.transitionStatus(
    10,
    "draft",
    "in_review",
    author
  );

  assert.equal(first.status, "in_review");
  assert.equal(second, null);
  assert.equal(db.getEventCount(), 1);
  assert.equal(db.getStatus(), "in_review");
});
