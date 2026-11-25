// Search cache tests: run with a fake database, so nothing touches Neon.
process.env.SEARCH_CACHE_MS = "5000";

const test = require("node:test");
const assert = require("node:assert");

// ---- fake database: counts how many times the article list is loaded ----
let articles = [
  { article_id: 1, title: "Reset your password", content: "Steps to reset a password.", category_id: 1, category_name: "Account", published_at: "2026-11-01T10:00:00Z" },
  { article_id: 2, title: "Billing invoice explained", content: "How to read your invoice.", category_id: 2, category_name: "Billing", published_at: "2026-11-02T10:00:00Z" },
  { article_id: 3, title: "Refund policy", content: "When refunds are possible.", category_id: 2, category_name: "Billing", published_at: "2026-11-03T10:00:00Z" }
];
let listQueries = 0;

const fakePool = {
  async query(sql, params = []) {
    if (/^\s*SELECT/i.test(sql) && /FROM search_published_articles/i.test(sql) && !/WHERE/i.test(sql)) {
      listQueries++;
      await new Promise(r => setTimeout(r, 20)); // slow on purpose so requests overlap
      return { rows: articles.map(a => ({ ...a })) };
    }
    if (/INSERT INTO search_query_logs/i.test(sql)) return { rows: [{ search_id: 1 }] };
    if (/DELETE FROM search_published_articles/i.test(sql)) {
      const before = articles.length;
      articles = articles.filter(a => a.article_id !== Number(params[0]));
      return { rowCount: before - articles.length, rows: [] };
    }
    return { rows: [], rowCount: 0 };
  }
};

// Replace the real database, DynamoDB counters and CloudWatch metrics with fakes
function fake(relPath, exports) {
  const file = require.resolve(relPath);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
fake("../db/pool", fakePool);
fake("../services/countersService", { recordSearch() {}, recordView() {} });
fake("../services/metricsService", { record() {} });

const { search } = require("../services/searchService");
const { removeUnpublished } = require("../services/indexService");

test("20 simultaneous searches load the article list from the database only once", async () => {
  listQueries = 0;
  const results = await Promise.all(Array.from({ length: 20 }, () => search({ q: "invoice" })));
  assert.strictEqual(listQueries, 1);
  for (const r of results) assert.strictEqual(r.total, 1);
});

test("category filter still works on the cached list", async () => {
  const before = listQueries;
  const r = await search({ q: "", category: "2" });
  assert.strictEqual(listQueries, before); // served from cache, no new query
  assert.deepStrictEqual(r.results.map(a => a.article_id).sort(), [2, 3]);
});

test("unpublished article disappears from search immediately (cache cleared)", async () => {
  assert.strictEqual((await search({ q: "invoice" })).total, 1);
  const removed = await removeUnpublished(2);
  assert.deepStrictEqual(removed, { removed: true });
  const after = await search({ q: "invoice" });
  assert.strictEqual(after.total, 0);
});