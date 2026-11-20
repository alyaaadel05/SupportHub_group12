"use strict";

const crypto = require("node:crypto");
const pool = require("../db/pool");
const { HttpError, id } = require("./http");

const {
  getArticle,
  transitionArticle
} = require("./serviceClient");

const notifications = require("./notificationService");

const publicationEvents =
  require("./publicationEventService").createPublicationEventService({ pool });

const {
  createOperation,
  getOperation,
  getActivePublication,
  claimPublication,
  failOperation,
  requireReconciliation
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

  await requireReconciliation(
    pool,
    operationId,
    claimToken,
    error
  );
}


async function createOrClaimPublication(articleId, user) {
  let operation = await getActivePublication(pool, articleId);

  if (!operation) {
    const newOperation = {
      operationId: crypto.randomUUID(),
      articleId,
      operationType: "publish",
      actorId: user.id,
      fromStatus: "approved",
      toStatus: "published",
      decision: null,
      comments: ""
    };

    try {
      operation = await createOperation(pool, newOperation);
    } catch (error) {
      if (error.status !== 409) {
        throw error;
      }

      // Another request may have created the operation concurrently.
      operation = await getActivePublication(pool, articleId);

      if (!operation) {
        throw new HttpError(409, error.message);
      }
    }
  }

  if (Number(operation.actor_id) !== Number(user.id)) {
    throw new HttpError(
      409,
      "Another reviewer owns the active publication operation"
    );
  }

  if (operation.state === "needs_reconciliation") {
    throw new HttpError(
      409,
      "Publication requires manual reconciliation before it can be retried"
    );
  }

  const claimed = await claimPublication(
    pool,
    operation.operation_id
  );

  if (!claimed) {
    throw new HttpError(
      409,
      "Publication is already being processed or is not ready"
    );
  }

  return {
    operation,
    claimToken: claimed.claim_token
  };
}


