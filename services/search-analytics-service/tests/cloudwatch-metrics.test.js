const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { cloudwatch } = require("../services/awsClients");
const metrics = require("../services/metricsService");
const { requestMetrics } = require("../middleware/metrics");

// Replace the real CloudWatch call with a fake one, so these tests need no AWS.
function fakeCloudWatch(handler) {
  const sent = [];
  cloudwatch.send = async (command) => { sent.push(command.input); return handler(command.input); };
  return sent;
}

test("metrics are skipped when no namespace is configured", async () => {
  delete process.env.CLOUDWATCH_NAMESPACE;
  const sent = fakeCloudWatch(() => ({}));
  assert.equal(metrics.record("Searches"), false);
  await metrics.flush();
  assert.equal(sent.length, 0);
});

test("recorded metrics are sent together in one PutMetricData call", async () => {
  process.env.CLOUDWATCH_NAMESPACE = "SupportHub/Search";
  const sent = fakeCloudWatch(() => ({}));
  metrics.record("Searches");
  metrics.record("ZeroResultSearches");
  const result = await metrics.flush();
  assert.equal(result.sent, 2);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].Namespace, "SupportHub/Search");
  assert.deepEqual(sent[0].MetricData.map(m => m.MetricName), ["Searches", "ZeroResultSearches"]);
  assert.equal(metrics.pending(), 0);
});

test("CloudWatch failure is reported but does not throw", async () => {
  process.env.CLOUDWATCH_NAMESPACE = "SupportHub/Search";
  fakeCloudWatch(() => { const e = new Error("down"); e.name = "ServiceUnavailable"; throw e; });
  metrics.record("Searches");
  const result = await metrics.flush();
  assert.equal(result.failed, 1);
});

test("request middleware records count, latency and client errors", async () => {
  process.env.CLOUDWATCH_NAMESPACE = "SupportHub/Search";
  const sent = fakeCloudWatch(() => ({}));
  const res = new EventEmitter();
  res.statusCode = 404;
  let calledNext = false;
  requestMetrics({}, res, () => { calledNext = true; });
  res.emit("finish");
  await metrics.flush();
  const names = sent[0].MetricData.map(m => m.MetricName);
  assert.equal(calledNext, true);
  assert.deepEqual(names, ["Requests", "LatencyMs", "ClientErrors"]);
  assert.equal(sent[0].MetricData[1].Unit, "Milliseconds");
});

test("server errors and rate limits are recorded separately", async () => {
  process.env.CLOUDWATCH_NAMESPACE = "SupportHub/Search";
  const sent = fakeCloudWatch(() => ({}));
  for (const code of [500, 429]) {
    const res = new EventEmitter();
    res.statusCode = code;
    requestMetrics({}, res, () => {});
    res.emit("finish");
  }
  await metrics.flush();
  const names = sent[0].MetricData.map(m => m.MetricName);
  assert.ok(names.includes("ServerErrors"));
  assert.ok(names.includes("RateLimited"));
});