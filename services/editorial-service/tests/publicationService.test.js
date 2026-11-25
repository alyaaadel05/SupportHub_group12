"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/editorial_test";

const pool = require("../db/pool");
const serviceClient = require("../services/serviceClient");
const repository = require("../services/workflowOperationRepository");
const notifications = require("../services/notificationService");

const claimToken = "publication-claim-token";
const operation = {
  operation_id: "publication-operation-123",
  article_id: 42,
  actor_id: 20,
  operation_type: "publish",
  state: "pending"
};

function loadPublicationService() {
  const modulePath = require.resolve("../services/publicationService");
  delete require.cache[modulePath];
  return require(modulePath);
}

function mockApprovedArticle(t, overrides = {}) {
  t.mock.method(serviceClient, "getArticle", async () => ({
    id: 42,
    author_id: 10,
    status: "approved",
    ...overrides
  }));
}

function mockPublicationDependencies(t, options = {}) {
  const statements = [];

  t.mock.method(pool, "query", async sql => {
    statements.push(sql);

    if (/FROM editorial_reviews/i.test(sql)) {
      return {
        rows: options.approved === false ? [] : [{ review_id: 101 }],
        rowCount: options.approved === false ? 0 : 1
      };
    }

    return { rows: [], rowCount: 0 };
  });

  t.mock.method(repository, "getActivePublication", async () => (
    options.activeOperation || null
  ));

  t.mock.method(repository, "getOperation", async () => (
    options.reconcileOperation || null
  ));

  t.mock.method(repository, "createOperation", async (_pool, value) => ({
    ...operation,
    operation_id: value.operationId,
    article_id: value.articleId,
    actor_id: value.actorId,
    state: "pending"
  }));

  t.mock.method(repository, "claimPublication", async () => (
    options.claim === false
      ? null
      : { ...operation, claim_token: claimToken }
  ));

  const failed = t.mock.method(
    repository,
    "failOperation",
    async () => ({ state: "failed" })
  );

  const reconciliation = t.mock.method(
    repository,
    "requireReconciliation",
    async () => ({ state: "needs_reconciliation" })
  );

  const transition = t.mock.method(serviceClient, "transitionArticle", async () => ({
    id: 42,
    status: "published"
  }));

  t.mock.method(notifications, "queueNotification", async () => ({
    outbox_id: 900
  }));

  t.mock.method(notifications, "attempt", async () => ({
    status: "delivered"
  }));

  const client = {
    query: async (sql, values = []) => {
      statements.push(sql);

      if (/SELECT event_id/i.test(sql)) {
        return { rows: [], rowCount: 0 };
      }

      if (/UPDATE editorial_workflow_operations/i.test(sql)) {
        return { rows: [{ operation_id: values[0] }], rowCount: 1 };
      }

      return { rows: [], rowCount: 1 };
    },
    release: () => {}
  };

  t.mock.method(pool, "connect", async () => client);

  return { statements, failed, reconciliation, transition };
}

test("publish records the publication event and queues notification", async t => {
  const { statements } = mockPublicationDependencies(t);
  mockApprovedArticle(t);

  const result = await loadPublicationService().publish(42, { id: 20 });

  assert.equal(result.articleId, 42);
  assert.equal(result.status, "published");
  assert.equal(result.searchable, true);
  assert.equal(result.deliveryStatus, "delivered");

  assert.ok(statements.some(sql => /editorial_reviews/i.test(sql)));
  assert.ok(statements.some(sql => /editorial_status_events/i.test(sql)));
});

test("publish rejects an article without an approved review", async t => {
  mockPublicationDependencies(t, { approved: false });
  mockApprovedArticle(t);

  await assert.rejects(
    loadPublicationService().publish(42, { id: 20 }),
    error => error.status === 409 && /approved review/i.test(error.message)
  );
});

test("publish prevents authors from publishing their own articles", async t => {
  mockPublicationDependencies(t);
  mockApprovedArticle(t, { author_id: 20 });

  await assert.rejects(
    loadPublicationService().publish(42, { id: 20 }),
    error => error.status === 403 && /own article/i.test(error.message)
  );
});

