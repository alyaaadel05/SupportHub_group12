
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workerFile = path.join(
  __dirname,
  "../services/articleOutboxWorker.js"
);

test("Outbox records failures and keeps events retryable", () => {
  const source = fs.readFileSync(workerFile, "utf8");

  assert.match(source, /FOR UPDATE SKIP LOCKED/);
  assert.match(source, /attempts = attempts \+ 1/);
  assert.match(source, /last_error = \$2/);
  assert.match(source, /Event delivery failed/);
  assert.match(source, /status = 'published'/);
});

test("Scheduler automatically repeats worker execution", () => {
  const schedulerFile = path.join(
    __dirname,
    "../services/articleOutboxScheduler.js"
  );

  const source = fs.readFileSync(schedulerFile, "utf8");

  assert.match(source, /setTimeout\(runWorker, intervalMs\)/);
  assert.match(source, /intervalMs = 5000/);
});
