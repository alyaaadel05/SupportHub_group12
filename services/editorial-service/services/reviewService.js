"use strict";

const crypto = require("node:crypto");

const pool = require("../db/pool");

const {
  HttpError,
  id,
  reviewComments
} = require("./http");

const {
  getArticle,
  transitionArticle
} = require("./serviceClient");

const {
  createOperation,
  claimOperation,
  failOperation,
  requireReconciliation,
  claimReviewOperationForReconciliation,
  getOperation
} = require("./workflowOperationRepository");



function isDefiniteRemoteRejection(error) {
  const status = Number(error?.status || error?.statusCode);

  return (
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  );
}


async function recordRemoteFailure(operationId, claimToken, error) {
  if (isDefiniteRemoteRejection(error)) {
    await failOperation(pool, operationId, claimToken, error);
    return;
  }

  // A timeout or server error does not prove that Article Service
  // failed to apply the transition. Do not blindly retry it.
  await requireReconciliation(
    pool,
    operationId,
    claimToken,
    error
  );
}


async function createAndClaimOperation(operation) {
  try {
    await createOperation(pool, operation);
  } catch (error) {
    if (error.status === 409) {
      throw new HttpError(409, error.message);
    }

    throw error;
  }

  const claimed = await claimOperation(
    pool,
    operation.operationId
  );

  if (!claimed) {
    throw new HttpError(
      409,
      "Workflow operation could not be claimed"
    );
  }

  return claimed;
}

async function getDecisionReplay(operationId, articleId, userId, decision, comments) {
  const existing = await getOperation(pool, operationId);

  if (!existing) {
    return null;
  }

  const matches =
    Number(existing.article_id) === Number(articleId) &&
    Number(existing.actor_id) === Number(userId) &&
    existing.operation_type === "decide" &&
    existing.decision === decision &&
    existing.comments === comments &&
    existing.from_status === "in_review" &&
    existing.to_status === (decision === "approved" ? "approved" : "draft");

  if (!matches) {
    throw new HttpError(
      409,
      "Operation ID has already been used for a different request"
    );
  }

  if (existing.state !== "completed") {
    throw new HttpError(
      409,
      `This operation is ${existing.state}; reconcile or resolve it before retrying`
    );
  }

  const result = await pool.query(
    `SELECT *
     FROM editorial_reviews
     WHERE review_id = $1
       AND article_id = $2`,
    [existing.result_review_id, articleId]
  );

  if (!result.rows[0]) {
    throw new HttpError(
      500,
      "Completed operation has no matching review result"
    );
  }

  return result.rows[0];
}

async function getCompletedReview(operationId, knownOperation = null) {
  const operation = knownOperation || await getOperation(pool, operationId);

  if (!operation || operation.state !== "completed") {
    return null;
  }

  if (!operation.result_review_id) {
    throw new HttpError(
      500,
      "Completed workflow operation has no result review ID"
    );
  }

  const result = await pool.query(
    `SELECT *
     FROM editorial_reviews
     WHERE review_id = $1
       AND article_id = $2`,
    [operation.result_review_id, operation.article_id]
  );

  if (!result.rows[0]) {
    throw new HttpError(
      500,
      "Completed workflow operation has no matching review result"
    );
  }

  return result.rows[0];
}

