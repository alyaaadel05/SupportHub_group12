"use strict";

require("dotenv").config();

const {
  SNSClient,
  PublishCommand
} = require("@aws-sdk/client-sns");

const createPublicationEventService =
  require("../services/publicationEventService");

const topicArn = process.env.EDITORIAL_PUBLICATION_TOPIC_ARN;
const endpoint = process.env.SNS_ENDPOINT_URL;

if (!topicArn) {
  throw new Error("EDITORIAL_PUBLICATION_TOPIC_ARN is required");
}

const sns = new SNSClient({
  region: process.env.AWS_REGION || "us-east-1",
  ...(endpoint ? { endpoint } : {})
});

const publisher = createPublicationEventService({
  publishToSns: async payload => {
    const result = await sns.send(new PublishCommand({
      TopicArn: topicArn,
      Message: JSON.stringify(payload),
      MessageAttributes: {
        eventType: {
          DataType: "String",
          StringValue: payload.eventType
        },
        eventId: {
          DataType: "String",
          StringValue: payload.eventId
        }
      }
    }));

    return result;
  }
});

const intervalMs = Math.max(
  1000,
  Number(process.env.PUBLICATION_EVENT_POLL_INTERVAL_MS) || 5000
);

let stopping = false;
let running = false;

async function tick() {
  if (stopping || running) return;

  running = true;

  try {
    const result = await publisher.runBatch(20);

    if (result.results.length > 0 || result.recovered > 0) {
      console.log("Publication event batch:", JSON.stringify(result));
    }
  } catch (error) {
    console.error("Publication event worker error:", error.message);
  } finally {
    running = false;
  }
}

async function shutdown() {
  if (stopping) return;
  stopping = true;

  clearInterval(timer);

  console.log("Stopping publication event publisher...");

  while (running) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  await sns.destroy();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("Editorial publication event publisher started");
void tick();

const timer = setInterval(() => {
  void tick();
}, intervalMs);
