// SupportHub Group 12 - Phase 4 (Editorial): outdated-article re-review lifecycle
//
// Real HTTP requests through the ISOLATED same-origin proxy (supporthub-iso-*),
// real SQS (Article -> Editorial), real Search indexing and database checks.
// No mocks. Never targets production or Neon.
//
//   node tests/integration/editorial-rereview-check.mjs
//
// Environment:
//   BASE_URL      default http://localhost:8188 (isolated stack)
//   DB_CONTAINER  default supporthub-iso-postgres
//   FLOCI_URL     default http://localhost:4567 (isolated Floci, duplicate SQS event)
//   OUT           optional file for the raw transcript (no passwords/cookies/tokens)

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = (process.env.BASE_URL || "http://localhost:8188").replace(/\/$/, "");
const ORIGIN = new URL(BASE).origin;
const DB = process.env.DB_CONTAINER || "supporthub-iso-postgres";
const FLOCI = process.env.FLOCI_URL || "http://localhost:4567";
if (!/:(4567|8188)\b/.test(FLOCI + BASE) || /4566/.test(FLOCI)) throw new Error("Refusing: isolated stack only");
const PASSWORD = process.env.SUPPORTHUB_DEMO_PASSWORD || (() => {
  const file = path.join(ROOT, "infra/floci/.generated/isolated/demo-accounts.txt");
  const match = fs.existsSync(file) && fs.readFileSync(file, "utf8").match(/^password=(.+)$/m);
  if (!match) throw new Error("isolated demo-accounts.txt not found");
  return match[1].trim();
})();

