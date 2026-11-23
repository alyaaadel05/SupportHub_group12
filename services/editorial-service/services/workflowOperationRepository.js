"use strict";

const crypto = require("node:crypto");

async function createOperation(pool, operation) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO editorial_workflow_operations (
         operation_id, article_id, operation_type, actor_id,
         from_status, to_status, decision, comments
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        operation.operationId,
        operation.articleId,
        operation.operationType,
        operation.actorId,
        operation.fromStatus,
        operation.toStatus,
        operation.decision ?? null,
        operation.comments ?? ""
      ]
    );

    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23505") {
      const conflict = new Error(
        "An active workflow operation already exists for this article"
      );
      conflict.status = 409;
      throw conflict;
    }

    throw error;
  } finally {
    client.release();
  }
}

async function getOperation(pool, operationId) {
  const result = await pool.query(
    `SELECT * FROM editorial_workflow_operations
     WHERE operation_id = $1`,
    [operationId]
  );

  return result.rows[0] || null;
}

async function claimNext(pool) {
  const claimToken = crypto.randomUUID();

  const result = await pool.query(
    `WITH candidate AS (
       SELECT operation_id
       FROM editorial_workflow_operations
       WHERE state = 'pending'
         AND next_attempt_at <= NOW()
       ORDER BY next_attempt_at ASC, created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE editorial_workflow_operations AS operation
     SET state = 'processing',
         attempts = operation.attempts + 1,
         locked_at = NOW(),
         claim_token = $1,
         updated_at = NOW()
     FROM candidate
     WHERE operation.operation_id = candidate.operation_id
     RETURNING operation.*`,
    [claimToken]
  );

  return result.rows[0] || null;
}

async function reschedule(pool, operationId, claimToken, error, delayMilliseconds) {
  const result = await pool.query(
    `UPDATE editorial_workflow_operations
     SET state = 'pending',
         next_attempt_at = NOW() + ($4 * INTERVAL '1 millisecond'),
         locked_at = NULL,
         claim_token = NULL,
         last_error = $3,
         updated_at = NOW()
     WHERE operation_id = $1
       AND claim_token = $2
       AND state = 'processing'
     RETURNING *`,
    [
      operationId,
      claimToken,
      String(error?.message || error || "Unknown error").slice(0, 2000),
      delayMilliseconds
    ]
  );

  return result.rows[0] || null;
}

async function requireReconciliation(pool, operationId, claimToken, error) {
  const result = await pool.query(
    `UPDATE editorial_workflow_operations
     SET state = 'needs_reconciliation',
         locked_at = NULL,
         claim_token = NULL,
         last_error = $3,
         updated_at = NOW()
     WHERE operation_id = $1
       AND claim_token = $2
       AND state = 'processing'
     RETURNING *`,
    [
      operationId,
      claimToken,
      String(error?.message || error || "Manual reconciliation required").slice(0, 2000)
    ]
  );

  return result.rows[0] || null;
}

async function claimOperation(pool, operationId) {
  const claimToken = crypto.randomUUID();

  const result = await pool.query(
    `UPDATE editorial_workflow_operations
     SET state = 'processing',
         attempts = attempts + 1,
         locked_at = NOW(),
         claim_token = $2,
         updated_at = NOW()
     WHERE operation_id = $1
       AND state = 'pending'
       AND next_attempt_at <= NOW()
     RETURNING *`,
    [operationId, claimToken]
  );

  return result.rows[0] || null;
}

async function completeOperation(pool, operationId, claimToken, reviewId) {
  const result = await pool.query(
    `UPDATE editorial_workflow_operations
     SET state = 'completed',
         result_review_id = $3,
         locked_at = NULL,
         claim_token = NULL,
         last_error = NULL,
         completed_at = NOW(),
         updated_at = NOW()
     WHERE operation_id = $1
       AND claim_token = $2
       AND state = 'processing'
     RETURNING *`,
    [operationId, claimToken, reviewId]
  );

  return result.rows[0] || null;
}

async function failOperation(pool, operationId, claimToken, error) {
  const result = await pool.query(
    `UPDATE editorial_workflow_operations
     SET state = 'failed',
         locked_at = NULL,
         claim_token = NULL,
         last_error = $3,
         updated_at = NOW()
     WHERE operation_id = $1
       AND claim_token = $2
       AND state = 'processing'
     RETURNING *`,
    [
      operationId,
      claimToken,
      String(error?.message || error || "Workflow operation failed").slice(0, 2000)
    ]
  );

  return result.rows[0] || null;
}
module.exports = {
  createOperation,
  claimOperation,
  completeOperation,
  failOperation,
  getOperation,
  claimNext,
  reschedule,
  requireReconciliation
};




async function getActivePublication(pool, articleId) {
  const result = await pool.query(
    `SELECT *
     FROM editorial_workflow_operations
     WHERE article_id = $1
       AND operation_type = 'publish'
       AND state IN ('pending', 'processing', 'needs_reconciliation')
     ORDER BY created_at DESC
     LIMIT 1`,
    [articleId]
  );

  return result.rows[0] || null;
}

async function claimPublication(pool, operationId, { allowReconciliation = false } = {}) {
  const claimToken = crypto.randomUUID();

  const result = await pool.query(
    `UPDATE editorial_workflow_operations
     SET state = 'processing',
         attempts = attempts + 1,
         locked_at = NOW(),
         claim_token = $2,
         updated_at = NOW()
     WHERE operation_id = $1
       AND operation_type = 'publish'
       AND (
         (state = 'pending' AND next_attempt_at <= NOW())
         OR ($3::boolean = TRUE AND state = 'needs_reconciliation')
         OR (
           state = 'processing'
           AND locked_at < NOW() - INTERVAL '5 minutes'
         )
       )
     RETURNING *`,
    [operationId, claimToken, allowReconciliation]
  );

  return result.rows[0] || null;
}



module.exports.getActivePublication = getActivePublication;
module.exports.claimPublication = claimPublication;
module.exports.claimReviewOperationForReconciliation = claimReviewOperationForReconciliation;




async function claimReviewOperationForReconciliation(pool, operationId) {
  const claimToken = crypto.randomUUID();

  const result = await pool.query(
    `UPDATE editorial_workflow_operations
     SET state = 'processing',
         attempts = attempts + 1,
         locked_at = NOW(),
         claim_token = $2,
         updated_at = NOW()
     WHERE operation_id = $1
       AND operation_type IN ('submit', 'decide')
       AND (
         state = 'needs_reconciliation'
         OR (
           state = 'processing'
           AND locked_at < NOW() - INTERVAL '5 minutes'
         )
       )
     RETURNING *`,
    [operationId, claimToken]
  );

  return result.rows[0] || null;
}
