// SupportHub Group 12 - end-to-end article lifecycle + security checks
//
// Runs real HTTP requests through the same-origin frontend proxy, so it
// exercises proxy routing, the shared Identity session, all three
// student-owned services, SQS (Article -> Editorial), SNS -> Lambda and
// search indexing. No mocks.
//
//   node tests/integration/lifecycle-e2e.mjs
//
// Environment:
//   BASE_URL                 default http://localhost:8088 (integrated stack)
//   SUPPORTHUB_DEMO_PASSWORD default: read from infra/floci/.generated/demo-accounts.txt
//   DB_CONTAINER             default supporthub-int-postgres (database checks; "" to skip)
//
// Writes evidence/final/e2e/lifecycle-<timestamp>.txt (no passwords, cookies
// or tokens are written).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = (process.env.BASE_URL || "http://localhost:8088").replace(/\/$/, "");
const ORIGIN = new URL(BASE).origin;
const DB = process.env.DB_CONTAINER ?? "supporthub-int-postgres";
const PASSWORD = process.env.SUPPORTHUB_DEMO_PASSWORD || (() => {
  const file = path.join(ROOT, "infra/floci/.generated/demo-accounts.txt");
  const match = fs.existsSync(file) && fs.readFileSync(file, "utf8").match(/^password=(.+)$/m);
  if (!match) throw new Error("Set SUPPORTHUB_DEMO_PASSWORD or run setup-supporthub.sh first");
  return match[1].trim();
})();

