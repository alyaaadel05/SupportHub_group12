// SupportHub Group 12 - Search & Analytics: feedback sentiment, end to end.
// ISOLATED stack only (proxy :8188, supporthub-iso-postgres). Real HTTP
// requests, the real in-process sentiment model ("sentiment" npm library,
// AFINN-165) and Cloudflare Turnstile with the official always-pass TEST
// secret configured in the isolated Secrets Manager. No mocks.
//
//   node tests/integration/search-sentiment-check.mjs
//
// ARTICLE_ID (default 236) must be a published, indexed article in the isolated DB.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(path.join(ROOT, "services/search-analytics-service/package.json"));
const Sentiment = require("sentiment");          // same library + version the service uses
const model = new Sentiment();
const BASE = "http://localhost:8188", DB = "supporthub-iso-postgres";
const ARTICLE = Number(process.env.ARTICLE_ID || 236);
const DRAFT = Number(process.env.DRAFT_ID || 237);
const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX"; // Cloudflare documented dummy token for test secrets
const PASSWORD = fs.readFileSync(path.join(ROOT, "infra/floci/.generated/isolated/demo-accounts.txt"), "utf8").match(/^password=(.+)$/m)[1].trim();

let pass = 0, fail = 0; const lines = [];
const log = t => { lines.push(t); console.log(t); };
const check = (n, ok, d = "") => { ok ? pass++ : fail++; log(`${ok ? "PASS" : "FAIL"} | ${n}${d ? " | " + d : ""}`); return ok; };
const sql = q => { try { return execFileSync("docker", ["exec", DB, "psql", "-U", "supporthub", "-d", "supporthub", "-tAc", q], { encoding: "utf8", timeout: 20000 }).trim(); } catch (e) { return `ERROR ${e.message.split("\n")[0]}`; } };

class Client {
  constructor(label) { this.label = label; this.cookie = ""; this.csrf = null; }
  async req(method, url, { body, csrf = true, origin = BASE } = {}) {
    const h = { Accept: "application/json" };
    if (origin) h.Origin = origin;
    if (this.cookie) h.Cookie = this.cookie;
    if (body !== undefined) h["Content-Type"] = "application/json";
    if (csrf && method !== "GET") { if (!this.csrf) await this.fetchCsrf(); h["X-CSRF-Token"] = this.csrf; }
    const r = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    for (const c of r.headers.getSetCookie?.() || []) if (c.startsWith("supporthub.sid=")) this.cookie = c.split(";")[0];
    let data = {}; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  }
  async fetchCsrf() { this.csrf = (await this.req("GET", "/api/auth/csrf")).data.csrfToken; }
  async login(email) {
    await this.fetchCsrf();
    const r = await this.req("POST", "/api/auth/login", { body: { email, password: PASSWORD } });
    if (r.data.csrfToken) this.csrf = r.data.csrfToken;
    this.id = r.data.user?.id; return r;
  }
}
const feedback = (c, text, extra = {}) => c.req("POST", `/api/articles/${ARTICLE}/feedback`, { body: { comment: text, turnstileToken: TURNSTILE_TEST_TOKEN, ...extra } });
const expected = text => { const s = model.analyze(text).comparative; return { label: s > 0 ? "POSITIVE" : s < 0 ? "NEGATIVE" : "NEUTRAL", confidence: Number(Math.min(1, Math.abs(s) / (1 + Math.abs(s))).toFixed(4)), score: s }; };
const row = idv => sql(`SELECT article_id||'|'||user_id||'|'||sentiment_status||'|'||coalesce(sentiment_label,'')||'|'||coalesce(sentiment_confidence::text,'')||'|'||comment_text FROM article_feedback WHERE feedback_id=${idv}`);

log(`Feedback sentiment verification (isolated) - ${new Date().toISOString()}`);
log(`model: sentiment ${require("sentiment/package.json").version} (AFINN-165, in-process, no external API/token); article ${ARTICLE}`);
check("target article is published and indexed in Search", sql(`SELECT count(*) FROM search_published_articles WHERE article_id=${ARTICLE}`) === "1");
const author = new Client("author"), author2 = new Client("author2"), editor = new Client("editor"), anon = new Client("anon");
for (const [c, e] of [[author, "author"], [author2, "author2"], [editor, "editor"]]) { const r = await c.login(`${e}@supporthub.test`); check(`login ${e}`, r.status === 200, `HTTP ${r.status} id=${c.id}`); }
const before = sql("SELECT count(*) FROM article_feedback");

