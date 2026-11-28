"use strict";

// db/pool.js requires a URL at load time; these tests never connect.
process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:1/editorial_test";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createArticleEventService
} = require("../services/articleEventService");

const validEvent = {
  eventId: "event-001",
  eventType: "article.submitted",
  articleId: 42,
  submittedBy: 10
};

function createMockDatabase({ duplicate = false, existingPending = false, existingSubmitter = 10, failAt = null } = {}) {
  const calls = [];
  let released = false;

  const client = {
    async query(sql, values = []) {
      const normalized = sql.trim().replace(/\s+/g, " ");
      calls.push({ sql: normalized, values });

      if (normalized === "BEGIN" || normalized === "COMMIT" ||
          normalized === "ROLLBACK") {
        if (failAt === normalized) throw new Error(`${normalized} failed`);
        return { rows: [], rowCount: 0 };
      }

      if (normalized.startsWith("INSERT INTO editorial_event_inbox")) {
        return {
          rows: duplicate ? [] : [{ event_id: values[0] }],
          rowCount: duplicate ? 0 : 1
        };
      }

      if (normalized.startsWith("SELECT event_type, article_id, submitted_by")) {
        return {
          rows: duplicate
            ? [{
                event_type: "article.submitted",
                article_id: 42,
                submitted_by: 10
              }]
            : [],
          rowCount: duplicate ? 1 : 0
        };
      }

      if (normalized.startsWith("INSERT INTO editorial_reviews")) {
        if (failAt === "review") throw new Error("Review insert failed");

        return {
          rows: existingPending
            ? []
            : [{ review_id: 7, article_id: 42, submitted_by: 10, decision: "pending" }],
          rowCount: existingPending ? 0 : 1
        };
      }

      if (normalized.startsWith("SELECT review_id, article_id, submitted_by, decision")) {
        return {
          rows: existingPending
            ? [{
                review_id: 6,
                article_id: 42,
                submitted_by: existingSubmitter,
                decision: "pending"
              }]
            : [],
          rowCount: existingPending ? 1 : 0
        };
      }

      if (normalized.startsWith("INSERT INTO editorial_status_events")) {
        if (failAt === "history") throw new Error("History insert failed");
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected SQL: ${normalized}`);
    },

    release() {
      released = true;
    }
  };

  return {
    db: {
      async query(sql, values = []) {
        return client.query(sql, values);
      },
      async connect() {
        return client;
      }
    },
    calls,
    wasReleased: () => released
  };
}

test("processes a submitted article and commits its review", async () => {
  const mock = createMockDatabase();

  const service = createArticleEventService({
    db: mock.db,
    fetchArticle: async () => ({
      article_id: 42,
      author_id: 10,
      status: "in_review"
    })
  });

  const result = await service.processSubmittedEvent(validEvent);

  assert.equal(result.status, "processed");
  assert.equal(result.review.review_id, 7);
  assert.ok(mock.calls.some(call => call.sql === "COMMIT"));
  assert.ok(!mock.calls.some(call => call.sql === "ROLLBACK"));
  assert.equal(mock.wasReleased(), true);
});

test("acknowledges a duplicate event when Article Service is unavailable", async () => {
  const mock = createMockDatabase({ duplicate: true });

  const service = createArticleEventService({
    db: mock.db,
    fetchArticle: async () => {
      throw new Error("Article Service unavailable");
    }
  });

  const result = await service.processSubmittedEvent(validEvent);

  assert.equal(result.status, "duplicate");
  assert.equal(result.eventId, validEvent.eventId);
  assert.ok(
    mock.calls.some(call =>
      call.sql.startsWith("SELECT event_type, article_id, submitted_by")
    )
  );
  assert.ok(
    !mock.calls.some(call => call.sql === "BEGIN")
  );
});
test("does not create a second review for a duplicate event", async () => {
  const mock = createMockDatabase({ duplicate: true });

  const service = createArticleEventService({
    db: mock.db,
    fetchArticle: async () => ({
      article_id: 42,
      author_id: 10,
      status: "in_review"
    })
  });

  const result = await service.processSubmittedEvent(validEvent);

  assert.equal(result.status, "duplicate");
  assert.ok(!mock.calls.some(call => call.sql === "BEGIN"));
  assert.ok(!mock.calls.some(call =>
    call.sql.startsWith("INSERT INTO editorial_reviews")
  ));
});

test("rejects an unsupported event type before database access", async () => {
  const mock = createMockDatabase();

  const service = createArticleEventService({
    db: mock.db,
    fetchArticle: async () => {
      throw new Error("Should not fetch article");
    }
  });

  await assert.rejects(
    service.processSubmittedEvent({
      ...validEvent,
      eventType: "article.deleted"
    }),
    /Unsupported article event type/
  );

  assert.equal(mock.calls.length, 0);
});

test("rejects an event when the article author does not match", async () => {
  const mock = createMockDatabase();

  const service = createArticleEventService({
    db: mock.db,
    fetchArticle: async () => ({
      article_id: 42,
      author_id: 99,
      status: "in_review"
    })
  });

  await assert.rejects(
    service.processSubmittedEvent(validEvent),
    /does not match article author/
  );

  assert.equal(mock.calls.length, 1);
  assert.ok(mock.calls[0].sql.startsWith(
    "SELECT event_type, article_id, submitted_by"
  ));
});

test("rejects an article that is not in review", async () => {
  const mock = createMockDatabase();

  const service = createArticleEventService({
    db: mock.db,
    fetchArticle: async () => ({
      article_id: 42,
      author_id: 10,
      status: "draft"
    })
  });

  await assert.rejects(
    service.processSubmittedEvent(validEvent),
    /not in review/
  );

  assert.ok(mock.calls.some(call => call.sql === "ROLLBACK"));
  assert.ok(!mock.calls.some(call =>
    call.sql.startsWith("INSERT INTO editorial_reviews")
  ));
  assert.equal(mock.wasReleased(), true);
});

test("rolls back when review creation fails", async () => {
  const mock = createMockDatabase({ failAt: "review" });

  const service = createArticleEventService({
    db: mock.db,
    fetchArticle: async () => ({
      article_id: 42,
      author_id: 10,
      status: "in_review"
    })
  });

  await assert.rejects(
    service.processSubmittedEvent(validEvent),
    /Review insert failed/
  );

  assert.ok(mock.calls.some(call => call.sql === "ROLLBACK"));
  assert.ok(!mock.calls.some(call => call.sql === "COMMIT"));
  assert.equal(mock.wasReleased(), true);
});


test("reuses an existing pending review for another event ID", async () => {
  const mock = createMockDatabase({ existingPending: true });

  const service = createArticleEventService({
    db: mock.db,
    fetchArticle: async () => ({
      article_id: 42,
      author_id: 10,
      status: "in_review"
    })
  });

  const result = await service.processSubmittedEvent({
    ...validEvent,
    eventId: "event-002"
  });

  assert.equal(result.status, "duplicate_article");
  assert.equal(result.review.review_id, 6);
  assert.ok(mock.calls.some(call => call.sql === "COMMIT"));
  assert.ok(!mock.calls.some(call =>
    call.sql.startsWith("INSERT INTO editorial_status_events")
  ));
});

test("rejects an existing pending review with a different submitter", async () => {
  const mock = createMockDatabase({
    existingPending: true,
    existingSubmitter: 99
  });

  const service = createArticleEventService({
    db: mock.db,
    fetchArticle: async () => ({
      article_id: 42,
      author_id: 10,
      status: "in_review"
    })
  });

  await assert.rejects(
    service.processSubmittedEvent({
      ...validEvent,
      eventId: "event-003"
    }),
    /conflicting submitter details/
  );

  assert.ok(mock.calls.some(call => call.sql === "ROLLBACK"));
  assert.ok(!mock.calls.some(call => call.sql === "COMMIT"));
});


test("processes an event without submittedBy using the authoritative article author", async () => {
  const mock = createMockDatabase();

  const service = createArticleEventService({
    db: mock.db,
    fetchArticle: async () => ({
      article_id: 42,
      author_id: 10,
      status: "in_review"
    })
  });

  const { submittedBy, ...eventWithoutSubmitter } = validEvent;
  const result = await service.processSubmittedEvent(eventWithoutSubmitter);

  assert.equal(result.status, "processed");

  const inboxInsert = mock.calls.find(call =>
    call.sql.startsWith("INSERT INTO editorial_event_inbox")
  );

  assert.equal(inboxInsert.values[3], 10);
});

test("acknowledges an already processed event after the article leaves in_review", async () => {
  const mock = createMockDatabase({ duplicate: true });

  const service = createArticleEventService({
    db: mock.db,
    fetchArticle: async () => ({
      article_id: 42,
      author_id: 10,
      status: "approved"
    })
  });

  const result = await service.processSubmittedEvent(validEvent);

  assert.equal(result.status, "duplicate");
  assert.ok(!mock.calls.some(call => call.sql === "BEGIN"));
  assert.ok(!mock.calls.some(call =>
    call.sql.startsWith("INSERT INTO editorial_reviews")
  ));
});

test("rejects an article with an invalid authoritative author ID", async () => {
  const mock = createMockDatabase();

  const service = createArticleEventService({
    db: mock.db,
    fetchArticle: async () => ({
      article_id: 42,
      author_id: 0,
      status: "in_review"
    })
  });

  await assert.rejects(
    service.processSubmittedEvent({
      eventId: "event-invalid-author",
      eventType: "article.submitted",
      articleId: 42
    }),
    /Invalid article author ID/
  );

  assert.equal(mock.calls.length, 1);
  assert.ok(mock.calls[0].sql.startsWith(
    "SELECT event_type, article_id, submitted_by"
  ));
});