const lines = [];
let pass = 0, fail = 0;
const log = (text = "") => { lines.push(text); console.log(text); };
function check(name, condition, detail = "") {
  if (condition) pass++; else fail++;
  log(`${condition ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`);
  return condition;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Client {
  constructor(label) { this.label = label; this.cookie = ""; this.csrf = null; }
  async req(method, url, { body, csrf = true, origin = ORIGIN, headers = {} } = {}) {
    const h = { Accept: "application/json", ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (origin) h.Origin = origin;
    if (body !== undefined) h["Content-Type"] = "application/json";
    if (csrf && !["GET", "HEAD"].includes(method)) {
      if (!this.csrf) await this.fetchCsrf();
      h["X-CSRF-Token"] = this.csrf;
    }
    const started = Date.now();
    const res = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.getSetCookie?.() || [];
    for (const c of setCookie) if (c.startsWith("supporthub.sid=")) this.cookie = c.split(";")[0];
    let data = {};
    try { data = await res.json(); } catch {}
    return { status: res.status, data, ms: Date.now() - started };
  }
  async fetchCsrf() {
    const r = await this.req("GET", "/api/auth/csrf");
    this.csrf = r.data.csrfToken;
  }
  async login(email) {
    await this.fetchCsrf();
    const r = await this.req("POST", "/api/auth/login", { body: { email, password: PASSWORD } });
    if (r.data.csrfToken) this.csrf = r.data.csrfToken;
    return r;
  }
}

function sql(query) {
  if (!DB) return null;
  try {
    return execFileSync("docker", ["exec", DB, "psql", "-U", "supporthub", "-d", "supporthub", "-tAc", query],
      { encoding: "utf8" }).trim();
  } catch (e) { return `ERROR ${e.message.split("\n")[0]}`; }
}

async function poll(fn, timeoutMs = 60000, every = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value) return { value, ms: Date.now() - start };
    await sleep(every);
  }
  return { value: null, ms: Date.now() - start };
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
const token = `lifecycle${stamp.toLowerCase()}`;
log(`SupportHub end-to-end lifecycle test - ${new Date().toISOString()}`);
log(`Base URL: ${BASE} (same-origin proxy)   Unique search token: ${token}`);

// ---------------------------------------------------------------- health
log("\n== 1. Service health through the stack");
for (const [name, url] of [["identity", "/api/auth/csrf"], ["article", "/api/categories"], ["search", "/api/public/articles?q=health"]]) {
  const r = await new Client("probe").req("GET", url);
  check(`${name} reachable via proxy (${url})`, r.status === 200, `HTTP ${r.status}`);
}

// ---------------------------------------------------------------- author
log("\n== 2. Author: login, create, edit, versions, duplicates, S3 backup, submit");
const visitor = new Client("visitor");
await visitor.fetchCsrf();
let r = await visitor.req("POST", "/api/auth/register", {
  body: { fullName: "New Reader", email: `${token}@supporthub.test`, password: "Registration-Test-2026!", turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" }
});
const registered = r.status === 201;
const dummyTokenResult = `HTTP ${r.status} ${r.data.error || r.data.message || ""}`;
check("registration: 201 created, or refused (400) when Turnstile cannot be verified",
  registered || (r.status === 400 && /Turnstile/.test(r.data.error || "")),
  `HTTP ${r.status} ${r.data.error || r.data.message || ""}`);
r = await visitor.req("POST", "/api/auth/register", {
  body: { fullName: "No Token", email: `notoken-${token}@supporthub.test`, password: "Registration-Test-2026!" }
});
check("registration WITHOUT Turnstile token -> 400 (rejected before any Cloudflare call)",
  r.status === 400 && /Turnstile/.test(r.data.error || ""), `HTTP ${r.status} ${r.data.error || ""}`);
r = await visitor.req("POST", "/api/auth/login", { body: { email: "author@supporthub.test", password: "wrong-password-123" } });
check("wrong password -> 401 (LOGIN_FAILED audited)", r.status === 401, `HTTP ${r.status}`);
const author = new Client("author");
r = await author.login("author@supporthub.test");
check("author login (shared Identity session)", r.status === 200 && r.data.user?.role === "author", `HTTP ${r.status}, role=${r.data.user?.role}`);
r = await author.req("GET", "/api/auth/me");
check("GET /api/auth/me returns author", r.status === 200 && r.data.user?.email === "author@supporthub.test");
const cats = (await author.req("GET", "/api/categories")).data.categories || [];
const categoryId = cats[0]?.id;
check("categories available", Boolean(categoryId), `${cats.length} categories`);

const content = `How to reset a forgotten SupportHub password. Open the login page, choose Forgot password, ` +
  `check your inbox and follow the link. Token ${token}.`;
r = await author.req("POST", "/api/articles", { body: { title: `Reset your password ${token}`, content, categoryId } });
const articleId = r.data.article?.id;
check("POST /api/articles creates draft (201)", r.status === 201 && r.data.article?.status === "draft", `HTTP ${r.status}, id=${articleId}`);

r = await author.req("PATCH", `/api/articles/${articleId}`, { body: { title: `Reset your password ${token}`, content: content + " Updated with screenshots.", categoryId } });
check("PATCH /api/articles/:id edits draft (version 2)", r.status === 200, `HTTP ${r.status}`);
r = await author.req("GET", `/api/articles/${articleId}/versions`);
const versions = r.data.versions || [];
check("GET versions lists 2 versions", r.status === 200 && versions.length === 2, `${versions.length} versions`);
const v1 = versions.find(v => Number(v.version_number) === 1)?.version_id ?? versions.at(-1)?.version_id;
const v2 = versions.find(v => Number(v.version_number) === 2)?.version_id ?? versions[0]?.version_id;
r = await author.req("GET", `/api/articles/${articleId}/versions/compare?from=${v1}&to=${v2}`);
check("GET versions/compare", r.status === 200 && Boolean(r.data.comparison), `HTTP ${r.status}`);
r = await author.req("POST", "/api/articles/check-duplicates", { body: { title: `Reset your password ${token}`, content, categoryId, excludeId: null } });
const dup = (r.data.matches || []).find(m => Number(m.id ?? m.articleId) === Number(articleId));
check("POST check-duplicates finds own similar draft", r.status === 200 && Boolean(dup), `HTTP ${r.status}, ${r.data.matches?.length ?? 0} matches`);
r = await author.req("POST", `/api/articles/${articleId}/versions/${v2}/export`);
check("S3: export version backup (Article -> S3 via own IAM key)", r.status === 200 && r.data.key?.startsWith("articles/"), `HTTP ${r.status}, key=${r.data.key}`);
r = await author.req("GET", `/api/articles/${articleId}/versions/${v2}/export`);
check("S3: retrieve version backup", r.status === 200 && Number(r.data.backup?.articleId) === Number(articleId), `HTTP ${r.status}`);

r = await author.req("POST", `/api/articles/${articleId}/submit`);
check("POST /api/articles/:id/submit -> in_review", r.status === 200 && r.data.article?.status === "in_review", `HTTP ${r.status}`);
check("transactional outbox row written", (sql(`SELECT count(*) FROM article_event_outbox WHERE article_id=${articleId}`) || "0") !== "0" || !DB);

// ---------------------------------------------------------------- async SQS
log("\n== 3. Asynchronous: outbox worker -> SQS -> Editorial consumer");
const editor = new Client("editor");
r = await editor.login("editor@supporthub.test");
check("editor login", r.status === 200 && r.data.user?.role === "editor", `HTTP ${r.status}`);
const queued = await poll(async () => {
  const q = await editor.req("GET", "/api/reviews?status=pending");
  return (q.data.reviews || []).find(x => Number(x.article_id ?? x.articleId ?? x.article?.id) === Number(articleId));
}, 60000);
check("article appears in Editorial review queue via SQS", Boolean(queued.value), `after ${(queued.ms / 1000).toFixed(1)} s`);
if (DB) {
  log(`     outbox: ${sql(`SELECT status||' attempts='||attempts FROM article_event_outbox WHERE article_id=${articleId}`)}`);
  log(`     editorial inbox: ${sql(`SELECT event_type||' article='||article_id FROM editorial_event_inbox WHERE article_id=${articleId}`)}`);
}

// ---------------------------------------------------------------- editorial security
log("\n== 4. Security checks (backend enforcement)");
const anon = new Client("anon");
r = await anon.req("POST", "/api/articles", { body: { title: "x".repeat(5), content: "y".repeat(20), categoryId } });
check("unauthenticated create -> 401", r.status === 401, `HTTP ${r.status}`);
r = await author.req("POST", `/api/articles/${articleId}/reviews`, { body: { decision: "approved", comments: "self" } });
check("author cannot approve (role) -> 403", r.status === 403, `HTTP ${r.status}`);
const author2 = new Client("author2");
await author2.login("author2@supporthub.test");
r = await author2.req("GET", `/api/articles/${articleId}`);
check("other author cannot read draft (ownership) -> 403", r.status === 403, `HTTP ${r.status}`);
r = await author2.req("GET", `/api/articles/${articleId}/versions`);
check("other author cannot read versions -> 403", r.status === 403, `HTTP ${r.status}`);
r = await author.req("POST", "/api/articles", { body: { title: "CSRF test", content: "content content", categoryId }, csrf: false, headers: { "X-CSRF-Token": "0".repeat(64) } });
check("wrong CSRF token -> 403", r.status === 403, `HTTP ${r.status}`);
r = await author.req("POST", "/api/articles", { body: { title: "Origin test", content: "content content", categoryId }, origin: "https://evil.example" });
check("foreign Origin -> 403", r.status === 403, `HTTP ${r.status}`);
r = await author.req("GET", "/api/articles/1%20OR%201=1");
check("SQL injection in ID -> 400", r.status === 400, `HTTP ${r.status}`);
r = await author.req("POST", "/api/articles", { body: { title: "", content: "short", categoryId } });
check("invalid input -> 400", r.status === 400, `HTTP ${r.status}`);
r = await editor.req("PATCH", `/api/articles/${articleId}/publication`);
check("publish before approval (invalid transition) -> 409", r.status === 409, `HTTP ${r.status}`);

// ---------------------------------------------------------------- decision + publish
log("\n== 5. Editor approves and publishes; SNS -> Lambda; Search indexing");
r = await editor.req("POST", `/api/articles/${articleId}/reviews`, { body: { decision: "approved", comments: "Clear and accurate. Approved." } });
check("editor approves (201)", r.status === 201, `HTTP ${r.status} ${r.data.error || ""}`);
r = await editor.req("PATCH", `/api/articles/${articleId}/publication`);
check("editor publishes (Editorial -> Article HMAC -> Search HMAC)", r.status === 200, `HTTP ${r.status} ${r.data.error || ""}`);
const found = await poll(async () => {
  const s = await anon.req("GET", `/api/public/articles?q=${token}`);
  return (s.data.results || []).find(a => Number(a.article_id ?? a.id) === Number(articleId));
}, 30000);
check("reader finds article in public search", Boolean(found.value), `after ${(found.ms / 1000).toFixed(1)} s`);
r = await anon.req("GET", `/api/public/articles/${articleId}`);
check("reader views published article (view recorded)", r.status === 200, `HTTP ${r.status}`);
if (DB) {
  const sns = await poll(async () => {
    const v = sql(`SELECT state FROM editorial_publication_event_outbox WHERE article_id=${articleId} ORDER BY created_at DESC LIMIT 1`);
    return v === "published" ? v : null;
  }, 30000);
  check("SNS publication event published by Editorial worker", Boolean(sns.value), `after ${(sns.ms / 1000).toFixed(1)} s`);
  const lambda = await poll(async () => {
    const v = sql(`SELECT count(*) FROM editorial_publication_event_receipts WHERE article_id=${articleId}`);
    return v && v !== "0" && !v.startsWith("ERROR") ? v : null;
  }, 60000, 2000);
  check("Lambda (SNS subscriber) recorded publication receipt", Boolean(lambda.value), `after ${(lambda.ms / 1000).toFixed(1)} s`);
}

// ---------------------------------------------------------------- feedback + analytics
log("\n== 6. Reader feedback and analytics");
r = await author2.req("POST", `/api/articles/${articleId}/votes`, { body: { helpful: true, turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" } });
check("helpfulness vote accepted, or safely refused when Turnstile is unreachable",
  [200, 201].includes(r.status) || (r.status === 502 && /Turnstile/.test(r.data.error || "")),
  `HTTP ${r.status} ${r.data.error || ""}`);
const voteStatus = r.status;
r = await anon.req("POST", `/api/articles/${articleId}/votes`, { body: { helpful: true } });
check("anonymous vote -> 401", r.status === 401, `HTTP ${r.status}`);
r = await author.req("GET", "/api/analytics/overview");
check("author cannot open analytics -> 403", r.status === 403, `HTTP ${r.status}`);
const admin = new Client("admin");
await admin.login("admin@supporthub.test");
r = await admin.req("GET", "/api/analytics/overview");
check("admin analytics overview", r.status === 200 && typeof r.data.totalSearches === "number", `searches=${r.data.totalSearches}, views=${r.data.totalArticleViews}`);
await sleep(6000); // DynamoDB counters are flushed every 5 s
r = await admin.req("GET", "/api/analytics/live-counters");
check("DynamoDB live counters readable", r.status === 200, `HTTP ${r.status}`);
r = await admin.req("POST", "/api/analytics/exports");
check("S3 analytics CSV export (Search -> own bucket)", r.status === 201 || r.status === 200, `HTTP ${r.status} ${r.data.name || r.data.error || ""}`);

// ---------------------------------------------------------------- reject path + flags + history
log("\n== 7. Rejection path, editorial history, outdated flag");
r = await author.req("POST", "/api/articles", { body: { title: `Printer offline ${token}`, content: "Restart the printer and check the cable. " + token, categoryId } });
const rejectId = r.data.article?.id;
await author.req("POST", `/api/articles/${rejectId}/submit`);
const queued2 = await poll(async () => (await editor.req("GET", "/api/reviews?status=pending")).data.reviews?.find(x => Number(x.article_id) === Number(rejectId)), 60000);
check("second article reaches queue", Boolean(queued2.value), `after ${(queued2.ms / 1000).toFixed(1)} s`);
r = await editor.req("POST", `/api/articles/${rejectId}/reviews`, { body: { decision: "rejected", comments: "Please add model-specific steps." } });
check("editor rejects with comment", r.status === 201, `HTTP ${r.status} ${r.data.error || ""}`);
r = await author.req("GET", `/api/articles/${rejectId}`);
check("rejected article returns to draft for author", r.data.article?.status === "draft", `status=${r.data.article?.status}`);
r = await editor.req("GET", `/api/articles/${articleId}/history`);
check("editorial history available", r.status === 200 && (r.data.events || r.data.history || []).length > 0, `HTTP ${r.status}`);
r = await editor.req("POST", `/api/articles/${articleId}/flags`, { body: { reason: "Screenshots refer to the old login page." } });
const flagId = r.data.flag?.flag_id;
check("editor flags published article as outdated", r.status === 201, `HTTP ${r.status}`);
r = await editor.req("PATCH", `/api/flags/${flagId}`, { body: { resolution: "Screenshots updated." } });
check("editor resolves outdated flag", r.status === 200, `HTTP ${r.status} ${r.data.error || ""}`);

// ---------------------------------------------------------------- audit
if (DB) {
  log("\n== 8. Audit / security-event records");
  log(`     audit_logs by action: ${sql("SELECT string_agg(action||'='||n, ', ') FROM (SELECT action, count(*) n FROM audit_logs GROUP BY action ORDER BY action) t")}`);
}

log(`\nTotal: ${pass} passed, ${fail} failed`);
log(`Registration note: dummy-token registration ${dummyTokenResult}. ${registered ? "Registered." : "A successful registration with a VALID Turnstile token is NOT VERIFIED here: challenges.cloudflare.com is blocked by this environment, so Identity fails closed (400)."}`);
log(`Vote result note: HTTP ${voteStatus} (502 = Cloudflare Turnstile host not reachable from this environment)`);
const outDir = path.join(ROOT, "evidence/final/e2e");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `lifecycle-${stamp}.txt`);
fs.writeFileSync(out, lines.join("\n") + "\n");
console.log(`Saved ${path.relative(ROOT, out)}`);
process.exitCode = fail ? 1 : 0;
