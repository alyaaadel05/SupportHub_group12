"use strict";

const crypto = require("node:crypto");
const defaultPool = require("../db/pool");

function createPublicationEventService({
  pool = defaultPool,
  publishToSns,
  maxAttempts = 5
} = {}) {

  async function queuePublicationEvent(client, { articleId, actorId }) {
    if (!articleId || !actorId) {
      throw new TypeError("articleId and actorId are required");
    }

    const eventId = crypto.randomUUID();
    const payload = {
      eventId,
      eventType: "editorial.publication.published",
      occurredAt: new Date().toISOString(),
      data: {
        articleId: Number(articleId),
        publishedBy: Number(actorId)
      }
    };

    const { rows } = await client.query(
      `INSERT INTO editorial_publication_event_outbox
         (event_id, article_id, event_type, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING *`,
      [eventId, articleId, payload.eventType, JSON.stringify(payload)]
    );

    return rows[0];
  }

  async function claimNext() {
    const claimToken = crypto.randomUUID();

    const { rows } = await pool.query(
      `WITH candidate AS (
         SELECT event_id
         FROM editorial_publication_event_outbox
         WHERE state = 'pending'
           AND next_attempt_at <= NOW()
         ORDER BY next_attempt_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE editorial_publication_event_outbox AS events
       SET state = 'processing',
           locked_at = NOW(),
           claim_token = $1
       FROM candidate
       WHERE events.event_id = candidate.event_id
       RETURNING events.*`,
      [claimToken]
    );

    return rows[0] || null;
  }

  async function markPublished(item, messageId) {
    const result = await pool.query(
      `UPDATE editorial_publication_event_outbox
       SET state = 'published',
           attempts = attempts + 1,
           published_at = NOW(),
           last_error = NULL,
           locked_at = NULL,
           claim_token = NULL
       WHERE event_id = $1
         AND state = 'processing'
         AND claim_token = $2`,
      [item.event_id, item.claim_token]
    );

    if (!result.rowCount) {
      return { status: "claim_lost" };
    }

    return {
      status: "published",
      messageId: messageId || null
    };
  }


  async function markFailed(item, error) {
    const attempts = Number(item.attempts) + 1;
    const permanentlyFailed = attempts >= maxAttempts;

    const delaySeconds = Math.min(
      900,
      5 * (2 ** Math.min(attempts - 1, 8))
    );

    const nextState = permanentlyFailed ? "failed" : "pending";
    const message = String(error?.message || "SNS publication failed")
      .slice(0, 250);

    const result = await pool.query(
      `UPDATE editorial_publication_event_outbox
       SET state = $3,
           attempts = attempts + 1,
           next_attempt_at = NOW() + ($4 * INTERVAL '1 second'),
           last_error = $5,
           locked_at = NULL,
           claim_token = NULL
       WHERE event_id = $1
         AND state = 'processing'
         AND claim_token = $2`,
      [
        item.event_id,
        item.claim_token,
        nextState,
        delaySeconds,
        message
      ]
    );

    if (!result.rowCount) {
      return { status: "claim_lost" };
    }

    return {
      status: nextState,
      attempts,
      retryInSeconds: permanentlyFailed ? null : delaySeconds
    };
  }


  async function publishOne() {
    if (typeof publishToSns !== "function") {
      throw new TypeError("publishToSns is required to publish events");
    }

    const item = await claimNext();

    if (!item) {
      return { status: "idle" };
    }

    let result;

    try {
      result = await publishToSns(item.payload);
    } catch (error) {
      return markFailed(item, error);
    }

    // Keep database completion errors separate from SNS delivery errors.
    return markPublished(item, result?.MessageId);
  }

  async function recoverAbandoned() {
    const { rowCount } = await pool.query(
      `UPDATE editorial_publication_event_outbox
       SET state = 'pending',
           locked_at = NULL,
           claim_token = NULL,
           next_attempt_at = NOW(),
           last_error = 'Publisher claim expired; event returned to pending'
       WHERE state = 'processing'
         AND locked_at < NOW() - INTERVAL '5 minutes'`
    );

    return rowCount;
  }

  async function runBatch(limit = 20) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
    const recovered = await recoverAbandoned();
    const results = [];

    for (let i = 0; i < safeLimit; i += 1) {
      const result = await publishOne();
      if (result.status === "idle") break;
      results.push(result);
    }

    return { recovered, results };
  }

  return {
    queuePublicationEvent,
    publishOne,
    runBatch,
    recoverAbandoned
  };
}

module.exports = createPublicationEventService;
module.exports.createPublicationEventService = createPublicationEventService;
