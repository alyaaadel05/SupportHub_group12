"use strict";

// Article Service CloudWatch custom metrics:
//   ArticlesCreated, ArticlesSubmitted, BackupsExported, BackupFailures (Count).
// Off unless CLOUDWATCH_NAMESPACE is set (e.g. SupportHub/Article). Metrics are buffered and sent
// in one PutMetricData call. On Vercel the function is frozen after the response, so the buffer is
// flushed BEFORE the response (flushOnServerless, bounded); elsewhere a background timer flushes it.
// A CloudWatch failure is logged and never breaks the API.

const {
  CloudWatchClient,
  PutMetricDataCommand
} = require("@aws-sdk/client-cloudwatch");
const { withFlociAccess } = require("../config/flociAccess");

const cloudwatch = withFlociAccess(new CloudWatchClient({
  region: process.env.AWS_REGION || "us-east-1",
  maxAttempts: 2,
  ...(process.env.AWS_ENDPOINT_URL ? { endpoint: process.env.AWS_ENDPOINT_URL } : {})
}));

const NAMES = new Set(["ArticlesCreated", "ArticlesSubmitted", "BackupsExported", "BackupFailures"]);
const MAX_PER_CALL = 1000;
let buffer = [];
let timer = null;

function namespace() {
  return process.env.CLOUDWATCH_NAMESPACE || "";
}

function record(name, value = 1) {
  if (!namespace() || !NAMES.has(name)) return false;
  buffer.push({ MetricName: name, Value: value, Unit: "Count", Timestamp: new Date() });
  if (!timer && !process.env.VERCEL) {
    timer = setInterval(flush, Number(process.env.METRICS_FLUSH_MS || 10000));
    timer.unref();
  }
  if (buffer.length >= MAX_PER_CALL) flush();
  return true;
}

async function flush() {
  if (!buffer.length || !namespace()) return { sent: 0 };
  const batch = buffer.splice(0, buffer.length);
  let sent = 0;
  try {
    for (let i = 0; i < batch.length; i += MAX_PER_CALL) {
      const chunk = batch.slice(i, i + MAX_PER_CALL);
      await cloudwatch.send(new PutMetricDataCommand({ Namespace: namespace(), MetricData: chunk }));
      sent += chunk.length;
    }
    return { sent };
  } catch (error) {
    console.error("CloudWatch metrics publish failed:", describeFailure(error));
    return { sent, failed: batch.length - sent };
  }
}

// On Vercel: send the buffer before the response, waiting at most timeoutMs. Elsewhere: no-op.
async function flushOnServerless(timeoutMs = 1500) {
  if (!process.env.VERCEL) return;
  await Promise.race([
    flush().catch(() => {}),
    new Promise(resolve => setTimeout(resolve, timeoutMs))
  ]);
}

// A non-JSON reply from the gateway (tunnel down / request refused) surfaces as a bare SyntaxError
// in the AWS JSON protocol; report the HTTP status instead (no body or secrets are logged).
function describeFailure(error) {
  const status = error?.$metadata?.httpStatusCode ?? error?.$response?.statusCode;
  const where = status ? `HTTP ${status}` : "no HTTP response";
  if (error?.name === "SyntaxError") return `${where} - non-JSON response from the gateway (Floci not reached: tunnel/host unavailable or request refused)`;
  return `${where} - ${error?.name || "Error"}`;
}

function pending() {
  return buffer.length;
}

module.exports = { record, flush, flushOnServerless, describeFailure, pending, cloudwatch };
