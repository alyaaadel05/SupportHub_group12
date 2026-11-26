// SupportHub Group 12 - Search & Analytics: feedback is never lost when the
// sentiment result cannot be stored, and stuck rows can be recovered.
// ISOLATED stack only. A real fault is injected (no mock): a temporary
// NOT VALID check constraint on article_feedback makes the sentiment UPDATE
// fail for ONE isolated article only; existing rows are untouched and the
// constraint is always removed.
//
//   node tests/integration/search-sentiment-recovery-check.mjs fault     # inject, submit, remove fault
//   node tests/integration/search-sentiment-recovery-check.mjs recover   # run the recovery job, verify
//
// FEEDBACK_ARTICLE (default 238) must be published and indexed in the isolated DB.

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODE = process.argv[2];
const BASE = "http://localhost:8188", DB = "supporthub-iso-postgres", SEARCH = "supporthub-iso-search";
const ARTICLE = Number(process.env.FEEDBACK_ARTICLE || 238);
const STATE = path.join(process.env.TEMP || "/tmp", "supporthub-sentiment-recovery.json");
const PASSWORD = fs.readFileSync(path.join(ROOT, "infra/floci/.generated/isolated/demo-accounts.txt"), "utf8").match(/^password=(.+)$/m)[1].trim();
const PROBE = `sentiment_store_fault_probe_${ARTICLE}`;

let pass = 0, fail = 0; const lines = [];
const log = t => { lines.push(t); console.log(t); };
const check = (n, ok, d = "") => { ok ? pass++ : fail++; log(`${ok ? "PASS" : "FAIL"} | ${n}${d ? " | " + d : ""}`); return ok; };
const run = (cmd, args, timeout = 30000) => { try { return execFileSync(cmd, args, { encoding: "utf8", timeout }).trim(); } catch (e) { return `ERROR ${(e.stdout || "") + (e.stderr || "") || e.message}`.trim(); } };
const sql = q => run("docker", ["exec", DB, "psql", "-U", "supporthub", "-d", "supporthub", "-tAc", q], 20000);
const row = id => sql(`SELECT sentiment_status||'|'||coalesce(sentiment_label,'')||'|'||coalesce(sentiment_confidence::text,'')||'|'||comment_text FROM article_feedback WHERE feedback_id=${id}`);
const breakdown = () => sql("SELECT string_agg(sentiment_label||'='||n, ',' ORDER BY sentiment_label) FROM (SELECT sentiment_label, count(*) n FROM article_feedback WHERE sentiment_status='completed' AND sentiment_label IS NOT NULL GROUP BY 1) t");

let cookie = "", csrf = "";
async function req(method, url, body) {
  const h = { Accept: "application/json", Origin: BASE };
  if (cookie) h.Cookie = cookie;
  if (csrf && method !== "GET") h["X-CSRF-Token"] = csrf;
  if (body !== undefined) h["Content-Type"] = "application/json";
  const r = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  for (const c of r.headers.getSetCookie?.() || []) if (c.startsWith("supporthub.sid=")) cookie = c.split(";")[0];
  let data = {}; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
async function login(email) {
  cookie = ""; csrf = (await req("GET", "/api/auth/csrf")).data.csrfToken;
  const r = await req("POST", "/api/auth/login", { email, password: PASSWORD });
  if (r.data.csrfToken) csrf = r.data.csrfToken;
  return r;
}

log(`Sentiment failure/recovery check (${MODE}) - ${new Date().toISOString()}`);
if (MODE === "fault") {
  check(`isolated article ${ARTICLE} is published and indexed`, sql(`SELECT count(*) FROM search_published_articles WHERE article_id=${ARTICLE}`) === "1");
  check("login author2", (await login("author2@supporthub.test")).status === 200);
  log(`     add fault: ${sql(`ALTER TABLE article_feedback ADD CONSTRAINT ${PROBE} CHECK (article_id <> ${ARTICLE} OR sentiment_status = 'pending') NOT VALID`)}`);
  let id;
  try {
    const text = `Really helpful and clear article, great work! (fault ${Date.now()})`;
    const r = await req("POST", `/api/articles/${ARTICLE}/feedback`, { comment: text, turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" });
    id = r.data.feedbackId;
    check("feedback accepted although storing the sentiment fails (201, saved:true)", r.status === 201 && r.data.saved === true, `HTTP ${r.status} response sentiment=${JSON.stringify(r.data.sentiment)}`);
    const db = row(id);
    check("NO DATA LOSS: feedback text persisted, sentiment left 'pending'", db.startsWith("pending|||") && db.endsWith(text), db.slice(0, 120));
    // docker logs writes the container's stderr to stderr: capture both streams.
    const dl = spawnSync("docker", ["logs", "--since", "1m", SEARCH], { encoding: "utf8", timeout: 20000 });
    const logs = `${dl.stdout || ""}\n${dl.stderr || ""}`.split("\n").filter(l => /sentiment update failed/i.test(l));
    check("storage failure logged by the service", logs.length > 0, (logs[0] || "").slice(0, 160));
    log(`     note: the API response reported sentiment ${r.data.sentiment?.label} although it was not stored`);
    log(`     analytics breakdown (completed only): ${breakdown()}  (pending row not counted)`);
  } finally {
    log(`     remove fault: ${sql(`ALTER TABLE article_feedback DROP CONSTRAINT IF EXISTS ${PROBE}`)}`);
    check("fault constraint removed", sql(`SELECT count(*) FROM pg_constraint WHERE conname='${PROBE}'`) === "0");
  }
  fs.writeFileSync(STATE, JSON.stringify({ id }));
  log(`     STUCK_FEEDBACK_ID=${id}`);
}

if (MODE === "recover") {
  const { id } = JSON.parse(fs.readFileSync(STATE, "utf8"));
  const before = breakdown();
  check(`feedback ${id} is still 'pending' (no automatic retry happened)`, row(id).startsWith("pending|"), row(id).slice(0, 60));
  const hasJob = run("docker", ["exec", SEARCH, "test", "-f", "scripts/reprocess-sentiment.js"]) === "";
  if (!check("a recovery job for pending/unavailable sentiment exists in the deployed service", hasJob)) {
    log(`\nTotal: ${pass} passed, ${fail} failed`); if (process.env.OUT) fs.appendFileSync(process.env.OUT, lines.join("\n") + "\n"); process.exit(1);
  }
  const out1 = run("docker", ["exec", SEARCH, "node", "start.js", "scripts/reprocess-sentiment.js"], 60000);
  log(`     docker exec ${SEARCH} node start.js scripts/reprocess-sentiment.js -> ${out1.split("\n").filter(l => /reprocess/i.test(l)).join(" ")}`);
  const r1 = JSON.parse((out1.match(/Sentiment reprocess: (\{.*\})/) || [])[1] || "{}");
  check("recovery job completed the stuck row (completed >= 1, failed 0)", r1.completed >= 1 && r1.failed === 0, JSON.stringify(r1));
  const db = row(id);
  check("row now completed with a POSITIVE label and confidence; text unchanged", /^completed\|POSITIVE\|0\.\d+\|Really helpful and clear article/.test(db), db.slice(0, 90));
  const after = breakdown();
  log(`     analytics breakdown before: ${before}  after: ${after}`);
  check("recovered sentiment now counted in analytics (POSITIVE +1)", Number((after.match(/POSITIVE=(\d+)/) || [])[1]) === Number((before.match(/POSITIVE=(\d+)/) || [])[1]) + 1);
  const out2 = run("docker", ["exec", SEARCH, "node", "start.js", "scripts/reprocess-sentiment.js"], 60000);
  const r2 = JSON.parse((out2.match(/Sentiment reprocess: (\{.*\})/) || [])[1] || "{}");
  check("second run is a no-op (idempotent)", r2.checked === 0, JSON.stringify(r2));
  check("no pending/unavailable rows remain", sql("SELECT count(*) FROM article_feedback WHERE sentiment_status IN ('pending','unavailable')") === "0");
}
log(`\nTotal: ${pass} passed, ${fail} failed`);
if (process.env.OUT) fs.appendFileSync(process.env.OUT, lines.join("\n") + "\n");
process.exitCode = fail ? 1 : 0;
