"use strict";

// Feature B: Article CloudWatch metrics (ArticlesCreated, ArticlesSubmitted, BackupsExported,
// BackupFailures). Real metricsService + CloudWatch SDK against a local stub endpoint.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unit-test@127.0.0.1:1/none";

let reply = [200, "application/x-amz-json-1.0", "{}"];
const received = [];
const server = http.createServer((q, s) => {
  let b = ""; q.on("data", d => b += d);
  q.on("end", () => { received.push({ target: q.headers["x-amz-target"], body: b }); s.writeHead(reply[0], { "content-type": reply[1] }); s.end(reply[2]); });
});

let metrics;
test.before(async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  Object.assign(process.env, { AWS_REGION: "us-east-1", AWS_ENDPOINT_URL: `http://127.0.0.1:${server.address().port}`,
    AWS_ACCESS_KEY_ID: "AKIATESTONLY", AWS_SECRET_ACCESS_KEY: "test-only", CLOUDWATCH_NAMESPACE: "SupportHub/Article" });
  metrics = require("../services/metricsService");
});
test.after(() => server.close());
test.beforeEach(() => { received.length = 0; reply = [200, "application/x-amz-json-1.0", "{}"]; });

test("buffers the four metrics and sends them in ONE PutMetricData to SupportHub/Article", async () => {
  for (const n of ["ArticlesCreated", "ArticlesSubmitted", "BackupsExported", "BackupFailures"]) assert.equal(metrics.record(n), true);
  assert.equal(metrics.pending(), 4);
  assert.deepEqual(await metrics.flush(), { sent: 4 });
  assert.equal(received.length, 1);
  assert.equal(received[0].target, "GraniteServiceVersion20100801.PutMetricData");
  const body = JSON.parse(received[0].body);
  assert.equal(body.Namespace, "SupportHub/Article");
  assert.deepEqual(body.MetricData.map(m => m.MetricName), ["ArticlesCreated", "ArticlesSubmitted", "BackupsExported", "BackupFailures"]);
  assert.ok(body.MetricData.every(m => m.Unit === "Count" && m.Value === 1));
});

test("unknown metric names are ignored", () => {
  assert.equal(metrics.record("Whatever"), false);
  assert.equal(metrics.pending(), 0);
});

test("disabled without CLOUDWATCH_NAMESPACE (no AWS call)", async () => {
  const saved = process.env.CLOUDWATCH_NAMESPACE; delete process.env.CLOUDWATCH_NAMESPACE;
  try { assert.equal(metrics.record("ArticlesCreated"), false); assert.deepEqual(await metrics.flush(), { sent: 0 }); assert.equal(received.length, 0); }
  finally { process.env.CLOUDWATCH_NAMESPACE = saved; }
});

test("on Vercel the buffer is flushed before the response", async () => {
  process.env.VERCEL = "1";
  try { metrics.record("ArticlesCreated"); await metrics.flushOnServerless(); assert.equal(received.length, 1); assert.equal(metrics.pending(), 0); }
  finally { delete process.env.VERCEL; }
});

test("outside Vercel flushOnServerless does nothing (timer flush instead)", async () => {
  metrics.record("ArticlesCreated");
  await metrics.flushOnServerless();
  assert.equal(received.length, 0);
  await metrics.flush();
});

test("a slow CloudWatch never delays the Vercel response beyond the bound", async () => {
  process.env.VERCEL = "1";
  const slow = http.createServer(() => {}); await new Promise(r => slow.listen(0, "127.0.0.1", r));
  const saved = process.env.AWS_ENDPOINT_URL;
  try {
    metrics.cloudwatch.config.endpoint = async () => ({ protocol: "http:", hostname: "127.0.0.1", port: slow.address().port, path: "/" });
    metrics.record("ArticlesCreated");
    const t0 = Date.now(); await metrics.flushOnServerless(200); const ms = Date.now() - t0;
    assert.ok(ms < 1000, `took ${ms} ms`);
  } finally {
    delete process.env.VERCEL; process.env.AWS_ENDPOINT_URL = saved;
    slow.closeAllConnections?.(); slow.close();
  }
});

test("gateway error page is logged with its HTTP status, never throws", async () => {
  // fresh module so the endpoint override of the previous test does not apply
  delete require.cache[require.resolve("../services/metricsService")];
  metrics = require("../services/metricsService");
  reply = [502, "text/plain;charset=UTF-8", "Floci unreachable"];
  const logs = []; const orig = console.error; console.error = (...a) => logs.push(a.join(" "));
  try { metrics.record("BackupFailures"); assert.deepEqual(await metrics.flush(), { sent: 0, failed: 1 }); }
  finally { console.error = orig; }
  assert.match(logs.join(" "), /HTTP 502 - non-JSON response from the gateway/);
});

// ---------------------------------------------------------------- controller wiring
function fakeRes() { return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }; }
const req = (extra = {}) => ({ params: { id: "6", versionId: "14" }, body: {}, user: { id: 5, role: "author" }, app: { locals: { audit: async () => {} } }, ...extra });

test("controllers record the right metric only on the right outcome", async t => {
  const articles = require("../services/articleService");
  const backup = require("../services/articleBackupService");
  const recorded = [];
  t.mock.method(metrics, "record", n => { recorded.push(n); return true; });
  t.mock.method(metrics, "flushOnServerless", async () => {});
  // controllers must use the same module instance
  delete require.cache[require.resolve("../controllers/articleController")];
  delete require.cache[require.resolve("../controllers/versionController")];
  const ac = require("../controllers/articleController");
  const vc = require("../controllers/versionController");

  t.mock.method(articles, "create", async () => ({ id: 6 }));
  await ac.create(req(), fakeRes(), e => assert.fail(e));
  t.mock.method(articles, "transitionStatus", async () => ({ id: 6, status: "in_review" }));
  await ac.submit(req(), fakeRes(), e => assert.fail(e));
  t.mock.method(articles, "transitionStatus", async () => null);          // 409: not counted
  await ac.submit(req(), fakeRes(), e => assert.fail(e));
  t.mock.method(backup, "exportVersion", async () => ({ key: "k" }));
  await vc.exportBackup(req(), fakeRes(), e => assert.fail(e));
  const fail = s => { const e = new Error("x"); e.status = s; return e; };
  t.mock.method(backup, "exportVersion", async () => { throw fail(503); });
  await vc.exportBackup(req(), fakeRes(), () => {});
  t.mock.method(backup, "exportVersion", async () => { throw fail(403); }); // not a backup failure
  await vc.exportBackup(req(), fakeRes(), () => {});

  assert.deepEqual(recorded, ["ArticlesCreated", "ArticlesSubmitted", "BackupsExported", "BackupFailures"]);
});
