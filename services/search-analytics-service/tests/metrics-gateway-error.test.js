// A non-JSON gateway reply (tunnel down: 502 "Floci unreachable", or an edge error page) made the
// CloudWatch SDK throw a bare SyntaxError. The failure must be reported with its HTTP status, must not
// throw, and a normal JSON reply must still succeed. Uses the REAL metricsService + awsClients.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

let reply = [200, "application/x-amz-json-1.0", "{}"];
const server = http.createServer((q, s) => { q.resume(); q.on("end", () => { s.writeHead(reply[0], { "content-type": reply[1] }); s.end(reply[2]); }); });

test.before(async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  Object.assign(process.env, { AWS_REGION: "us-east-1", AWS_ENDPOINT_URL: `http://127.0.0.1:${server.address().port}`,
    AWS_ACCESS_KEY_ID: "AKIATESTONLY", AWS_SECRET_ACCESS_KEY: "test-only", CLOUDWATCH_NAMESPACE: "SupportHub/Test" });
});
test.after(() => server.close());

async function flushWith(status, type, body) {
  reply = [status, type, body];
  const metrics = require("../services/metricsService");
  const logs = []; const orig = console.error; console.error = (...a) => logs.push(a.join(" "));
  try { metrics.record("Requests", 1); return { out: await metrics.flush(), log: logs.join(" ; ") }; } finally { console.error = orig; }
}

test("gateway 502 text (tunnel down) is reported with its status, not a bare SyntaxError", async () => {
  const { out, log } = await flushWith(502, "text/plain;charset=UTF-8", "Floci unreachable");
  assert.deepEqual(out, { sent: 0, failed: 1 });
  assert.match(log, /HTTP 502 - non-JSON response from the gateway/);
  assert.doesNotMatch(log, /failed: SyntaxError$/);
});

test("Cloudflare HTML error page is reported with its status", async () => {
  const { log } = await flushWith(530, "text/html", "<!DOCTYPE html><title>error code: 1033</title>");
  assert.match(log, /HTTP 530 - non-JSON response/);
});

test("a normal JSON reply still publishes", async () => {
  const { out, log } = await flushWith(200, "application/x-amz-json-1.0", "{}");
  assert.deepEqual(out, { sent: 1 }); assert.equal(log, "");
});
