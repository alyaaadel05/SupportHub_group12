"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createArticleEventConsumer
} = require("../workers/articleEventConsumer");

function createMockSqs({ failDelete = false } = {}) {
  const calls = [];

  return {
    calls,
    async send(command) {
      calls.push(command);

      if (command.constructor.name === "DeleteMessageCommand") {
        if (failDelete) {
          throw new Error("Simulated SQS deletion failure");
        }
        return {};
      }

      return {};
    }
  };
}

function createConsumer(options = {}) {
  const sqs = options.sqs || createMockSqs();
  const processed = [];

  const consumer = createArticleEventConsumer({
    sqs,
    queueUrl: "http://localhost:4566/test-queue",
    processEvent: options.processEvent || (async event => {
      processed.push(event);
      return { status: "processed" };
    }),
    logger: {
      info: () => {},
      error: () => {}
    }
  });

  return { consumer, sqs, processed };
}

function message(body = '{"eventId":"event-1"}') {
  return {
    Body: body,
    ReceiptHandle: "receipt-test-123"
  };
}

test("successfully processed event is deleted", async () => {
  const { consumer, sqs, processed } = createConsumer();

  const result = await consumer.processMessage(message());

  assert.equal(result.status, "processed");
  assert.equal(processed.length, 1);
  assert.equal(sqs.calls.length, 1);
});

test("duplicate event is accepted and deleted", async () => {
  const { consumer, sqs } = createConsumer({
    processEvent: async () => ({ status: "duplicate" })
  });

  const result = await consumer.processMessage(message());

  assert.equal(result.status, "duplicate");
  assert.equal(sqs.calls.length, 1);
});

test("duplicate article event is accepted and deleted", async () => {
  const { consumer, sqs } = createConsumer({
    processEvent: async () => ({ status: "duplicate_article" })
  });

  const result = await consumer.processMessage(message());

  assert.equal(result.status, "duplicate_article");
  assert.equal(sqs.calls.length, 1);
});

test("invalid JSON is not deleted", async () => {
  const { consumer, sqs } = createConsumer();

  await assert.rejects(
    consumer.processMessage(message("{invalid-json")),
    /not valid JSON/
  );

  assert.equal(sqs.calls.length, 0);
});

test("missing message body is not deleted", async () => {
  const { consumer, sqs } = createConsumer();

  await assert.rejects(
    consumer.processMessage({ ReceiptHandle: "receipt-1" }),
    /missing required fields/
  );

  assert.equal(sqs.calls.length, 0);
});

test("missing receipt handle is not deleted", async () => {
  const { consumer, sqs } = createConsumer();

  await assert.rejects(
    consumer.processMessage({ Body: '{"eventId":"event-1"}' }),
    /missing required fields/
  );

  assert.equal(sqs.calls.length, 0);
});

test("database processing failure leaves message undeleted", async () => {
  const { consumer, sqs } = createConsumer({
    processEvent: async () => {
      throw new Error("Database unavailable");
    }
  });

  await assert.rejects(
    consumer.processMessage(message()),
    /Database unavailable/
  );

  assert.equal(sqs.calls.length, 0);
});

test("unexpected processing status leaves message undeleted", async () => {
  const { consumer, sqs } = createConsumer({
    processEvent: async () => ({ status: "failed" })
  });

  await assert.rejects(
    consumer.processMessage(message()),
    /Unexpected event processing result/
  );

  assert.equal(sqs.calls.length, 0);
});

test("SQS deletion failure is propagated", async () => {
  const sqs = createMockSqs({ failDelete: true });
  const { consumer } = createConsumer({ sqs });

  await assert.rejects(
    consumer.processMessage(message()),
    /Simulated SQS deletion failure/
  );

  assert.equal(sqs.calls.length, 1);
});

test("event processing finishes before deletion", async () => {
  let processingFinished = false;

  const sqs = {
    async send() {
      assert.equal(processingFinished, true);
      return {};
    }
  };

  const { consumer } = createConsumer({
    sqs,
    processEvent: async () => {
      await Promise.resolve();
      processingFinished = true;
      return { status: "processed" };
    }
  });

  await consumer.processMessage(message());

  assert.equal(processingFinished, true);
});

function deferred() {
  let resolve;
  const promise = new Promise(r => {
    resolve = r;
  });
  return { promise, resolve };
}

test("stop interrupts an outstanding SQS long poll", async () => {
  let receiveSignal;

  const sqs = {
    async send(command, options) {
      if (command.constructor.name === "ReceiveMessageCommand") {
        receiveSignal = options.abortSignal;

        return new Promise((resolve, reject) => {
          receiveSignal.addEventListener("abort", () => {
            const error = new Error("Polling aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      }

      return {};
    }
  };

  const { consumer } = createConsumer({ sqs });

  const running = consumer.start();

  while (!receiveSignal) {
    await new Promise(resolve => setImmediate(resolve));
  }

  await consumer.stop();
  await running;

  assert.equal(receiveSignal.aborted, true);
});

test("stop waits for an already-received event to finish", async () => {
  const processing = deferred();
  const processingStarted = deferred();
  let deleteCount = 0;

  const sqs = {
    async send(command) {
      if (command.constructor.name === "ReceiveMessageCommand") {
        return {
          Messages: [{
            Body: '{"eventId":"event-shutdown"}',
            ReceiptHandle: "receipt-shutdown"
          }]
        };
      }

      if (command.constructor.name === "DeleteMessageCommand") {
        deleteCount++;
        return {};
      }

      return {};
    }
  };

  const { consumer } = createConsumer({
    sqs,
    processEvent: async () => {
      processingStarted.resolve();
      await processing.promise;
      return { status: "processed" };
    }
  });

  const running = consumer.start();

  await processingStarted.promise;

  let stopped = false;
  const stopping = consumer.stop().then(() => {
    stopped = true;
  });

  await Promise.resolve();

  assert.equal(stopped, false);
  assert.equal(deleteCount, 0);

  processing.resolve();

  await stopping;
  await running;

  assert.equal(stopped, true);
  assert.equal(deleteCount, 1);
});
