"use strict";

require("dotenv").config();

const {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand
} = require("@aws-sdk/client-sqs");

const ACCEPTED_STATUSES = new Set([
  "processed",
  "duplicate",
  "duplicate_article"
]);

function createArticleEventConsumer({
  sqs,
  queueUrl,
  processEvent,
  waitTime = 20,
  visibilityTimeout = 60,
  logger = console,
  sleepFn = ms => new Promise(resolve => setTimeout(resolve, ms))
}) {
  if (!sqs) throw new Error("SQS client is required");
  if (!queueUrl) throw new Error("Queue URL is required");

  if (typeof processEvent !== "function") {
    throw new Error("Event processor is required");
  }

  if (!Number.isInteger(waitTime) || waitTime < 0 || waitTime > 20) {
    throw new Error("Invalid wait time");
  }

  if (
    !Number.isInteger(visibilityTimeout) ||
    visibilityTimeout < 1 ||
    visibilityTimeout > 43200
  ) {
    throw new Error("Invalid visibility timeout");
  }

  let running = false;
  let startPromise = null;
  let receiveController = null;

  async function processMessage(message) {
    if (!message?.Body || !message?.ReceiptHandle) {
      throw new Error("SQS message is missing required fields");
    }

    let event;

    try {
      event = JSON.parse(message.Body);
    } catch {
      throw new Error("SQS message body is not valid JSON");
    }

    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new Error("SQS message must contain a JSON object");
    }

    const result = await processEvent(event);

    if (!ACCEPTED_STATUSES.has(result?.status)) {
      throw new Error("Unexpected event processing result");
    }

    // Acknowledge only after durable event processing.
    await sqs.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: message.ReceiptHandle
      })
    );

    logger.info("Article event acknowledged:", result.status);

    return result;
  }

  async function start() {
    if (startPromise) return startPromise;

    running = true;

    startPromise = (async () => {
      while (running) {
        receiveController = new AbortController();

        try {
          const response = await sqs.send(
            new ReceiveMessageCommand({
              QueueUrl: queueUrl,
              MaxNumberOfMessages: 1,
              WaitTimeSeconds: waitTime,
              VisibilityTimeout: visibilityTimeout
            }),
            { abortSignal: receiveController.signal }
          );

          receiveController = null;

          for (const message of response.Messages || []) {
            if (!running) break;

            try {
              // Finish an already-received message before shutting down.
              await processMessage(message);
            } catch (error) {
              // Failed messages remain in SQS for redelivery.
              logger.error(
                "Article event processing failed:",
                error.message
              );
            }
          }
        } catch (error) {
          receiveController = null;

          if (!running) break;

          logger.error("SQS polling failed:", error.message);

          if (running) {
            await sleepFn(3000);
          }
        }
      }
    })();

    return startPromise;
  }

  async function stop() {
    running = false;

    // Interrupt an outstanding long-poll request.
    // An already-received message is allowed to finish.
    receiveController?.abort();

    if (startPromise) {
      await startPromise;
    }
  }

  return { processMessage, start, stop };
}

async function main() {
  const queueUrl = process.env.ARTICLE_EVENTS_QUEUE_URL;
  const region = process.env.AWS_REGION || "us-east-1";
  const endpoint = process.env.SQS_ENDPOINT_URL;

  const waitTime = Number(process.env.SQS_WAIT_TIME_SECONDS || 20);
  const visibilityTimeout = Number(
    process.env.SQS_VISIBILITY_TIMEOUT || 60
  );

  if (!queueUrl) {
    throw new Error("ARTICLE_EVENTS_QUEUE_URL is required");
  }

  const clientConfig = { region };

  if (endpoint) {
    clientConfig.endpoint = endpoint;
    clientConfig.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test"
    };
  }

  const sqs = new SQSClient(clientConfig);

  let consumer;

  const shutdown = async signal => {
    console.log(`Editorial worker received ${signal}; shutting down`);

    if (consumer) {
      await consumer.stop();
    }
  };

  const onSigint = () => {
    void shutdown("SIGINT");
  };

  const onSigterm = () => {
    void shutdown("SIGTERM");
  };

  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    const {
      processSubmittedEvent
    } = require("../services/articleEventService");

    consumer = createArticleEventConsumer({
      sqs,
      queueUrl,
      processEvent: processSubmittedEvent,
      waitTime,
      visibilityTimeout
    });

    console.log("Editorial Article Event Consumer started");

    await consumer.start();
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    await consumer?.stop();
    sqs.destroy();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error("Editorial worker stopped:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { createArticleEventConsumer };
