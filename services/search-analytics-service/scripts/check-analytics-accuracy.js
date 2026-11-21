// Checks (1) that opening an article records exactly one view and
// (2) that the analytics overview matches direct database counts.
// Uses the local service on port 3004 and the same Neon database (.env). Only reads, except the one view.
require("dotenv").config();
const pool = require("../db/pool");
const { overview } = require("../services/analyticsService");

const count = async (sql) => (await pool.query(sql)).rows[0].n;

(async () => {
  console.log("Analytics accuracy check —", new Date().toISOString());

  // 1. View tracking
  const before = await count("SELECT COUNT(*)::int AS n FROM article_views WHERE article_id = 1");
  const res = await fetch("http://127.0.0.1:3004/api/public/articles/1");
  const after = await count("SELECT COUNT(*)::int AS n FROM article_views WHERE article_id = 1");
  console.log(`1. Open article 1 -> HTTP ${res.status}; views ${before} -> ${after} (${after - before === 1 ? "PASS +1" : "FAIL"})`);

  // 2. Overview vs direct SQL
  const o = await overview();
  const checks = [
    ["totalSearches", o.totalSearches, "SELECT COUNT(*)::int AS n FROM search_query_logs"],
    ["zeroResultSearches", o.zeroResultSearches, "SELECT COUNT(*)::int AS n FROM search_query_logs WHERE result_count = 0"],
    ["totalArticleViews", o.totalArticleViews, "SELECT COUNT(*)::int AS n FROM article_views"],
    ["totalVotes", o.totalVotes, "SELECT COUNT(*)::int AS n FROM helpfulness_votes"],
    ["helpfulVotes", o.helpfulVotes, "SELECT COUNT(*)::int AS n FROM helpfulness_votes WHERE helpful"],
    ["unhelpfulVotes", o.unhelpfulVotes, "SELECT COUNT(*)::int AS n FROM helpfulness_votes WHERE NOT helpful"]
  ];
  let ok = 0;
  for (const [name, shown, sql] of checks) {
    const db = await count(sql);
    const pass = shown === db;
    if (pass) ok++;
    console.log(`2. ${name.padEnd(20)} dashboard=${shown}  database=${db}  ${pass ? "PASS" : "FAIL"}`);
  }
  const rate = o.totalSearches ? Math.round(10000 * (o.totalSearches - o.zeroResultSearches) / o.totalSearches) / 100 : 0;
  console.log(`3. searchSuccessRate    dashboard=${o.searchSuccessRate}%  recalculated=${rate}%  ${rate === o.searchSuccessRate ? "PASS" : "FAIL"}`);
  console.log(`Result: ${ok}/${checks.length} counts match`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });