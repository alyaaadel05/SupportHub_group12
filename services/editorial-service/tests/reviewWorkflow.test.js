"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/editorial_test";

const pool = require("../db/pool");
const serviceClient = require("../services/serviceClient");
const repository = require("../services/workflowOperationRepository");

const original = {
  getArticle: serviceClient.getArticle,
  transitionArticle: serviceClient.transitionArticle,
  createOperation: repository.createOperation,
  claimOperation: repository.claimOperation,
  failOperation: repository.failOperation,
  requireReconciliation: repository.requireReconciliation,
  claimReviewOperationForReconciliation: repository.claimReviewOperationForReconciliation,
  getOperation: repository.getOperation,
  query: pool.query,
  connect: pool.connect
};

function loadReviews() {
  const modulePath = require.resolve("../services/reviewService");
  delete require.cache[modulePath];
  return require(modulePath);
}

function restore() {
  Object.assign(serviceClient, {
    getArticle: original.getArticle,
    transitionArticle: original.transitionArticle
  });

  Object.assign(repository, {
    createOperation: original.createOperation,
    claimOperation: original.claimOperation,
    failOperation: original.failOperation,
    requireReconciliation: original.requireReconciliation,
    claimReviewOperationForReconciliation: original.claimReviewOperationForReconciliation,
    getOperation: original.getOperation
  });

  pool.query = original.query;
  pool.connect = original.connect;
}

function mockFinalization(t, reviewId = 101) {
  const statements = [];

  const client = {
    query: async (sql, values = []) => {
      statements.push({ sql, values });

      if (/INSERT INTO editorial_reviews/i.test(sql)) {
        return {
          rows: [{
            review_id: reviewId,
            article_id: 42,
            submitted_by: 10,
            decision: "pending"
          }],
          rowCount: 1
        };
      }

      if (/UPDATE editorial_reviews/i.test(sql)) {
        return {
          rows: [{
            review_id: reviewId,
            article_id: 42,
            decision: values[0],
            reviewer_id: values[1],
            comments: values[2]
          }],
          rowCount: 1
        };
      }

      if (/UPDATE editorial_workflow_operations/i.test(sql)) {
        return { rows: [{ operation_id: values[0] }], rowCount: 1 };
      }

      return { rows: [], rowCount: 1 };
    },
    release: () => {}
  };

  t.mock.method(pool, "connect", async () => client);

  return statements;
}

function mockOperationCreation(t) {
  const created = [];
  const claimToken = "claim-token-123";

  t.mock.method(repository, "createOperation", async (_pool, operation) => {
    created.push(operation);
    return operation;
  });

  t.mock.method(repository, "claimOperation", async () => ({
    claim_token: claimToken
  }));

  return { created, claimToken };
}

test("submit creates an operation and finalizes the pending review", async (t) => {
  const { created, claimToken } = mockOperationCreation(t);
  const statements = mockFinalization(t);

  t.mock.method(serviceClient, "getArticle", async () => ({
    id: 42,
    author_id: 10,
    status: "draft",
    title: "Test article",
    content: "Article content",
    category_id: 2
  }));

  let transitionArguments;

  t.mock.method(serviceClient, "transitionArticle", async (...args) => {
    transitionArguments = args;
    return { id: 42, status: "in_review" };
  });

  const result = await loadReviews().submit(42, { id: 10 });

  assert.equal(result.review_id, 101);
  assert.equal(created.length, 1);
  assert.equal(created[0].operationType, "submit");
  assert.equal(created[0].fromStatus, "draft");
  assert.equal(created[0].toStatus, "in_review");
  assert.equal(transitionArguments[3], created[0].operationId);
  assert.equal(transitionArguments[3].length, 36);
  assert.ok(statements.some(item => /editorial_status_events/i.test(item.sql)));
  assert.ok(statements.some(item => /editorial_workflow_operations/i.test(item.sql)));
  assert.ok(claimToken);
  restore();
});

test("submit rejects an article owned by another author", async (t) => {
  t.mock.method(serviceClient, "getArticle", async () => ({
    id: 42,
    author_id: 99,
    status: "draft",
    title: "Test",
    content: "Content",
    category_id: 2
  }));

  await assert.rejects(
    loadReviews().submit(42, { id: 10 }),
    error => error.status === 403
  );

  restore();
});