test("uncertain Article Service failures require reconciliation", async t => {
  const { reconciliation } = mockPublicationDependencies(t);
  mockApprovedArticle(t);

  t.mock.method(serviceClient, "transitionArticle", async () => {
    const error = new Error("Request timed out");
    error.code = "ETIMEDOUT";
    throw error;
  });

  await assert.rejects(
    loadPublicationService().publish(42, { id: 20 }),
    /Request timed out/
  );

  assert.equal(reconciliation.mock.calls.length, 1);
  assert.match(reconciliation.mock.calls[0].arguments[1], /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.equal(reconciliation.mock.calls[0].arguments[2], claimToken);
});

test("definite Article Service rejections fail the publication operation", async t => {
  const { failed, reconciliation } = mockPublicationDependencies(t);
  mockApprovedArticle(t);

  t.mock.method(serviceClient, "transitionArticle", async () => {
    const error = new Error("Invalid article transition");
    error.status = 409;
    throw error;
  });

  await assert.rejects(
    loadPublicationService().publish(42, { id: 20 }),
    /Invalid article transition/
  );

  assert.equal(failed.mock.calls.length, 1);
  assert.equal(reconciliation.mock.calls.length, 0);
});

test("publication requiring reconciliation cannot be retried automatically", async t => {
  const activeOperation = {
    ...operation,
    state: "needs_reconciliation"
  };

  mockPublicationDependencies(t, { activeOperation });
  mockApprovedArticle(t, { status: "published" });

  await assert.rejects(
    loadPublicationService().publish(42, { id: 20 }),
    error => error.status === 409 && /reconciliation/i.test(error.message)
  );
});


const reconciliationOperation = {
  ...operation,
  operation_id: "123e4567-e89b-42d3-a456-426614174000",
  operation_type: "publish",
  state: "needs_reconciliation"
};

test("reconciliation finalizes an article already published remotely", async t => {
  const { statements, transition } = mockPublicationDependencies(t, {
    reconcileOperation: reconciliationOperation
  });
  mockApprovedArticle(t, { status: "published" });

  const result = await loadPublicationService().reconcilePublication(
    reconciliationOperation.operation_id
  );

  assert.equal(result.status, "published");
  assert.equal(result.reconciled, true);
  assert.equal(result.deliveryStatus, "delivered");
  assert.equal(transition.mock.calls.length, 0);
  assert.ok(statements.some(sql => /editorial_status_events/i.test(sql)));
});

test("reconciliation transitions an approved remote article before finalizing", async t => {
  const { transition } = mockPublicationDependencies(t, {
    reconcileOperation: reconciliationOperation
  });
  mockApprovedArticle(t, { status: "approved" });

  const result = await loadPublicationService().reconcilePublication(
    reconciliationOperation.operation_id
  );

  assert.equal(result.status, "published");
  assert.equal(result.reconciled, true);
  assert.equal(transition.mock.calls.length, 1);
  assert.deepEqual(
    transition.mock.calls[0].arguments,
    [
      reconciliationOperation.article_id,
      "approved",
      "published",
      reconciliationOperation.operation_id
    ]
  );
});

test("reconciliation refuses unexpected remote article status", async t => {
  const { reconciliation, transition } = mockPublicationDependencies(t, {
    reconcileOperation: reconciliationOperation
  });
  mockApprovedArticle(t, { status: "draft" });

  await assert.rejects(
    loadPublicationService().reconcilePublication(
      reconciliationOperation.operation_id
    ),
    error => error.status === 409 && /cannot reconcile/i.test(error.message)
  );

  assert.equal(transition.mock.calls.length, 0);
  assert.equal(reconciliation.mock.calls.length, 1);
});

test("reconciliation refuses an operation that cannot be claimed", async t => {
  mockPublicationDependencies(t, {
    reconcileOperation: reconciliationOperation,
    claim: false
  });

  await assert.rejects(
    loadPublicationService().reconcilePublication(
      reconciliationOperation.operation_id
    ),
    error => error.status === 409 && /could not be claimed/i.test(error.message)
  );
});
test.afterEach(() => {
  const modulePath = require.resolve("../services/publicationService");
  delete require.cache[modulePath];
});
