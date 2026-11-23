"use strict";

require("dotenv").config();

const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  GetQueueAttributesCommand,
  ChangeMessageVisibilityCommand
} = require("@aws-sdk/client-sqs");

const {
  createArticleEventConsumer
} = require("../workers/articleEventConsumer");

async function main() {
  const queueUrl = process.env.ARTICLE_EVENTS_QUEUE_URL;
  const region = process.env.AWS_REGION || "us-east-1";
  const endpoint = process.env.SQS_ENDPOINT_URL;

  if (!queueUrl) {
    throw new Error("ARTICLE_EVENTS_QUEUE_URL is not configured");
  }

  const config = { region };

  if (endpoint) {
    config.endpoint = endpoint;
    config.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test"
    };
  }

  const sqs = new SQSClient(config);

  try {
    const before = await sqs.send(new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ["ApproximateNumberOfMessages",
        "ApproximateNumberOfMessagesNotVisible"]
    }));

    assert.equal(
      Number(before.Attributes.ApproximateNumberOfMessages || 0),
      0,
      "Queue must be empty before this isolated smoke test"
    );

    assert.equal(
      Number(before.Attributes.ApproximateNumberOfMessagesNotVisible || 0),
      0,
      "Queue must have no messages currently being processed"
    );

    const event = {
      eventId: `editorial-smoke-${crypto.randomUUID()}`,
      eventType: "article.submitted",
      articleId: 1,
      submittedBy: 1
    };

    await sqs.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(event)
    }));

    console.log("PASS: Test message sent to Floci");

    const received = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 10,
      VisibilityTimeout: 60
    }));

    assert.ok(
      received.Messages?.length,
      "Floci did not return the test message"
    );

    const message = received.Messages[0];
    const receivedEvent = JSON.parse(message.Body);

    if (receivedEvent.eventId !== event.eventId) {
      await sqs.send(new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: 0
      }));

      throw new Error(
        "Received a different message; it was returned to the queue"
      );
    }

    console.log("PASS: Test message received from Floci");

    const consumer = createArticleEventConsumer({
      sqs,
      queueUrl,
      processEvent: async receivedEvent => {
        assert.deepEqual(receivedEvent, event);
        console.log("PASS: Consumer received the expected event");
        return { status: "processed" };
      },
      logger: {
        info: () => {},
        error: (...args) => console.error(...args)
      }
    });

    const result = await consumer.processMessage(message);

    assert.equal(result.status, "processed");

    console.log("PASS: Consumer acknowledged and deleted the message");
    console.log("\nFloci SQS smoke test PASSED");
  } finally {
    sqs.destroy();
  }
}

main().catch(error => {
  console.error("\nFloci SQS smoke test FAILED:", error.message);
  process.exitCode = 1;
});