test("decide approves a pending review and records history", async (t) => {
  const { created } = mockOperationCreation(t);
  const statements = mockFinalization(t);

  t.mock.method(pool, "query", async sql => {
    if (/FROM editorial_reviews/i.test(sql)) {
      return {
        rows: [{
          review_id: 101,
          article_id: 42,
          submitted_by: 10,
          decision: "pending"
        }]
      };
    }

    return { rows: [] };
  });

  t.mock.method(serviceClient, "getArticle", async () => ({
    id: 42,
    author_id: 10,
    status: "in_review"
  }));

  let transitionArguments;

  t.mock.method(serviceClient, "transitionArticle", async (...args) => {
    transitionArguments = args;
    return { id: 42, status: "approved" };
  });

  const result = await loadReviews().decide(
    42,
    { id: 20 },
    { decision: "approved", comments: "Looks good" }
  );

  assert.equal(result.decision, "approved");
  assert.equal(created[0].operationType, "decide");
  assert.equal(created[0].toStatus, "approved");
  assert.equal(transitionArguments[3], created[0].operationId);
  assert.ok(statements.some(item => /editorial_status_events/i.test(item.sql)));
  restore();
});

test("decide rejects with an explanation and returns the article to draft", async (t) => {
  const { created } = mockOperationCreation(t);
  mockFinalization(t);

  t.mock.method(pool, "query", async sql => {
    if (/FROM editorial_reviews/i.test(sql)) {
      return {
        rows: [{
          review_id: 101,
          article_id: 42,
          submitted_by: 10,
          decision: "pending"
        }]
      };
    }

    return { rows: [] };
  });

  t.mock.method(serviceClient, "getArticle", async () => ({
    id: 42,
    author_id: 10,
    status: "in_review"
  }));

  t.mock.method(serviceClient, "transitionArticle", async () => ({
    id: 42,
    status: "draft"
  }));

  const result = await loadReviews().decide(
    42,
    { id: 20 },
    { decision: "rejected", comments: "Please correct the references" }
  );

  assert.equal(result.decision, "rejected");
  assert.equal(created[0].toStatus, "draft");
  assert.equal(created[0].comments, "Please correct the references");
  restore();
});

test("decide prevents authors from reviewing their own articles", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{
      review_id: 101,
      article_id: 42,
      submitted_by: 10,
      decision: "pending"
    }]
  }));

  t.mock.method(serviceClient, "getArticle", async () => ({
    id: 42,
    author_id: 20,
    status: "in_review"
  }));

  await assert.rejects(
    loadReviews().decide(42, { id: 20 }, { decision: "approved" }),
    error => error.status === 403
  );

  restore();
});

test("decide requires an explanation for rejection", async (t) => {
  await assert.rejects(
    loadReviews().decide(42, { id: 20 }, { decision: "rejected" }),
    error => error.status === 400
  );

  restore();
});

test("uncertain Article Service failures require reconciliation", async (t) => {
  const { claimToken } = mockOperationCreation(t);
  const reconciliation = t.mock.method(
    repository,
    "requireReconciliation",
    async () => ({ state: "needs_reconciliation" })
  );

  t.mock.method(serviceClient, "getArticle", async () => ({
    id: 42,
    author_id: 10,
    status: "draft",
    title: "Test",
    content: "Content",
    category_id: 2
  }));

  t.mock.method(serviceClient, "transitionArticle", async () => {
    const error = new Error("Request timed out");
    error.code = "ETIMEDOUT";
    throw error;
  });

  await assert.rejects(
    loadReviews().submit(42, { id: 10 }),
    /Request timed out/
  );

  assert.equal(reconciliation.mock.calls.length, 1);
  assert.equal(reconciliation.mock.calls[0].arguments[2], claimToken);
  restore();
});

test("definite Article Service rejections fail the operation", async (t) => {
  mockOperationCreation(t);

  const failed = t.mock.method(
    repository,
    "failOperation",
    async () => ({ state: "failed" })
  );

  t.mock.method(serviceClient, "getArticle", async () => ({
    id: 42,
    author_id: 10,
    status: "draft",
    title: "Test",
    content: "Content",
    category_id: 2
  }));

  t.mock.method(serviceClient, "transitionArticle", async () => {
    const error = new Error("Invalid article transition");
    error.status = 409;
    throw error;
  });

  await assert.rejects(
    loadReviews().submit(42, { id: 10 }),
    /Invalid article transition/
  );

  assert.equal(failed.mock.calls.length, 1);
  restore();
});


