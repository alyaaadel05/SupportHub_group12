
"use strict";

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");

// LOCAL Docker PostgreSQL ONLY.
// This does not use Neon or any .env database URL.
const localPool = new Pool({
  host: "127.0.0.1",
  port: 55432,
  user: "supporthub_test",
  password: "local_test_only",
  database: "supporthub_idempotency_test",
  ssl: false,
  max: 5
});

// Inject the local test pool BEFORE loading Article Service.
// This prevents Article Service from opening a Neon pool.
const poolPath = require.resolve("../../db/pool");

require.cache[poolPath] = {
  id: poolPath,
  filename: poolPath,
  loaded: true,
  exports: localPool
};

const articles = require("../../services/articleService");

async function main() {
  // Safety: ensure the test starts in the expected state.
  const before = await localPool.query(
    "SELECT status FROM articles WHERE id = 10"
  );

  assert.equal(before.rows[0]?.status, "in_review");

  const existing = await localPool.query(
    "SELECT COUNT(*)::int AS total FROM article_transition_operations"
  );

  assert.equal(existing.rows[0].total, 0);

  const operationId = randomUUID();

  console.log("1. Sending two simultaneous requests...");

  const [first, second] = await Promise.all([
    articles.transitionEditorialStatus(
      10, "in_review", "approved", operationId
    ),
    articles.transitionEditorialStatus(
      10, "in_review", "approved", operationId
    )
  ]);

  assert.equal(first.article.status, "approved");
  assert.equal(
    JSON.stringify(first),
    JSON.stringify(second)
  );

  console.log("PASS: Both requests returned the same result");

  console.log("2. Retrying the same operation...");

  const retry = await articles.transitionEditorialStatus(
    10, "in_review", "approved", operationId
  );

  assert.equal(
    JSON.stringify(retry),
    JSON.stringify(first)
  );

  console.log("PASS: Original result returned");

  console.log("3. Checking conflicting operation ID...");

  await assert.rejects(
    articles.transitionEditorialStatus(
      10, "approved", "published", operationId
    ),
    { status: 409 }
  );

  console.log("PASS: Conflicting reuse rejected");

  console.log("4. Checking incorrect expected status...");

  await assert.rejects(
    articles.transitionEditorialStatus(
      10, "draft", "in_review", randomUUID()
    ),
    { status: 409 }
  );

  console.log("PASS: Incorrect status rejected");

  console.log("5. Checking PostgreSQL records...");

  const result = await localPool.query(
    `SELECT
       (SELECT status FROM articles WHERE id = 10)
         AS status,
       (SELECT COUNT(*)::int
        FROM article_transition_operations)
         AS operations`
  );

  assert.equal(result.rows[0].status, "approved");
  assert.equal(result.rows[0].operations, 1);

  console.log("PASS: Article status =", result.rows[0].status);
  console.log("PASS: Stored operations =", result.rows[0].operations);

  console.log("\nALL REAL POSTGRESQL TESTS PASSED");
}

main()
  .catch(error => {
    console.error("TEST FAILED:", error.message);
    process.exitCode = 1;
  })
  .finally(() => localPool.end());
