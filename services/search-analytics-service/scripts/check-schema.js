// Read-only schema check for the Search & Analytics tables on the database in .env.
// Only SELECTs from information_schema / pg_indexes. Never changes anything.
require("dotenv").config();
const pool = require("../db/pool");
const TABLES = ["search_published_articles", "search_query_logs", "search_result_clicks",
  "article_views", "helpfulness_votes", "article_feedback"];

(async () => {
  const host = (process.env.DATABASE_URL_POOLED || "").replace(/^.*@([^.]+).*$/, "$1");
  console.log("Schema check —", new Date().toISOString(), "— endpoint:", host);
  for (const t of TABLES) {
    const cols = await pool.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t]);
    if (!cols.rows.length) { console.log(`\n✗ ${t}: MISSING`); continue; }
    const idx = await pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename=$1 ORDER BY 1`, [t]);
    const con = await pool.query(
      `SELECT conname, contype FROM pg_constraint WHERE conrelid = ('public.' || $1)::regclass ORDER BY 1`, [t]);
    console.log(`\n✓ ${t}`);
    console.log("  columns:", cols.rows.map(c => `${c.column_name}(${c.data_type}${c.is_nullable === "NO" ? ",not null" : ""})`).join(", "));
    console.log("  indexes:", idx.rows.map(i => i.indexname).join(", ") || "none");
    console.log("  constraints:", con.rows.map(c => `${c.conname}[${({p:"PK",f:"FK",u:"UNIQUE",c:"CHECK"})[c.contype] || c.contype}]`).join(", ") || "none");
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });