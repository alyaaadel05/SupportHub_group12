
const pool = require("../db/pool");

const {
  SQSClient,
  SendMessageCommand
} = require("@aws-sdk/client-sqs");

const sqs = new SQSClient({
  region: process.env.AWS_REGION || "us-east-1",
  ...(process.env.AWS_ENDPOINT_URL
    ? { endpoint: process.env.AWS_ENDPOINT_URL }
    : {})
});

// Events published per worker run. The k6 workflow load test showed that
// one event per 5-second run (12/min) let submissions queue up in the outbox
// under load, so each run now drains up to OUTBOX_BATCH_SIZE events. Every
// event still uses its own transaction and row lock (FOR UPDATE SKIP LOCKED),
// and the batch stops at the first delivery failure.
function batchSize() {
  const value = Number(process.env.OUTBOX_BATCH_SIZE || 25);
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 100) : 25;
}

async function processOutbox() {
  const queueUrl = process.env.SQS_QUEUE_URL;

  if (!queueUrl) {
    throw new Error("SQS_QUEUE_URL is missing");
  }

  try {
    for (let i = 0; i < batchSize(); i += 1) {
      const result = await publishOne(queueUrl);

      if (result !== "published") {
        break;
      }
    }
  } finally {
    await sqs.destroy();
  }
}

// Returns "published", "empty" or "failed".
async function publishOne(queueUrl) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT id, payload
       FROM article_event_outbox
       WHERE status = 'pending'
       ORDER BY created_at
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    );

    const row = result.rows[0];

    if (!row) {
      await client.query("COMMIT");
      console.log("No pending events");
      return "empty";
    }

    try {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(row.payload)
        })
      );

      await client.query(
        `UPDATE article_event_outbox
         SET status = 'published',
             published_at = NOW(),
             attempts = attempts + 1,
             last_error = NULL
         WHERE id = $1`,
        [row.id]
      );

      await client.query("COMMIT");
      console.log("Event published:", row.id);
      return "published";

    } catch (error) {
      await client.query(
        `UPDATE article_event_outbox
         SET attempts = attempts + 1,
             last_error = $2
         WHERE id = $1`,
        [row.id, error.message]
      );

      await client.query("COMMIT");
      console.error("Event delivery failed:", error.message);
      process.exitCode = 1;
      return "failed";
    }

  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}

    throw error;
  } finally {
    client.release();
  }
}

processOutbox()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
