// CloudWatch custom metrics (AWS service 2).
// Metrics are collected in memory and sent together in one PutMetricData call
// every few seconds, so a busy service does not make one AWS call per request.
// A CloudWatch failure is logged and never breaks the API.
const { PutMetricDataCommand } = require("@aws-sdk/client-cloudwatch");
const { cloudwatch } = require("./awsClients");

function namespace() { return process.env.CLOUDWATCH_NAMESPACE || ""; }
const MAX_PER_CALL = 1000;
let buffer = [];
let timer = null;

function record(name, value = 1, unit = "Count") {
  if (!namespace()) return false;
  buffer.push({ MetricName: name, Value: value, Unit: unit, Timestamp: new Date() });
  if (!timer) {
    timer = setInterval(flush, Number(process.env.METRICS_FLUSH_MS || 10000));
    timer.unref(); // never keeps the process alive on its own
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

// The CloudWatch SDK speaks AWS JSON 1.0, so a non-JSON error body - the Cloudflare gateway's
// "Floci unreachable" (502) or an edge error page when the tunnel is down - surfaces as a bare
// SyntaxError. Report the HTTP status and what it means instead (no body or secrets are logged).
function describeFailure(error) {
  const status = error?.$metadata?.httpStatusCode ?? error?.$response?.statusCode;
  const where = status ? `HTTP ${status}` : "no HTTP response";
  if (error?.name === "SyntaxError") return `${where} - non-JSON response from the gateway (Floci not reached: tunnel/host unavailable or request refused)`;
  return `${where} - ${error?.name || "Error"}`;
}

function pending() { return buffer.length; }

module.exports = { record, flush, pending, describeFailure };