"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { execFile } = require("node:child_process");
const path = require("node:path");
const { checkHealth } = require("../scripts/healthcheck");

const SCRIPT = path.join(__dirname, "..", "scripts", "healthcheck.js");

function reply(status, body) {
  return async () => ({
    status,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body)
  });
}

test("healthy only for 200 with status ok", async () => {
  assert.deepEqual(await checkHealth({ fetchImpl: reply(200, { status: "ok" }) }),
    { healthy: true, reason: "ok" });
});

test("unhealthy when the database check fails (500)", async () => {
  const result = await checkHealth({ fetchImpl: reply(500, { error: "Internal server error" }) });
  assert.equal(result.healthy, false);
  assert.equal(result.reason, "HTTP 500");
});

test("unhealthy for an unexpected body or invalid JSON", async () => {
  assert.equal((await checkHealth({ fetchImpl: reply(200, { status: "starting" }) })).healthy, false);
  assert.equal((await checkHealth({ fetchImpl: reply(200, "not json") })).healthy, false);
});

test("unhealthy when the API does not answer", async () => {
  const result = await checkHealth({
    fetchImpl: async () => { throw Object.assign(new Error("refused"), { name: "TypeError" }); }
  });
  assert.equal(result.healthy, false);
  assert.match(result.reason, /no response/);
});

test("unhealthy when the API hangs longer than the timeout", async () => {
  const server = http.createServer(() => {}).listen(0);
  try {
    const started = Date.now();
    const result = await checkHealth({
      url: `http://127.0.0.1:${server.address().port}/api/health`,
      timeoutMs: 200
    });
    assert.equal(result.healthy, false);
    assert.ok(Date.now() - started < 2000);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

// Runs the real script against a small fake API started in this test.
// execFile is asynchronous, so this process keeps answering requests
// while the script runs.
function startFakeApi(status) {
  const server = http.createServer((req, res) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(status === 200 ? { status: "ok" } : { error: "down" }));
  });
  return new Promise(resolve =>
    server.listen(0, "127.0.0.1", () => resolve(server)));
}

function runScript(port) {
  return new Promise(resolve => {
    execFile(process.execPath, [SCRIPT], {
      env: { ...process.env, PORT: String(port) }
    }, (error, stdout, stderr) => {
      resolve({ status: error ? error.code : 0, stdout, stderr });
    });
  });
}

test("script exits 0 when healthy and 1 when not", async () => {
  const healthy = await startFakeApi(200);
  const ok = await runScript(healthy.address().port);
  healthy.close();
  assert.equal(ok.status, 0, "output: " + ok.stdout + ok.stderr);
  assert.match(ok.stdout, /editorial health: ok/);

  const broken = await startFakeApi(500);
  const bad = await runScript(broken.address().port);
  broken.close();
  assert.equal(bad.status, 1, "output: " + bad.stdout + bad.stderr);
  assert.match(bad.stdout, /HTTP 500/);
});
