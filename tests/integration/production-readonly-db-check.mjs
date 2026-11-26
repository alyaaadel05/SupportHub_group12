// SupportHub Group 12 - STRICTLY READ-ONLY production database checks.
//
//   node tests/integration/production-readonly-db-check.mjs roles      # which DB roles are connected
//   node tests/integration/production-readonly-db-check.mjs article21  # Article 21 source vs search index
//
// Credentials: the restricted per-service connection strings kept OUTSIDE the
// repository in %LOCALAPPDATA%\SupportHub\database-security\<svc>.database.env
// (never printed). Every query runs:
//   - as the restricted role that owns the table (article/search/editorial app roles),
//   - with options "-c default_transaction_read_only=on" AND inside BEGIN READ ONLY,
//   - only if it is a single SELECT (anything else throws before reaching the server).
// Output contains no secrets: role names, ids, statuses, timestamps, lengths and
// md5 digests only (article content itself is not printed).

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(path.join(ROOT, "services/search-analytics-service/package.json"));
const { Client } = require("pg");
const DIR = path.join(process.env.LOCALAPPDATA || "", "SupportHub", "database-security");
const MODE = process.argv[2];

function url(service) {
  const t = fs.readFileSync(path.join(DIR, `${service}.database.env`), "utf8");
  return t.match(/^DATABASE_URL_POOLED=(.+)$/m)[1].trim().replace(/^["']|["']$/g, "");
}
async function readOnly(service, queries) {
  const c = new Client({ connectionString: url(service), options: "-c default_transaction_read_only=on", connectionTimeoutMillis: 15000, statement_timeout: 15000, query_timeout: 20000 });
  await c.connect();
  try {
    await c.query("BEGIN READ ONLY");
    const out = {};
    const who = await c.query("SELECT current_user, session_user, current_setting('transaction_read_only') AS ro, current_database() AS db, (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl, (SELECT version FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS tls");
    // pg_stat_ssl describes Neon's internal pooler -> compute hop; the client hop is read from the socket.
    const sock = c.connection?.stream;
    out.whoami = { ...who.rows[0], client_tls: sock?.encrypted ? sock.getProtocol?.() : "none", client_cert_verified: sock?.authorized === true };
    for (const [name, sql, params] of queries) {
      if (!/^\s*SELECT\b/i.test(sql) || sql.includes(";")) throw new Error(`refusing non-SELECT query ${name}`);
      out[name] = (await c.query(sql, params || [])).rows;
    }
    await c.query("ROLLBACK");
    return out;
  } finally { await c.end(); }
}
const print = (label, value) => console.log(`${label}: ${JSON.stringify(value)}`);

if (MODE === "roles") {
  const r = await readOnly("search", [
    ["sessions", `SELECT usename, count(*)::int AS sessions, min(backend_start) AS first_start, max(backend_start) AS last_start
                  FROM pg_stat_activity WHERE datname = current_database() AND usename IS NOT NULL GROUP BY usename ORDER BY usename`],
    ["roles", `SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolcanlogin
               FROM pg_roles WHERE rolname LIKE 'supporthub_%' OR rolname LIKE '%owner%' ORDER BY rolname`],
    ["now", "SELECT now() AS server_time"]
  ]);
  print("connection", r.whoami);
  print("server_time", r.now[0].server_time);
  console.log("pg_stat_activity sessions by role:"); for (const s of r.sessions) console.log("  " + JSON.stringify(s));
  console.log("role attributes:"); for (const s of r.roles) console.log("  " + JSON.stringify(s));
}

if (MODE === "vercel-roles") {
  // Neon's pooler multiplexes clients onto one backend per role and hides client details, so a
  // single API call cannot be attributed to a backend. Proof used instead: call each deployed API's
  // health endpoint (runs SELECT 1 on its own pool), then list backends by role. Identity and Search
  // roles are used ONLY by their Vercel APIs; Article/Editorial roles also by the ECS workers.
  // neondb_owner must have no backend at all. No connection string is printed.
  const apis = [["article", "https://supporthub-article-service.vercel.app"], ["identity", "https://supporthub-identity-service.vercel.app"],
                ["editorial", "https://supporthub-editorial-service-group1.vercel.app"], ["search", "https://supporthub-search-analytics-group12.vercel.app"]];
  const codes = {};
  for (const [svc, base] of apis) codes[svc] = (await fetch(base + "/api/health", { signal: AbortSignal.timeout(20000) })).status;
  const r = await readOnly("search", [["s", `SELECT usename, count(*)::int AS n FROM pg_stat_activity
                                             WHERE datname = current_database() AND usename IS NOT NULL GROUP BY usename`]]);
  const n = Object.fromEntries(r.s.map(x => [x.usename, x.n]));
  let ok = 0, total = 0;
  const chk = (pass, line) => { total++; if (pass) ok++; console.log(`${pass ? "PASS" : "FAIL"} | ${line}`); };
  for (const [svc] of apis) chk(codes[svc] === 200 && (n[`supporthub_${svc}_app`] || 0) >= 1,
    `Vercel ${svc} health HTTP ${codes[svc]} (SELECT 1 on Neon) | backends of supporthub_${svc}_app: ${n[`supporthub_${svc}_app`] || 0}`);
  chk(!n.neondb_owner, `no neondb_owner backend while all four APIs are serving (owner backends: ${n.neondb_owner || 0})`);
  console.log("backends by role:", JSON.stringify(n));
  console.log(`Total: ${ok} passed, ${total - ok} failed`);
  process.exitCode = ok === total ? 0 : 1;
}

if (MODE === "pending") {
  // Cut-over planning: what is waiting in the production outboxes (counts and states only).
  const ed = await readOnly("editorial", [
    ["tables", `SELECT table_name FROM information_schema.tables WHERE table_schema='public'
                AND table_name IN ('editorial_publication_event_outbox','editorial_publication_event_receipts','editorial_event_inbox','publication_outbox') ORDER BY 1`],
    ["pubEvents", "SELECT state, count(*)::int AS n, min(created_at) AS oldest FROM editorial_publication_event_outbox GROUP BY state ORDER BY state"],
    ["receipts", "SELECT count(*)::int AS n FROM editorial_publication_event_receipts"],
    ["searchNotify", "SELECT state, count(*)::int AS n FROM publication_outbox GROUP BY state ORDER BY state"],
    ["inbox", "SELECT count(*)::int AS n, max(processed_at) AS last FROM editorial_event_inbox"]
  ]);
  const art = await readOnly("article", [
    ["outbox", "SELECT status, count(*)::int AS n, min(created_at) AS oldest FROM article_event_outbox GROUP BY status ORDER BY status"]
  ]);
  print("editorial tables present", ed.tables.map(t => t.table_name));
  print("editorial_publication_event_outbox by state", ed.pubEvents);
  print("editorial_publication_event_receipts", ed.receipts[0]);
  print("publication_outbox (Editorial -> Search) by state", ed.searchNotify);
  print("editorial_event_inbox", ed.inbox[0]);
  print("article_event_outbox by status", art.outbox);
}

if (MODE === "article21") {
  const art = await readOnly("article", [
    ["article", `SELECT id, status, author_id, category_id, created_at, updated_at, published_at,
                 length(title) AS title_len, md5(title) AS title_md5, length(content) AS content_len, md5(content) AS content_md5
                 FROM articles WHERE id = 21`],
    ["title", "SELECT title FROM articles WHERE id = 21"]
  ]);
  print("article-role connection", art.whoami);
  print("articles[21]", art.article[0]);
  print("articles[21].title", art.title[0]?.title);
  const idx = await readOnly("search", [
    ["columns", `SELECT column_name, data_type FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'search_published_articles' ORDER BY ordinal_position`],
    ["entry", `SELECT article_id, category_id, published_at, updated_at,
               length(title) AS title_len, md5(title) AS title_md5, length(content) AS content_len, md5(content) AS content_md5
               FROM search_published_articles WHERE article_id = 21`],
    ["index_size", "SELECT count(*)::int AS indexed_articles FROM search_published_articles"]
  ]);
  print("search-role connection", idx.whoami);
  print("search_published_articles columns", idx.columns);
  print("search_published_articles[21]", idx.entry[0] || null);
  print("index size", idx.index_size[0]);
  const ed = await readOnly("editorial", [
    ["events", "SELECT event_id, actor_id, previous_status, new_status, created_at FROM editorial_status_events WHERE article_id = 21 ORDER BY event_id"],
    ["reviews", "SELECT review_id, submitted_by, reviewer_id, decision, created_at, decided_at FROM editorial_reviews WHERE article_id = 21 ORDER BY review_id"],
    ["searchNotify", "SELECT outbox_id, state, attempts, created_at, delivered_at FROM publication_outbox WHERE article_id = 21 ORDER BY outbox_id"],
    ["flags", "SELECT flag_id, status, created_at, resolved_at FROM editorial_outdated_flags WHERE article_id = 21 ORDER BY flag_id"]
  ]);
  print("editorial-role connection", ed.whoami);
  print("editorial_status_events[21]", ed.events);
  print("editorial_reviews[21]", ed.reviews);
  print("publication_outbox[21] (Editorial -> Search notification)", ed.searchNotify);
  print("editorial_outdated_flags[21]", ed.flags);
  const a = art.article[0], s = idx.entry[0];
  const checks = [
    ["Article 21 exists in the Article Service table", Boolean(a)],
    ["Article 21 status = published", a?.status === "published"],
    ["Article 21 exists in the Search backend index (search_published_articles)", Boolean(s)],
    ["indexed article_id = source id", Number(s?.article_id) === 21],
    ["indexed title identical (md5)", s?.title_md5 === a?.title_md5],
    ["indexed content identical (md5 + length)", s?.content_md5 === a?.content_md5 && s?.content_len === a?.content_len],
    ["indexed category identical", String(s?.category_id) === String(a?.category_id)],
    ["indexed published_at = source published_at", s && a && new Date(s.published_at).getTime() === new Date(a.published_at).getTime()],
    ["index updated_at at/after publication", s && a && new Date(s.updated_at) >= new Date(a.published_at)],
    ["editorial history contains approved -> published", ed.events.some(e => e.previous_status === "approved" && e.new_status === "published")],
    ["Editorial -> Search publication notification delivered", ed.searchNotify.some(n => n.state === "delivered")]
  ];
  console.log("checks:"); let p = 0, f = 0;
  for (const [n, ok] of checks) { ok ? p++ : f++; console.log(`${ok ? "PASS" : "FAIL"} | ${n}`); }
  console.log(`Total: ${p} passed, ${f} failed`);
  process.exitCode = f ? 1 : 0;
}
