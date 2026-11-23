
const { randomUUID } = require("node:crypto");

const {
  SQSClient,
  SendMessageCommand
} = require("@aws-sdk/client-sqs");

const sqs = new SQSClient({
  region: process.env.AWS_REGION || "us-east-1",
  endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test"
  }
});

async function publishArticleSubmitted(article) {
  if (!article || !article.id) {
    throw new Error("Valid article is required");
  }

  const queueUrl = process.env.SQS_QUEUE_URL;

  if (!queueUrl) {
    throw new Error("SQS_QUEUE_URL is not configured");
  }

  const event = {
    eventId: randomUUID(),
    eventType: "article.submitted",
    articleId: article.id,
    version: article.current_version ?? 1,
    occurredAt: new Date().toISOString()
  };

  const result = await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(event)
    })
  );

  return {
    event,
    messageId: result.MessageId
  };
}

module.exports = {
  publishArticleSubmitted
};
