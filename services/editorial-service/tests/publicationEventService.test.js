"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createPublicationEventService
} = require("../services/publicationEventService");

function createFakePool({
  claimedItem = null,
  updateRowCount = 1
} = {}) {
  const calls = [];

  return {
    calls,

    async query(sql, values = []) {
      calls.push({ sql, values });

      if (/WITH candidate AS/i.test(sql)) {
        return {
          rows: claimedItem
            ? [{
                ...claimedItem,
                claim_token: values[0]
              }]
            : [],
          rowCount: claimedItem ? 1 : 0
        };
      }

      if (/UPDATE editorial_publication_event_outbox/i.test(sql)) {
        return {
          rows: [],
          rowCount: updateRowCount
        };
      }

      throw new Error("Unexpected SQL query");
    }
  };
}

const sampleItem = {
  event_id: "123e4567-e89b-42d3-a456-426614174000",
  article_id: 42,
  event_type: "editorial.publication.published",
  payload: {
    eventId: "123e4567-e89b-42d3-a456-426614174000",
    eventType: "editorial.publication.published",
    data: {
      articleId: 42,
      publishedBy: 20
    }
  },
  attempts: 0
};

test("queues a publication event with a stable UUID and payload", async () => {
  let captured;

  const pool = {
    query: async () => ({ rows: [], rowCount: 0 })
  };

  const service = createPublicationEventService({ pool });

  const client = {
    query: async (sql, values) => {
      captured = { sql, values };

      return {
        rows: [{
          event_id: values[0],
          payload: JSON.parse(values[3])
        }],
        rowCount: 1
      };
    }
  };

  const result = await service.queuePublicationEvent(client, {
    articleId: 42,
    actorId: 20
  });

  assert.match(
    captured.values[0],
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );

  assert.equal(captured.values[1], 42);
  assert.equal(captured.values[2], "editorial.publication.published");
  assert.equal(result.payload.data.articleId, 42);
  assert.equal(result.payload.data.publishedBy, 20);
});

test("rejects a publication event without required identifiers", async () => {
  const service = createPublicationEventService({
    pool: { query: async () => ({ rows: [] }) }
  });

  await assert.rejects(
    service.queuePublicationEvent(
      { query: async () => ({ rows: [] }) },
      { articleId: 42 }
    ),
    /positive safe integers/
  );
});

test("rejects invalid publication event identifiers", async () => {
  const service = createPublicationEventService({
    pool: { query: async () => ({ rows: [] }) }
  });

  const invalidCases = [
    { articleId: -5, actorId: 20 },
    { articleId: 42, actorId: -1 },
    { articleId: "abc", actorId: 20 },
    { articleId: 42, actorId: "abc" },
    { articleId: 1.5, actorId: 20 },
    {
      articleId: 42,
      actorId: Number.MAX_SAFE_INTEGER + 1
    }
  ];

  for (const identifiers of invalidCases) {
    await assert.rejects(
      service.queuePublicationEvent(
        {
          query: async () => {
            assert.fail("Invalid IDs reached database");
          }
        },
        identifiers
      ),
      /positive safe integers/
    );
  }
});

test("publishes a claimed event and marks it published", async () => {
  const pool = createFakePool({
    claimedItem: sampleItem
  });

  let sentPayload;

  const service = createPublicationEventService({
    pool,
    publishToSns: async payload => {
      sentPayload = payload;
      return { MessageId: "sns-message-123" };
    }
  });

  const result = await service.publishOne();

  assert.equal(sentPayload.eventId, sampleItem.event_id);
  assert.equal(result.status, "published");
  assert.equal(result.messageId, "sns-message-123");

  const completion = pool.calls.find(call =>
    /SET state = 'published'/i.test(call.sql)
  );

  assert.ok(completion);
  assert.equal(completion.values[0], sampleItem.event_id);
});

test("reschedules an event after an SNS delivery failure", async () => {
  const pool = createFakePool({
    claimedItem: sampleItem
  });

  const service = createPublicationEventService({
    pool,
    publishToSns: async () => {
      throw new Error("SNS temporarily unavailable");
    }
  });

  const result = await service.publishOne();

  assert.equal(result.status, "pending");
  assert.equal(result.attempts, 1);
  assert.equal(result.retryInSeconds, 5);

  const update = pool.calls.find(call =>
    /SET state = \$3/i.test(call.sql)
  );

  assert.ok(update);
  assert.equal(update.values[2], "pending");
  assert.equal(update.values[4], "SNS temporarily unavailable");
});

test("does not publish when no event is available", async () => {
  const pool = createFakePool();

  let called = false;

  const service = createPublicationEventService({
    pool,
    publishToSns: async () => {
      called = true;
      return {};
    }
  });

  const result = await service.publishOne();

  assert.equal(result.status, "idle");
  assert.equal(called, false);
});