const lines = [];
let pass = 0, fail = 0;
const log = (t = "") => { lines.push(t); console.log(t); };
function check(name, ok, detail = "") {
  ok ? pass++ : fail++;
  log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`);
  return ok;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Client {
  constructor(label) { this.label = label; this.cookie = ""; this.csrf = null; }
  async req(method, url, { body, csrf = true, origin = ORIGIN } = {}) {
    const h = { Accept: "application/json" };
    if (this.cookie) h.Cookie = this.cookie;
    if (origin) h.Origin = origin;
    if (body !== undefined) h["Content-Type"] = "application/json";
    if (csrf && !["GET", "HEAD"].includes(method)) {
      if (!this.csrf) await this.fetchCsrf();
      h["X-CSRF-Token"] = this.csrf;
    }
    const res = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() || []) if (c.startsWith("supporthub.sid=")) this.cookie = c.split(";")[0];
    let data = {};
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }
  async fetchCsrf() { this.csrf = (await this.req("GET", "/api/auth/csrf")).data.csrfToken; }
  async login(email) {
    await this.fetchCsrf();
    const r = await this.req("POST", "/api/auth/login", { body: { email, password: PASSWORD } });
    if (r.data.csrfToken) this.csrf = r.data.csrfToken;
    this.id = r.data.user?.id;
    return r;
  }
}

function sql(q) {
  try {
    return execFileSync("docker", ["exec", DB, "psql", "-U", "supporthub", "-d", "supporthub", "-tAc", q], { encoding: "utf8" }).trim();
  } catch (e) { return `ERROR ${e.message.split("\n")[0]}`; }
}
async function poll(fn, timeoutMs = 60000, every = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return { value: v, ms: Date.now() - start };
    await sleep(every);
  }
  return { value: null, ms: Date.now() - start };
}
const secs = ms => `${(ms / 1000).toFixed(1)} s`;

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
const token = `rereview${stamp.toLowerCase()}`;
log(`Editorial re-review lifecycle check - ${new Date().toISOString()}`);
log(`Base URL: ${BASE} (isolated proxy)  DB: ${DB}  Floci: ${FLOCI}  token: ${token}`);

const author = new Client("author"), author2 = new Client("author2"), editor = new Client("editor"),
  editor2 = new Client("editor2"), admin = new Client("admin"), anon = new Client("anon");
for (const [c, e] of [[author, "author"], [author2, "author2"], [editor, "editor"], [editor2, "editor2"], [admin, "admin"]]) {
  const r = await c.login(`${e}@supporthub.test`);
  check(`login ${e}`, r.status === 200, `HTTP ${r.status} role=${r.data.user?.role} id=${c.id}`);
}
const categoryId = ((await author.req("GET", "/api/categories")).data.categories || [])[0]?.id;

async function createPublished(owner, title) {
  let r = await owner.req("POST", "/api/articles", { body: { title, content: `Steps to fix the VPN client after the 2026 update. ${token}. Open settings and re-import the profile.`, categoryId } });
  const id = r.data.article?.id;
  check(`${owner.label} creates fresh draft`, r.status === 201 && Boolean(id), `HTTP ${r.status} article=${id}`);
  r = await owner.req("POST", `/api/articles/${id}/submit`);
  check(`${owner.label} submits article -> in_review`, r.status === 200 && r.data.article?.status === "in_review", `HTTP ${r.status}`);
  const q = await poll(async () => (await editor.req("GET", "/api/reviews?status=pending")).data.reviews?.find(x => Number(x.article_id) === Number(id)), 60000);
  check("article reaches Editorial queue via outbox -> SQS -> consumer", Boolean(q.value), `after ${secs(q.ms)}`);
  r = await editor.req("POST", `/api/articles/${id}/reviews`, { body: { decision: "approved", comments: "Accurate, approved." } });
  check("editor approves (201)", r.status === 201, `HTTP ${r.status} ${r.data.error || ""}`);
  r = await editor.req("PATCH", `/api/articles/${id}/publication`);
  check("editor publishes (Editorial -> Article -> Search)", r.status === 200 && r.data.status === "published", `HTTP ${r.status} deliveryStatus=${r.data.deliveryStatus} searchable=${r.data.searchable}`);
  return id;
}
async function inSearch(id) {
  const s = await anon.req("GET", `/api/public/articles?q=${token}`);
  return (s.data.results || []).some(a => Number(a.article_id ?? a.id) === Number(id));
}

// ------------------------------------------------------------------ 1
log("\n== 1. Fresh article: create, submit, review, approve, publish");
const articleId = await createPublished(author, `VPN reconnect guide ${token}`);
const found = await poll(() => inSearch(articleId), 30000);
check("published article is indexed by Search (public search)", Boolean(found.value), `after ${secs(found.ms)}`);
check("Article DB status = published", sql(`SELECT status FROM articles WHERE id=${articleId}`) === "published");
check("one Editorial review row (approved)", sql(`SELECT count(*)||':'||string_agg(decision,',') FROM editorial_reviews WHERE article_id=${articleId}`) === "1:approved");
check("one inbox event for the submission", sql(`SELECT count(*) FROM editorial_event_inbox WHERE article_id=${articleId}`) === "1");

// ------------------------------------------------------------------ 2
log("\n== 2. Duplicate SQS event processing (same article.submitted re-delivered)");
const payload = sql(`SELECT payload::text FROM article_event_outbox WHERE article_id=${articleId} ORDER BY created_at LIMIT 1`);
let dupSent = false;
try {
  execFileSync("aws", ["--endpoint-url", FLOCI, "sqs", "send-message", "--queue-url", `${FLOCI}/000000000000/supporthub-article-events`,
    "--message-body", payload, "--output", "text", "--query", "MessageId"],
  { encoding: "utf8", env: { ...process.env, AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test", AWS_DEFAULT_REGION: "us-east-1", AWS_PAGER: "", MSYS_NO_PATHCONV: "1" } });
  dupSent = true;
} catch (e) { log(`     send failed: ${e.message.split("\n")[0]}`); }
check("duplicate article.submitted event re-sent to isolated SQS queue (Floci admin)", dupSent);
await sleep(15000);
check("duplicate event did not create a second review", sql(`SELECT count(*) FROM editorial_reviews WHERE article_id=${articleId}`) === "1");
check("duplicate event did not create a second inbox row", sql(`SELECT count(*) FROM editorial_event_inbox WHERE article_id=${articleId}`) === "1");
check("article still published after duplicate event", sql(`SELECT status FROM articles WHERE id=${articleId}`) === "published");

// ------------------------------------------------------------------ 3
log("\n== 3. Authorization and invalid-transition protection on flag creation");
let r = await anon.req("POST", `/api/articles/${articleId}/flags`, { body: { reason: "anon" } });
check("anonymous flag -> 401", r.status === 401, `HTTP ${r.status}`);
r = await author.req("POST", `/api/articles/${articleId}/flags`, { body: { reason: "author attempt" } });
check("author (non-reviewer) flag -> 403", r.status === 403, `HTTP ${r.status}`);
r = await editor.req("POST", `/api/articles/${articleId}/flags`, { body: { reason: "no csrf" }, csrf: false });
check("flag without CSRF token -> 403", r.status === 403, `HTTP ${r.status}`);
r = await editor.req("POST", `/api/articles/${articleId}/flags`, { body: { reason: "evil origin" }, origin: "https://evil.example" });
check("flag from foreign Origin -> 403", r.status === 403, `HTTP ${r.status}`);
r = await editor.req("POST", `/api/articles/${articleId}/flags`, { body: { reason: "   " } });
check("blank reason -> 400", r.status === 400, `HTTP ${r.status}`);
r = await editor.req("POST", `/api/articles/1%20OR%201=1/flags`, { body: { reason: "sqli" } });
// The proxy forwards only numeric ids to Editorial; others get 404 from Article. Either way no SQL runs.
check("SQL-injection article id rejected (400 Editorial / 404 proxy, never executed)", [400, 404].includes(r.status), `HTTP ${r.status}`);
r = await editor.req("POST", `/api/articles/999999999/flags`, { body: { reason: "missing" } });
check("non-existent article -> 404", r.status === 404, `HTTP ${r.status}`);
r = await author.req("POST", "/api/articles", { body: { title: `Draft only ${token}`, content: `Draft content that is never published ${token}.`, categoryId } });
const draftId = r.data.article?.id;
r = await editor.req("POST", `/api/articles/${draftId}/flags`, { body: { reason: "draft cannot be outdated" } });
check("flag a DRAFT article (invalid status) -> 409", r.status === 409, `HTTP ${r.status} ${r.data.error || ""}`);
check("no flag rows created by rejected requests", sql(`SELECT count(*) FROM editorial_outdated_flags WHERE article_id IN (${articleId},${draftId})`) === "0");

// ------------------------------------------------------------------ 4
log("\n== 4. Flag the published article as outdated (enters re-review)");
r = await editor.req("POST", `/api/articles/${articleId}/flags`, { body: { reason: `Screenshots show the pre-2026 VPN client. ${token}` } });
const flagId = r.data.flag?.flag_id;
check("editor flags published article -> 201", r.status === 201 && Boolean(flagId), `HTTP ${r.status} flag=${flagId} status=${r.data.flag?.status}`);
check("flag persisted: open, flagged_by=editor, reason stored",
  sql(`SELECT status||'|'||flagged_by||'|'||(reason LIKE '%${token}%') FROM editorial_outdated_flags WHERE flag_id=${flagId}`) === `open|${editor.id}|true`,
  sql(`SELECT status||'|'||flagged_by||'|'||created_at FROM editorial_outdated_flags WHERE flag_id=${flagId}`));

log("\n== 5. Duplicate outdated requests (sequential + concurrent)");
r = await editor.req("POST", `/api/articles/${articleId}/flags`, { body: { reason: "Same problem reported again" } });
check("repeat flag by same editor returns the existing open flag (200, same id, no new row)",
  r.status === 200 && Number(r.data.flag?.flag_id) === Number(flagId), `HTTP ${r.status} flag=${r.data.flag?.flag_id} duplicate=${r.data.duplicate}`);
const burst = await Promise.all([editor2, admin, editor, editor2, admin].map((c, i) =>
  c.req("POST", `/api/articles/${articleId}/flags`, { body: { reason: `Concurrent report ${i}` } })));
check("5 concurrent flag requests all answered without 5xx", burst.every(x => x.status < 500), burst.map(x => x.status).join(","));
check("exactly ONE open flag (one re-review) exists for the article",
  sql(`SELECT count(*) FROM editorial_outdated_flags WHERE article_id=${articleId} AND status='open'`) === "1",
  `open=${sql(`SELECT count(*) FROM editorial_outdated_flags WHERE article_id=${articleId} AND status='open'`)} total=${sql(`SELECT count(*) FROM editorial_outdated_flags WHERE article_id=${articleId}`)}`);

log("\n== 6. Re-review queue access and article visibility while under re-review");
r = await editor2.req("GET", "/api/editorial/flags?limit=100");
const queued = (r.data.flags || []).find(f => Number(f.flag_id) === Number(flagId));
check("authorized editor2 sees the open re-review in GET /api/editorial/flags", r.status === 200 && Boolean(queued), `HTTP ${r.status} total=${r.data.total}`);
check("re-review item carries live Article data (Editorial -> Article HMAC)", queued?.article?.id == articleId && queued?.articleUnavailable === false, `article.status=${queued?.article?.status}`);
r = await author.req("GET", "/api/editorial/flags");
check("author cannot read the re-review queue -> 403", r.status === 403, `HTTP ${r.status}`);
r = await anon.req("GET", "/api/editorial/flags");
check("anonymous cannot read the re-review queue -> 401", r.status === 401, `HTTP ${r.status}`);
check("article stays published during re-review (design: content stays available until the editor decides)",
  sql(`SELECT status FROM articles WHERE id=${articleId}`) === "published");
check("article still searchable during re-review (index consistent with status)", await inSearch(articleId));
r = await anon.req("GET", `/api/public/articles/${articleId}`);
check("public article view still available during re-review", r.status === 200, `HTTP ${r.status}`);

log("\n== 7. Re-review processing: authorization, ownership, invalid transitions");
r = await anon.req("PATCH", `/api/flags/${flagId}`, { body: { resolution: "x" } });
check("anonymous resolve -> 401", r.status === 401, `HTTP ${r.status}`);
r = await author.req("PATCH", `/api/flags/${flagId}`, { body: { resolution: "author resolves" } });
check("author resolve -> 403", r.status === 403, `HTTP ${r.status}`);
r = await editor2.req("PATCH", `/api/flags/${flagId}`, { body: { resolution: "" } });
check("resolution text is mandatory -> 400", r.status === 400, `HTTP ${r.status}`);
r = await editor2.req("PATCH", `/api/flags/${flagId}`, { body: { resolution: "no csrf" }, csrf: false });
check("resolve without CSRF -> 403", r.status === 403, `HTTP ${r.status}`);
r = await editor2.req("PATCH", `/api/flags/999999999`, { body: { resolution: "missing" } });
check("resolve non-existent flag -> 404", r.status === 404, `HTTP ${r.status}`);
check("flag still open after rejected attempts", sql(`SELECT status FROM editorial_outdated_flags WHERE flag_id=${flagId}`) === "open");

// Ownership: an admin may author articles AND review. Self re-review must be blocked,
// matching the existing "cannot publish your own article" rule.
log("     ownership case: article authored by admin, flagged, admin tries to resolve");
const adminArticle = await createPublished(admin, `Admin-authored printer guide ${token}`);
r = await editor.req("POST", `/api/articles/${adminArticle}/flags`, { body: { reason: "Driver link is outdated." } });
const adminFlag = r.data.flag?.flag_id;
check("editor flags admin-authored article", r.status === 201, `HTTP ${r.status} flag=${adminFlag}`);
r = await admin.req("PATCH", `/api/flags/${adminFlag}`, { body: { resolution: "I checked my own article" } });
check("author of the article cannot resolve its own re-review (self-review) -> 403", r.status === 403, `HTTP ${r.status} ${r.data.error || ""}`);
r = await editor2.req("PATCH", `/api/flags/${adminFlag}`, { body: { resolution: "Driver link updated by editor2." } });
check("independent editor resolves admin-authored re-review", r.status === 200, `HTTP ${r.status}`);

log("\n== 8. Successful completion of the re-review");
r = await editor2.req("PATCH", `/api/flags/${flagId}`, { body: { resolution: `Screenshots replaced with 2026 client. ${token}` } });
check("editor2 completes the re-review -> 200 resolved", r.status === 200 && r.data.flag?.status === "resolved", `HTTP ${r.status} status=${r.data.flag?.status}`);
r = await editor.req("PATCH", `/api/flags/${flagId}`, { body: { resolution: "again" } });
check("resolving an already-resolved re-review (invalid transition) -> 409", r.status === 409, `HTTP ${r.status} ${r.data.error || ""}`);
const fr = sql(`SELECT status||'|'||resolved_by||'|'||(resolution LIKE '%${token}%')||'|'||(resolved_at>=created_at) FROM editorial_outdated_flags WHERE flag_id=${flagId}`);
check("persisted resolution: resolved|editor2|resolution text|resolved_at>=created_at", fr === `resolved|${editor2.id}|true|true`, fr);
r = await editor.req("GET", "/api/editorial/flags?limit=100");
check("resolved re-review removed from the open queue", !(r.data.flags || []).some(f => Number(f.flag_id) === Number(flagId)));
check("article remains published after re-review", sql(`SELECT status FROM articles WHERE id=${articleId}`) === "published");
check("article remains searchable after re-review", await inSearch(articleId));

log("\n== 9. A later outdated report opens a NEW re-review cycle");
r = await editor.req("POST", `/api/articles/${articleId}/flags`, { body: { reason: "Second cycle: new OS release." } });
const flag2 = r.data.flag?.flag_id;
check("new flag after resolution -> 201 with new id", r.status === 201 && Number(flag2) !== Number(flagId), `HTTP ${r.status} flag=${flag2}`);
r = await editor2.req("PATCH", `/api/flags/${flag2}`, { body: { resolution: "No change needed: steps still valid." } });
check("second cycle resolved", r.status === 200, `HTTP ${r.status}`);

log("\n== 10. Persistent records and status history");
r = await editor.req("GET", `/api/articles/${articleId}/history`);
const hist = (r.data.history || []).map(h => `${h.previous_status}->${h.new_status}`).join(", ");
check("GET history returns exactly draft->in_review, in_review->approved, approved->published",
  hist === "draft->in_review, in_review->approved, approved->published", hist);
log(`     editorial_status_events: ${sql(`SELECT string_agg(previous_status||'->'||new_status||' actor='||actor_id, '; ' ORDER BY event_id) FROM editorial_status_events WHERE article_id=${articleId}`)}`);
log(`     editorial_outdated_flags: ${sql(`SELECT string_agg(flag_id||':'||status||' by='||flagged_by||' resolved_by='||coalesce(resolved_by::text,'-'), '; ' ORDER BY flag_id) FROM editorial_outdated_flags WHERE article_id=${articleId}`)}`);
check("flag history: 2 cycles, both resolved, none open",
  sql(`SELECT count(*) FILTER (WHERE status='resolved')||'/'||count(*) FROM editorial_outdated_flags WHERE article_id=${articleId}`) === "2/2");
check("exactly one publication event + one publication outbox row (re-review did not republish)",
  sql(`SELECT (SELECT count(*) FROM editorial_publication_event_outbox WHERE article_id=${articleId})||'/'||(SELECT count(*) FROM publication_outbox WHERE article_id=${articleId})`) === "1/1");
check("search_published_articles holds the article once",
  sql(`SELECT count(*) FROM search_published_articles WHERE article_id=${articleId}`) === "1");

log(`\nArticles created: ${articleId} (main), ${adminArticle} (ownership), ${draftId} (draft, never published)`);
log(`Total: ${pass} passed, ${fail} failed`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, lines.join("\n") + "\n");
process.exitCode = fail ? 1 : 0;
