"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createHandler
} = require("../lambda/publicationOutcome");

const publicationEvent = {
  eventId: "123e4567-e89b-42d3-a456-426614174000",
  eventType: "editorial.publication.published",
  occurredAt: "2026-11-20T12:00:00.000Z",
  data: {
    articleId: 42,
    publishedBy: 20
  }
};

function snsRecord(event) {
  return {
    Sns: {
      Message: JSON.stringify(event)
    }
  };
}

function createPool(rowCount = 1) {
  const calls = [];

  return {
    calls,
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [], rowCount };
    }
  };
}

test("records a valid SNS publication event", async () => {
  const pool = createPool();
  const handler = createHandler({ pool });

  const result = await handler({
    Records: [snsRecord(publicationEvent)]
  });

  assert.equal(result.processed, 1);
  assert.equal(result.duplicates, 0);
  assert.equal(result.results[0].status, "processed");

  assert.equal(pool.calls.length, 1);
  assert.deepEqual(pool.calls[0].values, [
    publicationEvent.eventId,
    publicationEvent.eventType,
    42
  ]);
  assert.match(pool.calls[0].sql, /ON CONFLICT \(event_id\) DO NOTHING/);
});

test("identifies a duplicate event without processing it twice", async () => {
  const pool = createPool(0);
  const handler = createHandler({ pool });

  const result = await handler({
    Records: [snsRecord(publicationEvent)]
  });

  assert.equal(result.processed, 0);
  assert.equal(result.duplicates, 1);
  assert.equal(result.results[0].status, "duplicate");
});

test("rejects malformed JSON", async () => {
  const handler = createHandler({ pool: createPool() });

  await assert.rejects(
    handler({ Records: [{ Sns: { Message: "not-json" } }] }),
    /invalid JSON/
  );
});

test("rejects an unsupported event type", async () => {
  const handler = createHandler({ pool: createPool() });

  await assert.rejects(
    handler({
      Records: [snsRecord({
        ...publicationEvent,
        eventType: "unknown.event"
      })]
    }),
    /Unsupported publication event type/
  );
});

test("rejects an invalid event ID", async () => {
  const handler = createHandler({ pool: createPool() });

  await assert.rejects(
    handler({
      Records: [snsRecord({
        ...publicationEvent,
        eventId: "invalid"
      })]
    }),
    /Invalid publication event ID/
  );
});

test("rejects invalid article identifiers", async () => {
  const handler = createHandler({ pool: createPool() });

  await assert.rejects(
    handler({
      Records: [snsRecord({
        ...publicationEvent,
        data: {
          ...publicationEvent.data,
          articleId: -1
        }
      })]
    }),
    /Invalid publication event identifiers/
  );
});

test("propagates database failures for SNS retry", async () => {
  const pool = {
    query: async () => {
      throw new Error("Database unavailable");
    }
  };

  const handler = createHandler({ pool });

  await assert.rejects(
    handler({ Records: [snsRecord(publicationEvent)] }),
    /Database unavailable/
  );
});

test("rejects empty SNS batches", async () => {
  const handler = createHandler({ pool: createPool() });

  await assert.rejects(
    handler({ Records: [] }),
    /at least one record/
  );
});
