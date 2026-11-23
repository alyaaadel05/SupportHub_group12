"use strict";

const crypto = require("node:crypto");
const defaultPool = require("../db/pool");
const { HttpError } = require("./http");
const { notifySearch: defaultNotifySearch } = require("./serviceClient");

function createNotificationService({
  pool = defaultPool,
  notifySearch = defaultNotifySearch,
  maxAttempts = 5
} = {}) {
  async function queueNotification(client, articleId) {
    const { rows } = await client.query(
      `INSERT INTO publication_outbox
         (article_id, state, next_attempt_at)
       VALUES ($1, 'pending', NOW())
       RETURNING *`,
      [articleId]
    );

    return rows[0];
  }

  async function claim(outboxId) {
    const claimToken = crypto.randomUUID();

    const { rows } = await pool.query(
      `UPDATE publication_outbox
       SET state = 'processing',
           locked_at = NOW(),
           claim_token = $2
       WHERE outbox_id = $1
         AND state = 'pending'
         AND next_attempt_at <= NOW()
       RETURNING *`,
      [outboxId, claimToken]
    );

    return rows[0] || null;
  }

  function isDefiniteRejection(error) {
    return error instanceof HttpError &&
      error.status >= 400 &&
      error.status < 500 &&
      ![408, 429].includes(error.status);
  }

  async function processClaim(item) {
    try {
      await notifySearch(item.article_id);
    } catch (error) {
      const nextAttempt = Number(item.attempts) + 1;
      const definiteRejection = isDefiniteRejection(error);
      const permanentlyFailed = nextAttempt >= maxAttempts;

      // Without confirmed receiver-side idempotency, uncertain outcomes
      // must not be retried automatically.
      const nextState = definiteRejection
        ? "failed"
        : "needs_reconciliation";

      const message = definiteRejection
        ? String(error.message || "Search rejected the notification")
        : "Delivery outcome uncertain; manual reconciliation required";

      await pool.query(
        `UPDATE publication_outbox
         SET attempts = attempts + 1,
             state = $3,
             last_error = $4,
             next_attempt_at = NOW(),
             locked_at = NULL,
             claim_token = NULL
         WHERE outbox_id = $1
           AND state = 'processing'
           AND claim_token = $2`,
        [
          item.outbox_id,
          item.claim_token,
          nextState,
          message.slice(0, 250)
        ]
      );

      return {
        status: nextState,
        error: definiteRejection
          ? "Search rejected the notification"
          : "Notification delivery needs reconciliation",
        attempts: nextAttempt,
        maxAttemptsReached: permanentlyFailed
      };
    }

    // Keep this outside the delivery try/catch. If this database update
    // fails, the row remains processing and recovery marks it uncertain.
    const result = await pool.query(
      `UPDATE publication_outbox
       SET state = 'delivered',
           delivered_at = NOW(),
           last_error = NULL,
           locked_at = NULL,
           claim_token = NULL
       WHERE outbox_id = $1
         AND state = 'processing'
         AND claim_token = $2`,
      [item.outbox_id, item.claim_token]
    );

    if (!result.rowCount) {
      return { status: "claim_lost" };
    }

    return { status: "delivered" };
  }

  async function attempt(outboxId) {
    const item = await claim(outboxId);

    if (!item) {
      return { status: "already_handled_or_not_due" };
    }

    return processClaim(item);
  }

  async function recoverAbandoned() {
    const { rowCount } = await pool.query(
      `UPDATE publication_outbox
       SET attempts = attempts + 1,
           state = 'needs_reconciliation',
           next_attempt_at = NOW(),
           locked_at = NULL,
           claim_token = NULL,
           last_error = 'Worker claim expired; delivery outcome requires reconciliation'
       WHERE state = 'processing'
         AND locked_at < NOW() - INTERVAL '5 minutes'`
    );

    return rowCount;
  }

  async function retryPending(limit = 20) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
    const recovered = await recoverAbandoned();

    const { rows } = await pool.query(
      `SELECT outbox_id
       FROM publication_outbox
       WHERE state = 'pending'
         AND next_attempt_at <= NOW()
       ORDER BY next_attempt_at, outbox_id
       LIMIT $1`,
      [safeLimit]
    );

    const results = [];

    for (const row of rows) {
      results.push({
        id: row.outbox_id,
        ...(await attempt(row.outbox_id))
      });
    }

    return { recovered, results };
  }

  return {
    queueNotification,
    attempt,
    retryPending,
    recoverAbandoned
  };
}

module.exports = createNotificationService();
module.exports.createNotificationService = createNotificationService;
