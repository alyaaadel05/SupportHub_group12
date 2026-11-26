"use strict";

const EVENT_TYPE = "editorial.publication.published";

function createHandler({ pool }) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A database pool is required");
  }

  async function processRecord(record) {
    const message = record?.Sns?.Message;

    if (typeof message !== "string") {
      throw new Error("SNS record is missing its message");
    }

    let event;

    try {
      event = JSON.parse(message);
    } catch {
      throw new Error("SNS message contains invalid JSON");
    }

    if (
      typeof event.eventId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.eventId)
    ) {
      throw new Error("Invalid publication event ID");
    }

    if (event.eventType !== EVENT_TYPE) {
      throw new Error("Unsupported publication event type");
    }

    const articleId = Number(event.data?.articleId);
    const publishedBy = Number(event.data?.publishedBy);

    if (
      !Number.isSafeInteger(articleId) ||
      articleId <= 0 ||
      !Number.isSafeInteger(publishedBy) ||
      publishedBy <= 0
    ) {
      throw new Error("Invalid publication event identifiers");
    }

    const result = await pool.query(
      `INSERT INTO editorial_publication_event_receipts
         (event_id, event_type, article_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [event.eventId, event.eventType, articleId]
    );

    const status = result.rowCount ? "processed" : "duplicate";
    // One structured line per record for CloudWatch Logs (identifiers only, no content or secrets).
    console.log(JSON.stringify({ msg: "publication receipt", eventId: event.eventId, eventType: event.eventType, articleId, status }));
    return { eventId: event.eventId, status };
  }

  return async function handler(snsEvent) {
    if (
      !snsEvent ||
      !Array.isArray(snsEvent.Records) ||
      snsEvent.Records.length === 0
    ) {
      throw new Error("SNS event must contain at least one record");
    }

    const results = [];

    for (const record of snsEvent.Records) {
      results.push(await processRecord(record));
    }

    return {
      processed: results.filter(item => item.status === "processed").length,
      duplicates: results.filter(item => item.status === "duplicate").length,
      results
    };
  };
}

let defaultPool;

async function handler(event) {
  if (!defaultPool) {
    const { Pool } = require("pg");
    const connectionString =
      process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error("Lambda database connection is not configured");
    }

    defaultPool = new Pool({
      connectionString,
      ssl: process.env.DATABASE_SSL === "false"
        ? false
        : { rejectUnauthorized: true },
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
  }

  return createHandler({ pool: defaultPool })(event);
}

module.exports = {
  handler,
  createHandler
};