test("reconcileReviewOperation finalizes a submission without repeating the remote transition", async t => {
  const operationId = "123e4567-e89b-42d3-a456-426614174000";
  t.mock.method(repository, "getOperation", async () => null);
  const claimToken = "reconciliation-claim-1";

  t.mock.method(repository, "claimReviewOperationForReconciliation", async () => ({
    operation_id: operationId,
    article_id: 42,
    operation_type: "submit",
    actor_id: 10,
    from_status: "draft",
    to_status: "in_review",
    decision: null,
    comments: "",
    claim_token: claimToken
  }));

  t.mock.method(serviceClient, "getArticle", async () => ({
    id: 42,
    author_id: 10,
    status: "in_review"
  }));

  const transition = t.mock.method(
    serviceClient,
    "transitionArticle",
    async () => {
      throw new Error("Remote transition must not be repeated");
    }
  );

  const statements = mockFinalization(t, 101);

  const result = await loadReviews().reconcileReviewOperation(operationId);

  assert.equal(result.state, "completed");
  assert.equal(result.action, "submission_finalized");
  assert.equal(result.review.review_id, 101);
  assert.equal(transition.mock.calls.length, 0);

  assert.ok(statements.some(item =>
    /INSERT INTO editorial_reviews/i.test(item.sql)
  ));
  assert.ok(statements.some(item =>
    /INSERT INTO editorial_status_events/i.test(item.sql)
  ));
  assert.ok(statements.some(item =>
    /UPDATE editorial_workflow_operations/i.test(item.sql)
  ));
});

test("reconcileReviewOperation finalizes an approval without repeating the remote transition", async t => {
  const operationId = "123e4567-e89b-42d3-a456-426614174001";
  t.mock.method(repository, "getOperation", async () => null);
  const claimToken = "reconciliation-claim-2";

  t.mock.method(repository, "claimReviewOperationForReconciliation", async () => ({
    operation_id: operationId,
    article_id: 42,
    operation_type: "decide",
    actor_id: 20,
    from_status: "in_review",
    to_status: "approved",
    decision: "approved",
    comments: "Looks good",
    claim_token: claimToken
  }));

  t.mock.method(serviceClient, "getArticle", async () => ({
    id: 42,
    author_id: 10,
    status: "approved"
  }));

  const transition = t.mock.method(
    serviceClient,
    "transitionArticle",
    async () => {
      throw new Error("Remote transition must not be repeated");
    }
  );

  pool.query = async sql => {
    if (/SELECT \*/i.test(sql) && /editorial_reviews/i.test(sql)) {
      return {
        rows: [{
          review_id: 101,
          article_id: 42,
          submitted_by: 10,
          decision: "pending"
        }],
        rowCount: 1
      };
    }

    return { rows: [], rowCount: 0 };
  };

  const statements = mockFinalization(t, 101);

  const result = await loadReviews().reconcileReviewOperation(operationId);

  assert.equal(result.state, "completed");
  assert.equal(result.action, "decision_finalized");
  assert.equal(result.review.decision, "approved");
  assert.equal(result.review.reviewer_id, 20);
  assert.equal(result.review.comments, "Looks good");
  assert.equal(transition.mock.calls.length, 0);

  const decisionUpdate = statements.find(item =>
    /UPDATE editorial_reviews/i.test(item.sql)
  );

  assert.ok(decisionUpdate);
  assert.equal(decisionUpdate.values[0], "approved");
  assert.equal(decisionUpdate.values[1], 20);
  assert.equal(decisionUpdate.values[2], "Looks good");
});