log("\n== 1. Positive / negative / neutral feedback through the application");
const stamp = Date.now();
const samples = [
  ["positive", `This guide is excellent and very helpful, thank you! (${stamp})`, "POSITIVE"],
  ["negative", `Terrible instructions, the steps are wrong and confusing. (${stamp})`, "NEGATIVE"],
  ["neutral", `The article describes the VPN settings page and the profile import menu. (${stamp})`, "NEUTRAL"]
];
const ids = {};
for (const [kind, text, want] of samples) {
  const r = await feedback(author, text);
  const exp = expected(text);
  ids[kind] = r.data.feedbackId;
  check(`${kind} feedback accepted (201) with sentiment in the response`, r.status === 201 && r.data.saved === true && r.data.sentiment?.status === "completed", `HTTP ${r.status} ${JSON.stringify(r.data.sentiment || r.data.error)}`);
  check(`${kind}: label ${want} (model comparative score ${exp.score.toFixed(4)})`, r.data.sentiment?.label === want && exp.label === want);
  check(`${kind}: confidence equals the implemented heuristic |s|/(1+|s|) = ${exp.confidence}`, r.data.sentiment?.confidence === exp.confidence, `${r.data.sentiment?.confidence}`);
  const db = row(ids[kind]);
  check(`${kind}: persisted row (article, user, completed, label, confidence, text)`,
    db === `${ARTICLE}|${author.id}|completed|${want}|${exp.confidence}|${text}`, db.slice(0, 160));
}
check("exactly 3 new feedback rows", Number(sql("SELECT count(*) FROM article_feedback")) - Number(before) === 3);

log("\n== 2. Analytics API and dashboard values vs database");
let r = await editor.req("GET", "/api/analytics/overview");
const api = Object.fromEntries((r.data.sentimentBreakdown || []).map(x => [x.label, Number(x.count)]));
const dbRows = sql("SELECT sentiment_label||'='||count(*) FROM article_feedback WHERE sentiment_status='completed' AND sentiment_label IS NOT NULL GROUP BY sentiment_label ORDER BY 1");
const dbMap = Object.fromEntries(dbRows.split("\n").filter(Boolean).map(l => { const [k, v] = l.split("="); return [k, Number(v)]; }));
log(`     API sentimentBreakdown: ${JSON.stringify(r.data.sentimentBreakdown)}`);
log(`     DB  completed by label: ${JSON.stringify(dbMap)}`);
check("editor GET /api/analytics/overview -> 200 with sentimentBreakdown", r.status === 200 && Array.isArray(r.data.sentimentBreakdown), `HTTP ${r.status}`);
check("API breakdown equals the database counts (the dashboard renders this array verbatim)", JSON.stringify(Object.keys(api).sort().map(k => [k, api[k]])) === JSON.stringify(Object.keys(dbMap).sort().map(k => [k, dbMap[k]])));
check("all three labels present after the new feedback", ["POSITIVE", "NEGATIVE", "NEUTRAL"].every(k => api[k] >= 1));

log("\n== 3. Authorization and roles");
r = await anon.req("POST", `/api/articles/${ARTICLE}/feedback`, { body: { comment: "anon", turnstileToken: TURNSTILE_TEST_TOKEN } });
check("anonymous feedback -> 401", r.status === 401, `HTTP ${r.status}`);
r = await author.req("POST", `/api/articles/${ARTICLE}/feedback`, { body: { comment: "no csrf", turnstileToken: TURNSTILE_TEST_TOKEN }, csrf: false });
check("feedback without CSRF token -> 403", r.status === 403, `HTTP ${r.status}`);
r = await author.req("POST", `/api/articles/${ARTICLE}/feedback`, { body: { comment: "evil origin", turnstileToken: TURNSTILE_TEST_TOKEN }, origin: "https://evil.example" });
check("feedback from a foreign Origin -> 403", r.status === 403, `HTTP ${r.status}`);
r = await author.req("POST", `/api/articles/${ARTICLE}/feedback`, { body: { comment: "no turnstile" } });
check("feedback without Turnstile token -> 403", r.status === 403, `HTTP ${r.status} ${r.data.error || ""}`);
r = await author.req("GET", "/api/analytics/overview");
check("author cannot read sentiment analytics -> 403", r.status === 403, `HTTP ${r.status}`);
r = await anon.req("GET", "/api/analytics/overview");
check("anonymous cannot read sentiment analytics -> 401", r.status === 401, `HTTP ${r.status}`);
r = await feedback(author2, `Second user finds the article good. (${stamp})`);
check("any logged-in reader role may submit feedback (author2)", r.status === 201, `HTTP ${r.status}`);
check("feedback is attributed to the SESSION user, not a request field", row(r.data.feedbackId).split("|")[1] === String(author2.id));
r = await feedback(author2, `Spoofed user (${stamp})`, { userId: 1 });
check("a userId in the body is ignored", r.status === 201 && row(r.data.feedbackId).split("|")[1] === String(author2.id));