async function finalizePublication(operation, claimToken) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT event_id
       FROM editorial_status_events
       WHERE article_id = $1
         AND new_status = 'published'
       LIMIT 1`,
      [operation.article_id]
    );

    if (existing.rowCount) {
      throw new HttpError(409, "Article already has a publication event");
    }

    await client.query(
      `INSERT INTO editorial_status_events
         (article_id, actor_id, previous_status, new_status)
       VALUES ($1, $2, 'approved', 'published')`,
      [operation.article_id, operation.actor_id]
    );

    const outbox = await notifications.queueNotification(
      client,
      operation.article_id
    );

    // Queue the SNS publication event in the same transaction.
    const publicationEvent = await publicationEvents.queuePublicationEvent(
      client,
      {
        articleId: operation.article_id,
        actorId: operation.actor_id
      }
    );

    const completed = await client.query(
      `UPDATE editorial_workflow_operations
       SET state = 'completed',
           locked_at = NULL,
           claim_token = NULL,
           last_error = NULL,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE operation_id = $1
         AND claim_token = $2
         AND state = 'processing'
       RETURNING operation_id`,
      [operation.operation_id, claimToken]
    );

    if (!completed.rowCount) {
      throw new Error(
        "Could not complete the publication workflow operation"
      );
    }

    await client.query("COMMIT");

    return { ...outbox, publicationEvent };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


async function publish(articleId, user) {
  articleId = id(articleId);

  const activeOperation = await getActivePublication(
    pool,
    articleId
  );

  const approved = await pool.query(
    `SELECT review_id
     FROM editorial_reviews
     WHERE article_id = $1
       AND decision = 'approved'
     ORDER BY decided_at DESC NULLS LAST, review_id DESC
     LIMIT 1`,
    [articleId]
  );

  if (!approved.rowCount && !activeOperation) {
    throw new HttpError(409, "No approved review found");
  }

  const article = await getArticle(articleId);

  if (!article) {
    throw new HttpError(404, "Article not found");
  }

  if (Number(article.author_id) === Number(user.id)) {
    throw new HttpError(
      403,
      "Cannot publish your own article"
    );
  }

  // An existing active operation may already have transitioned the article
  // remotely. Only allow approved or published while resuming that operation.
  if (activeOperation) {
    if (!["approved", "published"].includes(article.status)) {
      throw new HttpError(
        409,
        "Article is not in a resumable publication state"
      );
    }
  } else if (article.status !== "approved") {
    throw new HttpError(
      409,
      "Article must be approved first"
    );
  }

  const { operation, claimToken } =
    await createOrClaimPublication(articleId, user);

  try {
    await transitionArticle(
      articleId,
      "approved",
      "published",
      operation.operation_id
    );
  } catch (error) {
    try {
      await recordRemoteFailure(
        operation.operation_id,
        claimToken,
        error
      );
    } catch (recordError) {
      error.workflowRecordError = recordError;
    }

    throw error;
  }

  let outbox;

  try {
    outbox = await finalizePublication(
      operation,
      claimToken
    );
  } catch (error) {
    try {
      await requireReconciliation(
        pool,
        operation.operation_id,
        claimToken,
        error
      );
    } catch (recordError) {
      error.workflowRecordError = recordError;
    }

    throw error;
  }

  // Notification delivery happens only after publication is committed.
  let delivery;

  try {
    delivery = await notifications.attempt(outbox.outbox_id);
  } catch (error) {
    delivery = {
      status: "pending",
      error: "Publication succeeded; notification delivery remains pending"
    };
  }

  return {
    articleId,
    status: "published",
    searchable:
      delivery.status === "delivered"
        ? true
        : delivery.status === "failed"
          ? false
          : null,
    deliveryStatus: delivery.status
  };
}



async function reconcilePublication(operationId) {
  if (
    typeof operationId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)
  ) {
    throw new HttpError(400, "A valid publication operation ID is required");
  }

  const operation = await getOperation(pool, operationId);

  if (!operation || operation.operation_type !== "publish") {
    throw new HttpError(404, "Publication operation not found");
  }

  if (operation.state !== "needs_reconciliation") {
    throw new HttpError(409, "Only publication operations requiring reconciliation can be resolved");
  }

  const claimed = await claimPublication(
    pool,
    operationId,
    { allowReconciliation: true }
  );

  if (!claimed) {
    throw new HttpError(409, "Publication operation could not be claimed");
  }

  const claimToken = claimed.claim_token;

  try {
    const article = await getArticle(operation.article_id);

    if (!article) {
      throw new HttpError(404, "Article not found in Article Service");
    }

    if (article.status === "approved") {
      await transitionArticle(
        operation.article_id,
        "approved",
        "published",
        operation.operation_id
      );
    } else if (article.status !== "published") {
      throw new HttpError(
        409,
        `Cannot reconcile publication while article status is '${article.status}'`
      );
    }

    const outbox = await finalizePublication(operation, claimToken);

    let delivery;

    try {
      delivery = await notifications.attempt(outbox.outbox_id);
    } catch {
      delivery = { status: "pending" };
    }

    return {
      articleId: operation.article_id,
      operationId: operation.operation_id,
      status: "published",
      reconciled: true,
      searchable:
        delivery.status === "delivered"
          ? true
          : delivery.status === "failed"
            ? false
            : null,
      deliveryStatus: delivery.status
    };
  } catch (error) {
    try {
      await requireReconciliation(
        pool,
        operation.operation_id,
        claimToken,
        error
      );
    } catch (recordError) {
      error.workflowRecordError = recordError;
    }

    throw error;
  }
}

async function listPublished() {
  const result = await pool.query(
    `SELECT article_id, MAX(event_id) AS latest_event_id
     FROM editorial_status_events
     WHERE new_status = 'published'
     GROUP BY article_id
     ORDER BY latest_event_id DESC
     LIMIT 100`
  );

  const articles = await Promise.all(
    result.rows.map(async row => {
      const article = await getArticle(row.article_id);

      if (!article || article.status !== "published") {
        return null;
      }

      return article;
    })
  );

  return articles.filter(Boolean);
}


module.exports = {
  publish,
  reconcilePublication,
  listPublished
};