test("reconcileReviewOperation leaves the operation unresolved when remote status does not match", async t => {
  const operationId = "123e4567-e89b-42d3-a456-426614174002";
  t.mock.method(repository, "getOperation", async () => null);
  const claimToken = "reconciliation-claim-3";

  t.mock.method(repository, "claimReviewOperationForReconciliation", async () => ({
    operation_id: operationId,
    article_id: 42,
    operation_type: "submit",
    actor_id: 10,
    from_status: "draft",
    to_status: "in_review",
    decision: null,
    comments: "",
    claim_token: claimToken
  }));

  t.mock.method(serviceClient, "getArticle", async () => ({
    id: 42,
    author_id: 10,
    status: "draft"
  }));

  const transition = t.mock.method(
    serviceClient,
    "transitionArticle",
    async () => {
      throw new Error("Remote transition must not be called");
    }
  );

  const reconciliation = t.mock.method(
    repository,
    "requireReconciliation",
    async () => ({ state: "needs_reconciliation" })
  );

  await assert.rejects(
    loadReviews().reconcileReviewOperation(operationId),
    error =>
      error.status === 409 &&
      /expected 'in_review'/i.test(error.message)
  );

  assert.equal(transition.mock.calls.length, 0);
  assert.equal(reconciliation.mock.calls.length, 1);
  assert.equal(reconciliation.mock.calls[0].arguments[1], operationId);
  assert.equal(reconciliation.mock.calls[0].arguments[2], claimToken);
});

test("reconcileReviewOperation rejects an invalid operation ID", async t => {
  const claim = t.mock.method(
    repository,
    "claimReviewOperationForReconciliation",
    async () => null
  );

  await assert.rejects(
    loadReviews().reconcileReviewOperation("not-a-uuid"),
    error =>
      error.status === 400 &&
      /valid workflow operation ID/i.test(error.message)
  );

  assert.equal(claim.mock.calls.length, 0);
});

test("reconcileReviewOperation rejects when the operation cannot be claimed", async t => {
  t.mock.method(repository, "getOperation", async () => null);
  const claim = t.mock.method(
    repository,
    "claimReviewOperationForReconciliation",
    async () => null
  );

  await assert.rejects(
    loadReviews().reconcileReviewOperation(
      "123e4567-e89b-42d3-a456-426614174003"
    ),
    error =>
      error.status === 409 &&
      /not awaiting reconciliation/i.test(error.message)
  );

  assert.equal(claim.mock.calls.length, 1);
});


test("queue defaults to pending and retrieves articles", async t => {
  let queryCall;

  t.mock.method(pool, "query", async (sql, values) => {
    queryCall = { sql, values };

    return {
      rows: [{
        review_id: 101,
        article_id: 42,
        decision: "pending"
      }],
      rowCount: 1
    };
  });

  t.mock.method(serviceClient, "getArticle", async articleId => ({
    id: articleId,
    title: "Test article"
  }));

  const reviews = loadReviews();
  const result = await reviews.queue();

  assert.equal(queryCall.values[0], "pending");
  assert.match(queryCall.sql, /ORDER BY created_at DESC/i);
  assert.match(queryCall.sql, /LIMIT 100/i);

  assert.equal(result.length, 1);
  assert.equal(result[0].article.id, 42);
});

test("queue accepts approved and rejected statuses", async t => {
  const requestedStatuses = [];

  t.mock.method(pool, "query", async (_sql, values) => {
    requestedStatuses.push(values[0]);

    return { rows: [], rowCount: 0 };
  });

  const reviews = loadReviews();

  for (const status of ["approved", "rejected"]) {
    await reviews.queue(status);
  }

  assert.deepEqual(requestedStatuses, ["approved", "rejected"]);
});

test("queue rejects invalid status without querying the database", async t => {
  const query = t.mock.method(pool, "query", async () => {
    throw new Error("Database should not be queried");
  });

  await assert.rejects(
    loadReviews().queue("invalid"),
    error =>
      error.status === 400 &&
      error.message === "Invalid review status"
  );

  assert.equal(query.mock.calls.length, 0);
});

test("queue excludes reviews whose articles no longer exist", async t => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      { review_id: 101, article_id: 42, decision: "pending" },
      { review_id: 102, article_id: 43, decision: "pending" }
    ],
    rowCount: 2
  }));

  t.mock.method(serviceClient, "getArticle", async articleId => {
    if (articleId === 42) {
      return { id: 42, title: "Existing article" };
    }

    return null;
  });

  const result = await loadReviews().queue("pending");

  assert.equal(result.length, 1);
  assert.equal(result[0].article_id, 42);
});


test.afterEach(() => {
  restore();
});
