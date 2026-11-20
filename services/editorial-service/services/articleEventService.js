"use strict";

const pool = require("../db/pool");
const { getArticle } = require("./serviceClient");

function positiveInteger(value, field) {
  const number = Number(value);

  if (!Number.isSafeInteger(number) || number <= 0) {
    const error = new Error(`Invalid ${field}`);
    error.status = 400;
    throw error;
  }

  return number;
}

function createArticleEventService({
  db = pool,
  fetchArticle = getArticle
} = {}) {
  async function processSubmittedEvent(event) {
    const eventId =
      typeof event?.eventId === "string" ? event.eventId.trim() : "";

    if (!eventId || eventId.length > 255) {
      const error = new Error("Invalid event ID");
      error.status = 400;
      throw error;
    }

    if (event?.eventType !== "article.submitted") {
      const error = new Error("Unsupported article event type");
      error.status = 400;
      throw error;
    }

    const articleId = positiveInteger(event.articleId, "article ID");
    const submittedBy = positiveInteger(event.submittedBy, "submitter ID");

    // Article Service publishes this event after changing the status.
    // Never call reviewService.submit() from this event handler.
    const article = await fetchArticle(articleId);

    if (!article) {
      const error = new Error("Article not found in Article Service");
      error.status = 404;
      throw error;
    }

    if (Number(article.author_id) !== submittedBy) {
      const error = new Error("Event submitter does not match article author");
      error.status = 409;
      throw error;
    }

    if (article.status !== "in_review") {
      const error = new Error("Submitted article is not in review");
      error.status = 409;
      throw error;
    }

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const inserted = await client.query(
        `INSERT INTO editorial_event_inbox (
           event_id, event_type, article_id, submitted_by
         )
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [eventId, event.eventType, articleId, submittedBy]
      );

      if (inserted.rowCount === 0) {
        const existing = await client.query(
          `SELECT event_type, article_id, submitted_by
           FROM editorial_event_inbox
           WHERE event_id = $1
           FOR UPDATE`,
          [eventId]
        );

        const previous = existing.rows[0];

        if (
          !previous ||
          previous.event_type !== event.eventType ||
          Number(previous.article_id) !== articleId ||
          Number(previous.submitted_by) !== submittedBy
        ) {
          const error = new Error(
            "Event ID was previously used with different event data"
          );
          error.status = 409;
          throw error;
        }

        await client.query("COMMIT");
        return { status: "duplicate", eventId };
      }

      const review = await client.query(
        `INSERT INTO editorial_reviews (
           article_id, submitted_by, decision
         )
         VALUES ($1, $2, 'pending')
         ON CONFLICT (article_id) WHERE decision = 'pending'
         DO NOTHING
         RETURNING *`,
        [articleId, submittedBy]
      );

      if (review.rowCount === 0) {
        const existingReview = await client.query(
          `SELECT review_id, article_id, submitted_by, decision
           FROM editorial_reviews
           WHERE article_id = $1
             AND decision = 'pending'
           FOR UPDATE`,
          [articleId]
        );

        const previousReview = existingReview.rows[0];

        if (
          !previousReview ||
          Number(previousReview.submitted_by) !== submittedBy
        ) {
          const error = new Error(
            "A pending review exists with conflicting submitter details"
          );
          error.status = 409;
          throw error;
        }

        await client.query("COMMIT");

        return {
          status: "duplicate_article",
          eventId,
          review: previousReview
        };
      }

      await client.query(
        `INSERT INTO editorial_status_events (
           article_id, actor_id, previous_status, new_status
         )
         VALUES ($1, $2, 'draft', 'in_review')`,
        [articleId, submittedBy]
      );

      await client.query("COMMIT");

      return {
        status: "processed",
        eventId,
        review: review.rows[0]
      };
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

  return { processSubmittedEvent };
}

const service = createArticleEventService();

module.exports = {
  createArticleEventService,
  processSubmittedEvent: service.processSubmittedEvent
};