log("\n== 4. Invalid input");
const countNow = sql("SELECT count(*) FROM article_feedback");
for (const [label, body, want] of [
  ["empty comment", { comment: "" }, 400], ["whitespace comment", { comment: "    " }, 400],
  ["comment > 1000 chars", { comment: "a".repeat(1001) }, 400], ["non-string comment", { comment: { x: 1 } }, 400],
  ["missing comment", {}, 400]]) {
  r = await author.req("POST", `/api/articles/${ARTICLE}/feedback`, { body: { ...body, turnstileToken: TURNSTILE_TEST_TOKEN } });
  check(`${label} -> ${want}`, r.status === want, `HTTP ${r.status} ${r.data.error || ""}`);
}
r = await author.req("POST", `/api/articles/${DRAFT}/feedback`, { body: { comment: "draft article", turnstileToken: TURNSTILE_TEST_TOKEN } });
check("feedback on an unpublished (draft) article -> 404", r.status === 404, `HTTP ${r.status}`);
r = await author.req("POST", `/api/articles/999999999/feedback`, { body: { comment: "missing", turnstileToken: TURNSTILE_TEST_TOKEN } });
check("feedback on a non-existent article -> 404", r.status === 404, `HTTP ${r.status}`);
check("no rows stored for rejected requests", sql("SELECT count(*) FROM article_feedback") === countNow);
const xss = `<script>alert(1)</script> it's 'ok'; DROP TABLE article_feedback;-- (${stamp})`;
r = await feedback(author, xss);
check("HTML / SQL text stored verbatim as data (parameterised), table intact", r.status === 201 && row(r.data.feedbackId).endsWith(xss) && /^\d+$/.test(sql("SELECT count(*) FROM article_feedback")));

log("\n== 5. Duplicate protection");
const vote = (c, helpful) => c.req("POST", `/api/articles/${ARTICLE}/votes`, { body: { helpful, turnstileToken: TURNSTILE_TEST_TOKEN } });
r = await vote(author, true); const r2 = await vote(author, true); const r3 = await vote(author, false);
check("helpfulness votes (required: SECURITY.md T5): repeated votes accepted as upsert", [r, r2, r3].every(x => x.status === 200), [r, r2, r3].map(x => x.status).join(","));
check("exactly ONE vote row for (article, user), holding the latest value",
  sql(`SELECT count(*)||'|'||bool_and(NOT helpful) FROM helpfulness_votes WHERE article_id=${ARTICLE} AND user_id=${author.id}`) === "1|true");
check("UNIQUE(article_id,user_id) constraint present on helpfulness_votes",
  sql("SELECT count(*) FROM pg_constraint WHERE conrelid='helpfulness_votes'::regclass AND contype='u'") === "1");
const dupText = `Duplicate written feedback test (${stamp})`;
const d1 = await feedback(author, dupText), d2 = await feedback(author, dupText);
log(`     identical written feedback twice -> HTTP ${d1.status}, ${d2.status}; rows: ${sql(`SELECT count(*) FROM article_feedback WHERE comment_text='${dupText}'`)}`);
log("     (written feedback has no uniqueness requirement - multiple comments per user are allowed by design;");
log("      abuse is limited by login, Turnstile and the 20-per-window rate limit)");

log("\n== 6. Persistence / failure handling (code-path facts, verified in the database)");
check("no feedback left 'pending' (insert-then-classify completed for every row)", sql("SELECT count(*) FROM article_feedback WHERE sentiment_status='pending'") === "0", sql("SELECT string_agg(sentiment_status||'='||n, ', ') FROM (SELECT sentiment_status, count(*) n FROM article_feedback GROUP BY 1) t"));
log(`\nTotal: ${pass} passed, ${fail} failed`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, lines.join("\n") + "\n");
process.exitCode = fail ? 1 : 0;
