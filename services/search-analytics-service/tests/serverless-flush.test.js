// On Vercel the buffered DynamoDB counters / CloudWatch metrics are flushed before the
// response (timers do not run while the function is frozen). Elsewhere nothing changes.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const calls = { counters: 0, metrics: 0 };
let slow = false;
const stub = (file, exports) => { const p = require.resolve(path.join(__dirname, file)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub("../db/pool", { query: async () => ({ rows: [] }) });
stub("../services/countersService", { flush: async () => { calls.counters++; if (slow) await new Promise(r => setTimeout(r, 5000)); return { sent: 1 }; }, recordSearch() {}, recordView() {} });
stub("../services/metricsService", { flush: async () => { calls.metrics++; return {}; }, record() {} });
const { flushOnServerless } = require("../services/searchService");

test("flushes counters and metrics on Vercel", async () => {
  process.env.VERCEL = "1"; calls.counters = calls.metrics = 0; slow = false;
  await flushOnServerless();
  assert.equal(calls.counters, 1); assert.equal(calls.metrics, 1);
});

test("does nothing outside Vercel (Docker keeps its interval flush)", async () => {
  delete process.env.VERCEL; calls.counters = calls.metrics = 0;
  await flushOnServerless();
  assert.equal(calls.counters, 0); assert.equal(calls.metrics, 0);
});

test("a slow flush never delays the response beyond the bound", async () => {
  process.env.VERCEL = "1"; slow = true;
  const t0 = Date.now(); await flushOnServerless(200); const ms = Date.now() - t0;
  assert.ok(ms < 1000, `took ${ms} ms`);
  delete process.env.VERCEL; slow = false;
});
