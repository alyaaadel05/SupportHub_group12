
"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");

const workerPath = path.join(
  __dirname,
  "articleOutboxWorker.js"
);

const intervalMs = 5000;

let running = true;
let child = null;

function runWorker() {
  if (!running) return;

  child = spawn(
    process.execPath,
    [workerPath],
    {
      stdio: "inherit",
      env: process.env
    }
  );

  child.on("error", (error) => {
    console.error("Outbox worker failed:", error.message);
  });

  child.on("close", (code) => {
    child = null;

    if (code !== 0) {
      console.error("Outbox worker exited:", code);
    }

    if (running) {
      setTimeout(runWorker, intervalMs);
    }
  });
}

function stopScheduler() {
  running = false;

  if (child) {
    child.kill("SIGTERM");
  }
}

process.on("SIGINT", stopScheduler);
process.on("SIGTERM", stopScheduler);

console.log("Article SQS outbox scheduler started");
runWorker();

