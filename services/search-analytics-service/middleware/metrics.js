// Records one set of CloudWatch metrics for every API request:
// request count, response time, and 4xx / 5xx / 429 responses.
const metrics = require("../services/metricsService");

function requestMetrics(req, res, next) {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    metrics.record("Requests", 1);
    metrics.record("LatencyMs", Math.round(ms * 100) / 100, "Milliseconds");
    if (res.statusCode >= 500) metrics.record("ServerErrors", 1);
    else if (res.statusCode >= 400) metrics.record("ClientErrors", 1);
    if (res.statusCode === 429) metrics.record("RateLimited", 1);
  });
  next();
}

module.exports = { requestMetrics };