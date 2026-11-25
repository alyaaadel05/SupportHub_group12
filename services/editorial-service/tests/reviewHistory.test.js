"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../db/pool");
const reviews = require("../services/reviewService");

test("history retrieves events for the requested article in chronological order", async (t) => {
  const expectedRows = [
    {
      event_id: 1,
      article_id: 42,
      actor_id: 10,
      previous_status: "draft",
      new_status: "in_review"
    },
    {
      event_id: 2,
      article_id: 42,
      actor_id: 20,
      previous_status: "in_review",
      new_status: "approved"
    }
  ];

  const query = t.mock.method(
    pool,
    "query",
    async () => ({ rows: expectedRows })
  );

  const result = await reviews.history(42);

  assert.deepEqual(result, expectedRows);
  assert.equal(query.mock.calls.length, 1);

  const [sql, values] = query.mock.calls[0].arguments;

  assert.match(sql, /FROM editorial_status_events/i);
  assert.match(sql, /WHERE article_id = \$1/i);
  assert.match(sql, /ORDER BY created_at ASC, event_id ASC/i);
  assert.deepEqual(values, [42]);
});

test("history returns an empty array when no events exist", async (t) => {
  t.mock.method(
    pool,
    "query",
    async () => ({ rows: [] })
  );

  const result = await reviews.history(999);

  assert.deepEqual(result, []);
});
