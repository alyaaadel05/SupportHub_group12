"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const repository = require("../services/workflowOperationRepository");

function fakePool(queryResult = { rows: [] }) {
  const calls = [];

  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return queryResult;
    },
    async connect() {
      return {
        async query(sql, params) {
          calls.push({ sql, params });

          if (sql.includes("INSERT INTO editorial_workflow_operations")) {
            return { rows: [{ operation_id: params[0], state: "pending" }] };
          }

          return { rows: [] };
        },
        release() {
          calls.push({ released: true });
        }
      };
    }
  };
}

test("createOperation inserts and commits an operation", async () => {
  const pool = fakePool();
  const operation = {
    operationId: "11111111-1111-4111-8111-111111111111",
    articleId: 10,
    operationType: "submit",
    actorId: 20,
    fromStatus: "draft",
    toStatus: "in_review"
  };

  const result = await repository.createOperation(pool, operation);

  assert.equal(result.operation_id, operation.operationId);
  assert.ok(pool.calls.some(call => call.sql === "BEGIN"));
  assert.ok(pool.calls.some(call => call.sql === "COMMIT"));
  assert.ok(pool.calls.some(call => call.released));
});

test("createOperation maps duplicate active operations to HTTP 409", async () => {
  const pool = fakePool();
  pool.connect = async () => ({
    async query(sql) {
      if (sql.includes("INSERT INTO editorial_workflow_operations")) {
        const error = new Error("duplicate key");
        error.code = "23505";
        throw error;
      }
      return { rows: [] };
    },
    release() {}
  });

  await assert.rejects(
    repository.createOperation(pool, {}),
    error => error.status === 409
  );
});

test("getOperation returns the matching operation or null", async () => {
  const pool = fakePool({ rows: [{ operation_id: "operation-1" }] });

  const result = await repository.getOperation(pool, "operation-1");

  assert.equal(result.operation_id, "operation-1");
  assert.equal(pool.calls[0].params[0], "operation-1");
});

test("claimNext uses a matching claim-token parameter", async () => {
  const pool = fakePool({ rows: [{ state: "processing" }] });

  await repository.claimNext(pool);

  const call = pool.calls[0];

  assert.match(call.sql, /claim_token = \$1/);
  assert.equal(call.params.length, 1);
  assert.match(call.params[0], /^[0-9a-f-]{36}$/i);
});

test("reschedule uses four matching parameters", async () => {
  const pool = fakePool();

  await repository.reschedule(
    pool,
    "operation-1",
    "claim-1",
    new Error("Temporary failure"),
    5000
  );

  assert.equal(pool.calls[0].params.length, 4);
  assert.match(pool.calls[0].sql, /next_attempt_at = NOW\(\) \+ \(\$4/);
});

test("requireReconciliation uses the operation and claim token", async () => {
  const pool = fakePool();

  await repository.requireReconciliation(
    pool,
    "operation-1",
    "claim-1",
    "Article status is uncertain"
  );

  assert.equal(pool.calls[0].params[0], "operation-1");
  assert.equal(pool.calls[0].params[1], "claim-1");
  assert.match(pool.calls[0].sql, /needs_reconciliation/);
});

test("claimOperation claims only the specified pending operation", async () => {
  const pool = fakePool();

  await repository.claimOperation(pool, "operation-1");

  const call = pool.calls[0];

  assert.match(call.sql, /WHERE operation_id = \$1/);
  assert.match(call.sql, /state = 'pending'/);
  assert.match(call.sql, /claim_token = \$2/);
  assert.equal(call.params[0], "operation-1");
  assert.match(call.params[1], /^[0-9a-f-]{36}$/i);
});

test("completeOperation requires the matching claim token", async () => {
  const pool = fakePool();

  await repository.completeOperation(
    pool,
    "operation-1",
    "claim-1",
    55
  );

  const call = pool.calls[0];

  assert.match(call.sql, /state = 'completed'/);
  assert.match(call.sql, /claim_token = \$2/);
  assert.match(call.sql, /result_review_id = \$3/);
  assert.deepEqual(call.params, ["operation-1", "claim-1", 55]);
});

test("failOperation requires the matching claim token", async () => {
  const pool = fakePool();

  await repository.failOperation(
    pool,
    "operation-1",
    "claim-1",
    new Error("Article Service unavailable")
  );

  const call = pool.calls[0];

  assert.match(call.sql, /state = 'failed'/);
  assert.match(call.sql, /claim_token = \$2/);
  assert.deepEqual(
    call.params,
    ["operation-1", "claim-1", "Article Service unavailable"]
  );
});

test("getActivePublication finds active publication operations for an article", async () => {
  const pool = fakePool({
    rows: [{ operation_id: "publication-1", operation_type: "publish" }]
  });

  const result = await repository.getActivePublication(pool, 42);

  assert.equal(result.operation_id, "publication-1");
  assert.equal(pool.calls[0].params[0], 42);
  assert.match(pool.calls[0].sql, /operation_type = 'publish'/);
  assert.match(pool.calls[0].sql, /needs_reconciliation/);
});

test("claimPublication reuses the persisted operation ID", async () => {
  const pool = fakePool({
    rows: [{ operation_id: "publication-1", state: "processing" }]
  });

  const result = await repository.claimPublication(
    pool,
    "publication-1"
  );

  const call = pool.calls[0];

  assert.equal(result.operation_id, "publication-1");
  assert.equal(call.params[0], "publication-1");
  assert.match(call.params[1], /^[0-9a-f-]{36}$/i);
  assert.match(call.sql, /operation_type = 'publish'/);
  assert.match(call.sql, /state = 'needs_reconciliation'/);
  assert.match(call.sql, /locked_at < NOW\(\) - INTERVAL '5 minutes'/);
});

test("claimPublication only claims an eligible publication operation", async () => {
  const pool = fakePool({ rows: [] });

  const result = await repository.claimPublication(
    pool,
    "publication-1"
  );

  assert.equal(result, null);
  assert.match(pool.calls[0].sql, /state = 'pending'/);
  assert.match(pool.calls[0].sql, /next_attempt_at <= NOW\(\)/);
});


test("claimReviewOperationForReconciliation claims only eligible review operations", async () => {
  const pool = fakePool({
    rows: [{
      operation_id: "review-operation-1",
      operation_type: "submit",
      state: "processing",
      claim_token: "new-token"
    }]
  });

  const result = await repository.claimReviewOperationForReconciliation(
    pool,
    "review-operation-1"
  );

  const call = pool.calls[0];

  assert.equal(result.operation_id, "review-operation-1");
  assert.equal(call.params[0], "review-operation-1");
  assert.match(call.params[1], /^[0-9a-f-]{36}$/i);
  assert.match(call.sql, /operation_type IN \('submit', 'decide'\)/);
  assert.match(call.sql, /state = 'needs_reconciliation'/);
  assert.match(call.sql, /state = 'processing'/);
  assert.match(call.sql, /locked_at < NOW\(\) - INTERVAL '5 minutes'/);
  assert.match(call.sql, /claim_token = \$2/);
});

test("claimReviewOperationForReconciliation returns null when no eligible operation exists", async () => {
  const pool = fakePool({ rows: [] });

  const result = await repository.claimReviewOperationForReconciliation(
    pool,
    "review-operation-1"
  );

  assert.equal(result, null);
  assert.match(pool.calls[0].sql, /operation_type IN \('submit', 'decide'\)/);
});