async function finalizeSubmission(operation, claimToken) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const reviewResult = await client.query(
      `INSERT INTO editorial_reviews
         (article_id, submitted_by, decision)
       VALUES ($1, $2, 'pending')
       RETURNING *`,
      [operation.articleId, operation.actorId]
    );

    const review = reviewResult.rows[0];

    await client.query(
      `INSERT INTO editorial_status_events
         (article_id, actor_id, previous_status, new_status)
       VALUES ($1, $2, 'draft', 'in_review')`,
      [operation.articleId, operation.actorId]
    );

    const completed = await client.query(
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
       RETURNING operation_id`,
      [operation.operationId, claimToken, review.review_id]
    );

    if (!completed.rowCount) {
      throw new Error(
        "Could not complete the submission workflow operation"
      );
    }

    await client.query("COMMIT");

    return review;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }

    throw error;
  } finally {
    client.release();
  }
}


async function finalizeDecision(
  operation,
  claimToken,
  reviewId
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE editorial_reviews
       SET decision = $1,
           reviewer_id = $2,
           comments = $3,
           decided_at = NOW()
       WHERE review_id = $4
         AND article_id = $5
         AND decision = 'pending'
       RETURNING *`,
      [
        operation.decision,
        operation.actorId,
        operation.comments,
        reviewId,
        operation.articleId
      ]
    );

    if (!result.rowCount) {
      throw new HttpError(
        409,
        "Review was already processed or no longer exists"
      );
    }

    await client.query(
      `INSERT INTO editorial_status_events
         (article_id, actor_id, previous_status, new_status)
       VALUES ($1, $2, 'in_review', $3)`,
      [operation.articleId, operation.actorId, operation.toStatus]
    );

    const completed = await client.query(
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
       RETURNING operation_id`,
      [operation.operationId, claimToken, reviewId]
    );

    if (!completed.rowCount) {
      throw new Error(
        "Could not complete the decision workflow operation"
      );
    }

    await client.query("COMMIT");

    return result.rows[0];
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }

    throw error;
  } finally {
    client.release();
  }
}


async function submit(articleId, user) {
  articleId = id(articleId);

  const article = await getArticle(articleId);

  if (!article) {
    throw new HttpError(404, "Article not found");
  }

  if (Number(article.author_id) !== Number(user.id)) {
    throw new HttpError(403, "Only the author can submit");
  }

  if (article.status !== "draft") {
    throw new HttpError(409, "Only drafts can be submitted");
  }

  if (
    !article.title?.trim() ||
    !article.content?.trim() ||
    !article.category_id
  ) {
    throw new HttpError(400, "Incomplete article");
  }

  const operation = {
    operationId: crypto.randomUUID(),
    articleId,
    operationType: "submit",
    actorId: user.id,
    fromStatus: "draft",
    toStatus: "in_review",
    decision: null,
    comments: ""
  };

  const claimed = await createAndClaimOperation(operation);

  try {
    await transitionArticle(
      articleId,
      operation.fromStatus,
      operation.toStatus,
      operation.operationId
    );
  } catch (error) {
    try {
      await recordRemoteFailure(
        operation.operationId,
        claimed.claim_token,
        error
      );
    } catch (recordError) {
      error.workflowRecordError = recordError;
    }

    throw error;
  }

  try {
    return await finalizeSubmission(
      operation,
      claimed.claim_token
    );
  } catch (error) {
    try {
      const completedReview = await getCompletedReview(
        operation.operationId
      );

      if (completedReview) {
        return completedReview;
      }
    } catch (recoveryError) {
      error.recoveryCheckError = recoveryError;
    }

    try {
      await requireReconciliation(
        pool,
        operation.operationId,
        claimed.claim_token,
        error
      );
    } catch (recordError) {
      error.workflowRecordError = recordError;
    }

    throw error;
  }
}


async function queue(status = "pending") {
  if (!["pending", "approved", "rejected"].includes(status)) {
    throw new HttpError(400, "Invalid review status");
  }

  const result = await pool.query(
    `SELECT *
     FROM editorial_reviews
     WHERE decision = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [status]
  );

  const reviews = await Promise.all(
    result.rows.map(async review => {
      const article = await getArticle(review.article_id);

      return {
        ...review,
        article
      };
    })
  );

  return reviews.filter(item => Boolean(item.article));
}



async function decide(articleId, user, body) {
  articleId = id(articleId);

  const decision = body?.decision;

  if (!["approved", "rejected"].includes(decision)) {
    throw new HttpError(
      400,
      "Decision must be approved or rejected"
    );
  }

  const comments = reviewComments(
    decision,
    body?.comments
  );

  // Only reuse an operation ID when the client explicitly supplies one.
  // Otherwise, generate a fresh ID for this request.
  const suppliedOperationId = body?.operationId;
  const operationId = suppliedOperationId ?? crypto.randomUUID();

  if (
    typeof operationId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)
  ) {
    throw new HttpError(400, "A valid operationId UUID is required");
  }

  // Check for a previous request only when the client supplied an ID.
  if (suppliedOperationId !== undefined && suppliedOperationId !== null) {
    const replay = await getDecisionReplay(
      operationId,
      articleId,
      user.id,
      decision,
      comments
    );

    if (replay) {
      return replay;
    }
  }

  const pending = await pool.query(
    `SELECT *
     FROM editorial_reviews
     WHERE article_id = $1
       AND decision = 'pending'
     ORDER BY review_id DESC
     LIMIT 1`,
    [articleId]
  );

  const review = pending.rows[0];

  if (!review) {
    throw new HttpError(409, "No pending review");
  }

  const article = await getArticle(articleId);

  if (!article) {
    throw new HttpError(404, "Article not found");
  }

  if (Number(article.author_id) === Number(user.id)) {
    throw new HttpError(
      403,
      "Cannot review your own article"
    );
  }

  if (article.status !== "in_review") {
    throw new HttpError(
      409,
      "Article is not in review"
    );
  }

  const nextStatus =
    decision === "approved" ? "approved" : "draft";

  const operation = {
    operationId,
    articleId,
    operationType: "decide",
    actorId: user.id,
    fromStatus: "in_review",
    toStatus: nextStatus,
    decision,
    comments
  };

  let claimed;

  try {
    claimed = await createAndClaimOperation(operation);
  } catch (error) {
    // Recover a concurrent request only when the client supplied
    // the same operation ID.
    if (
      suppliedOperationId !== undefined &&
      suppliedOperationId !== null
    ) {
      const concurrentReplay = await getDecisionReplay(
        operationId,
        articleId,
        user.id,
        decision,
        comments
      );

      if (concurrentReplay) {
        return concurrentReplay;
      }
    }

    throw error;
  }

  try {
    await transitionArticle(
      articleId,
      operation.fromStatus,
      operation.toStatus,
      operation.operationId
    );
  } catch (error) {
    try {
      await recordRemoteFailure(
        operation.operationId,
        claimed.claim_token,
        error
      );
    } catch (recordError) {
      error.workflowRecordError = recordError;
    }

    throw error;
  }

  try {
    return await finalizeDecision(
      operation,
      claimed.claim_token,
      review.review_id
    );
  } catch (error) {
    try {
      const completedReview = await getCompletedReview(
        operation.operationId
      );

      if (completedReview) {
        return completedReview;
      }
    } catch (recoveryError) {
      error.recoveryCheckError = recoveryError;
    }

    try {
      await requireReconciliation(
        pool,
        operation.operationId,
        claimed.claim_token,
        error
      );
    } catch (recordError) {
      error.workflowRecordError = recordError;
    }

    throw error;
  }
}




