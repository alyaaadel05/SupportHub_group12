
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

async function processOutbox() {
  const queueUrl = process.env.SQS_QUEUE_URL;

  if (!queueUrl) {
    throw new Error("SQS_QUEUE_URL is missing");
  }

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
      return;
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
    }

  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}

    throw error;
  } finally {
    client.release();
    await sqs.destroy();
  }
}

processOutbox()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
