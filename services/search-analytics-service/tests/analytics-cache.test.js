// Proves the analytics cache: many simultaneous dashboard requests run the 11 queries only once.
process.env.ANALYTICS_CACHE_MS = "15000";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

let queries = 0;
const fakePool = {
  query: async () => { queries++; await new Promise(r => setTimeout(r, 20));
    return { rows: [{ total: 0, successful: 0, zero: 0, helpful: 0, unhelpful: 0, clicked_searches: 0 }] }; }
};
const poolPath = require.resolve(path.join(__dirname, "../db/pool"));
require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: fakePool };
const { overview, clearOverviewCache } = require("../services/analyticsService");

test("50 simultaneous dashboard requests run the analytics queries only once", async () => {
  clearOverviewCache(); queries = 0;
  const results = await Promise.all(Array.from({ length: 50 }, () => overview()));
  assert.equal(results.length, 50);
  assert.equal(queries, 11);
});

test("a request within the cache time reuses the result without new queries", async () => {
  queries = 0;
  await overview();
  assert.equal(queries, 0);
});

test("clearing the cache recalculates", async () => {
  clearOverviewCache(); queries = 0;
  await overview();
  assert.equal(queries, 11);
});