test("does not classify a database completion error as an SNS failure", async () => {
  let updateCalls = 0;

  const pool = {
    async query(sql, values = []) {
      if (/WITH candidate AS/i.test(sql)) {
        return {
          rows: [{
            ...sampleItem,
            claim_token: values[0]
          }],
          rowCount: 1
        };
      }

      if (/SET state = 'published'/i.test(sql)) {
        updateCalls += 1;
        throw new Error("Database unavailable");
      }

      if (/SET state = \$3/i.test(sql)) {
        assert.fail(
          "Database completion error was incorrectly treated as SNS failure"
        );
      }

      throw new Error("Unexpected SQL query");
    }
  };

  const service = createPublicationEventService({
    pool,
    publishToSns: async () => ({
      MessageId: "sns-message-123"
    })
  });

  await assert.rejects(
    service.publishOne(),
    /Database unavailable/
  );

  assert.equal(updateCalls, 1);
});

test("recovers abandoned publisher claims", async () => {
  let capturedSql;

  const pool = {
    query: async sql => {
      capturedSql = sql;
      return { rows: [], rowCount: 2 };
    }
  };

  const service = createPublicationEventService({
    pool,
    publishToSns: async () => ({})
  });

  const recovered = await service.recoverAbandoned();

  assert.equal(recovered, 2);
  assert.match(
    capturedSql,
    /locked_at < NOW\(\) - INTERVAL '5 minutes'/
  );
  assert.match(capturedSql, /state = 'pending'/);
});

test("returns claim_lost when an SNS failure cannot update the claimed event", async () => {
  const pool = createFakePool({
    claimedItem: sampleItem,
    updateRowCount: 0
  });

  const service = createPublicationEventService({
    pool,
    publishToSns: async () => {
      throw new Error("SNS temporarily unavailable");
    }
  });

  const result = await service.publishOne();

  assert.deepEqual(result, {
    status: "claim_lost"
  });

  const update = pool.calls.find(call =>
    /SET state = \$3/i.test(call.sql)
  );

  assert.ok(update);
  assert.equal(update.values[0], sampleItem.event_id);
});

test("moves an event to failed after reaching the maximum attempts", async () => {
  const pool = createFakePool({
    claimedItem: {
      ...sampleItem,
      attempts: 4
    }
  });

  const service = createPublicationEventService({
    pool,
    maxAttempts: 5,
    publishToSns: async () => {
      throw new Error("SNS permanently unavailable");
    }
  });

  const result = await service.publishOne();

  assert.deepEqual(result, {
    status: "failed",
    attempts: 5,
    retryInSeconds: null
  });

  const update = pool.calls.find(call =>
    /SET state = \$3/i.test(call.sql)
  );

  assert.ok(update);
  assert.equal(update.values[2], "failed");
  assert.equal(update.values[3], 80);
  assert.equal(update.values[4], "SNS permanently unavailable");
});

test("increases retry delay using exponential backoff", async () => {
  const pool = createFakePool({
    claimedItem: {
      ...sampleItem,
      attempts: 1
    }
  });

  const service = createPublicationEventService({
    pool,
    maxAttempts: 5,
    publishToSns: async () => {
      throw new Error("SNS temporarily unavailable");
    }
  });

  const result = await service.publishOne();

  assert.equal(result.status, "pending");
  assert.equal(result.attempts, 2);
  assert.equal(result.retryInSeconds, 10);

  const update = pool.calls.find(call =>
    /SET state = \$3/i.test(call.sql)
  );

  assert.ok(update);
  assert.equal(update.values[2], "pending");
  assert.equal(update.values[3], 10);
});
// ---- Phase 4: recovery of SNS events whose retries were exhausted ----

test("requeueFailed returns failed events to pending with a fresh retry budget", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ event_id: "35b3c114-4834-47c8-8bbe-5ebb901f7ebe" }] };
    }
  };

  const service = createPublicationEventService({ pool });
  const result = await service.requeueFailed({
    eventId: "35b3c114-4834-47c8-8bbe-5ebb901f7ebe"
  });

  assert.equal(result.requeued, 1);
  assert.deepEqual(result.eventIds, ["35b3c114-4834-47c8-8bbe-5ebb901f7ebe"]);
  assert.match(calls[0].sql, /state = 'failed'/);
  assert.match(calls[0].sql, /SET state = 'pending'/);
  assert.match(calls[0].sql, /attempts = 0/);
  assert.equal(calls[0].params[0], "35b3c114-4834-47c8-8bbe-5ebb901f7ebe");
});

test("requeueFailed without eventId requeues all failed events (bounded)", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    }
  };

  const service = createPublicationEventService({ pool });
  const result = await service.requeueFailed({ limit: 1000 });

  assert.equal(result.requeued, 0);
  assert.equal(calls[0].params[0], null);
  assert.equal(calls[0].params[1], 100);
});

test("requeueFailed rejects an invalid eventId without touching the database", async () => {
  const pool = { async query() { throw new Error("must not query"); } };
  const service = createPublicationEventService({ pool });

  await assert.rejects(
    service.requeueFailed({ eventId: "1; DROP TABLE x" }),
    error => error.status === 400
  );
});