async function reconcileReviewOperation(operationId) {
  if (
    typeof operationId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)
  ) {
    throw new HttpError(400, "A valid workflow operation ID is required");
  }

  const existingOperation = await getOperation(pool, operationId);

  if (existingOperation?.state === "completed") {
    const review = await getCompletedReview(
      operationId,
      existingOperation
    );

    return {
      operationId,
      state: "completed",
      action: existingOperation.operation_type === "submit"
        ? "submission_already_finalized"
        : "decision_already_finalized",
      review
    };
  }

  const claimed = await claimReviewOperationForReconciliation(
    pool,
    operationId
  );

  if (!claimed) {
    throw new HttpError(
      409,
      "Operation is not awaiting reconciliation or is already being processed"
    );
  }

  const operation = {
    operationId: claimed.operation_id,
    articleId: claimed.article_id,
    operationType: claimed.operation_type,
    actorId: claimed.actor_id,
    fromStatus: claimed.from_status,
    toStatus: claimed.to_status,
    decision: claimed.decision,
    comments: claimed.comments || ""
  };

  try {
    const article = await getArticle(operation.articleId);

    if (!article) {
      throw new HttpError(404, "Article not found in Article Service");
    }

    // Never repeat a remote transition during reconciliation.
    if (article.status !== operation.toStatus) {
      throw new HttpError(
        409,
        `Remote article status is '${article.status}', expected '${operation.toStatus}'. Operation remains unresolved.`
      );
    }

    if (operation.operationType === "submit") {
      const review = await finalizeSubmission(
        operation,
        claimed.claim_token
      );

      return {
        operationId,
        state: "completed",
        action: "submission_finalized",
        review
      };
    }

    if (operation.operationType === "decide") {
      const pending = await pool.query(
        `SELECT *
         FROM editorial_reviews
         WHERE article_id = $1
           AND decision = 'pending'
         ORDER BY review_id DESC
         LIMIT 1`,
        [operation.articleId]
      );

      const review = pending.rows[0];

      if (!review) {
        throw new HttpError(
          409,
          "No pending review exists for this decision operation. Manual investigation is required."
        );
      }

      const finalized = await finalizeDecision(
        operation,
        claimed.claim_token,
        review.review_id
      );

      return {
        operationId,
        state: "completed",
        action: "decision_finalized",
        review: finalized
      };
    }

    throw new HttpError(400, "Unsupported review operation type");
  } catch (error) {
    try {
      await requireReconciliation(
        pool,
        operationId,
        claimed.claim_token,
        error
      );
    } catch (recordError) {
      error.workflowRecordError = recordError;
    }

    throw error;
  }
}

async function history(articleId) {
  const result = await pool.query(
    `SELECT
       event_id,
       article_id,
       actor_id,
       previous_status,
       new_status,
       created_at
     FROM editorial_status_events
     WHERE article_id = $1
     ORDER BY created_at ASC, event_id ASC`,
    [articleId]
  );

  return result.rows;
}


module.exports = {
  submit,
  queue,
  decide,
  reconcileReviewOperation,
  history
};
