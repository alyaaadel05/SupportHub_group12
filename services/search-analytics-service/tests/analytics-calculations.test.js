// Analytics calculation tests. The real database pool is replaced by a fake one,
// so these tests never touch Neon. Each fake answer is matched by a piece of its SQL.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const calls = [];
let data;

const fakePool = {
  query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("generate_series")) return { rows: data.daily };
    if (sql.includes("views_last_7_days")) return { rows: data.trending };
    if (sql.includes("HAVING COUNT(*) >= $1")) return { rows: data.poorlyRated };
    if (sql.includes("sentiment_label")) return { rows: [] };
    if (sql.includes("clicked_searches")) return { rows: [{ clicked_searches: data.clicked }] };
    if (sql.includes("result_count > 0")) return { rows: [data.searches] };
    if (sql.includes("result_count=0 GROUP BY")) return { rows: data.gaps };
    if (sql.includes("LOWER(query_text) AS term")) return { rows: data.popular };
    if (sql.includes("COUNT(DISTINCT v.view_id)")) return { rows: data.mostViewed };
    if (sql.includes("AS unhelpful FROM helpfulness_votes")) return { rows: [data.votes] };
    if (sql.includes("FROM article_views")) return { rows: [{ total: data.views }] };
    throw new Error("Unexpected query in test: " + sql.slice(0, 60));
  }
};

// Put the fake pool in Node's module cache BEFORE loading the analytics service.
const poolPath = require.resolve(path.join(__dirname, "../db/pool"));
require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: fakePool };
const { overview, MIN_VOTES } = require("../services/analyticsService");

function sample() {
  return {
    searches: { total: 10, successful: 8, zero: 2 },
    views: 5,
    votes: { total: 4, helpful: 3, unhelpful: 1 },
    clicked: 4,
    popular: [{ term: "password", count: 6 }, { term: "router", count: 2 }],
    gaps: [{ term: "router", count: 2 }],
    mostViewed: [{ article_id: "1", title: "How to Reset Your Password", views: 5, helpful_votes: 3, unhelpful_votes: 1 }],
    poorlyRated: [],
    daily: Array.from({ length: 7 }, (_, i) => ({ day: "2026-11-" + (14 + i), searches: i, views: 0, votes: 0 })),
    trending: [{ article_id: "1", title: "How to Reset Your Password", views_last_7_days: 5 }]
  };
}

test("totals and percentages are calculated correctly", async () => {
  data = sample();
  const r = await overview();
  assert.equal(r.totalSearches, 10);
  assert.equal(r.successfulSearches, 8);
  assert.equal(r.zeroResultSearches, 2);
  assert.equal(r.searchSuccessRate, 80);
  assert.equal(r.zeroResultRate, 20);
  assert.equal(r.clickThroughRate, 40);
  assert.equal(r.totalArticleViews, 5);
  assert.equal(r.helpfulVotes, 3);
  assert.equal(r.unhelpfulVotes, 1);
  assert.equal(r.helpfulnessRate, 75);
});

test("no data gives 0% instead of errors or NaN", async () => {
  data = sample();
  data.searches = { total: 0, successful: 0, zero: 0 };
  data.votes = { total: 0, helpful: 0, unhelpful: 0 };
  data.clicked = 0;
  data.views = 0;
  const r = await overview();
  assert.equal(r.searchSuccessRate, 0);
  assert.equal(r.zeroResultRate, 0);
  assert.equal(r.clickThroughRate, 0);
  assert.equal(r.helpfulnessRate, 0);
});

test("percentages are rounded to 2 decimals", async () => {
  data = sample();
  data.searches = { total: 3, successful: 2, zero: 1 };
  const r = await overview();
  assert.equal(r.searchSuccessRate, 66.67);
  assert.equal(r.zeroResultRate, 33.33);
});

test("most-searched, zero-result terms, most-viewed and trending are passed through", async () => {
  data = sample();
  const r = await overview();
  assert.equal(r.popularSearchTerms[0].term, "password");
  assert.equal(r.knowledgeGaps[0].term, "router");
  assert.equal(r.mostViewedArticles[0].views, 5);
  assert.equal(r.trendingArticles[0].views_last_7_days, 5);
});

test("daily activity always has 7 days", async () => {
  data = sample();
  const r = await overview();
  assert.equal(r.dailyActivity.length, 7);
});

test("poorly rated query uses the minimum-vote rule (default 3) as a SQL parameter", async () => {
  data = sample();
  calls.length = 0;
  const r = await overview();
  const poorly = calls.find(c => c.sql.includes("HAVING COUNT(*) >= $1"));
  assert.deepEqual(poorly.params, [3]);
  assert.equal(MIN_VOTES, 3);
  assert.equal(r.poorlyRatedMinVotes, 3);
});