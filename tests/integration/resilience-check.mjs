// SupportHub Group 12 - concurrency, failure-recovery and security checks
//
// Runs ONLY against the isolated stack (SUPPORTHUB_ISOLATED=true): it stops and
// starts supporthub-iso-* containers and never touches any other container.
//   RATE_LIMIT_PROFILE=loadtest SUPPORTHUB_ISOLATED=true bash infra/floci/setup-supporthub.sh --no-iam-tests
//   node tests/integration/resilience-check.mjs
// Writes one evidence file per component owner under evidence/final/<owner>/.
// No password, cookie, token, key or secret value is written.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = "http://localhost:8188";
const FLOCI = "http://localhost:4567";
const ACCOUNT = "000000000000";
const QUEUE = `${FLOCI}/${ACCOUNT}/supporthub-article-events`;
const ALERTS = `arn:aws:sns:us-east-1:${ACCOUNT}:supporthub-identity-security-alerts`;
const PASSWORD = fs.readFileSync(path.join(ROOT, "infra/floci/.generated/isolated/demo-accounts.txt"), "utf8")
  .match(/^password=(.+)$/m)[1].trim();
const TURNSTILE = "XXXX.DUMMY.TOKEN.XXXX"; // Cloudflare's documented test token

const sleep = ms => new Promise(r => setTimeout(r, ms));
const C = name => `supporthub-iso-${name}`;
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const stop = name => docker("stop", "-t", "2", C(name));
const start = name => docker("start", C(name));
const sql = q => docker("exec", C("postgres"), "psql", "-U", "supporthub", "-d", "supporthub", "-tAc", q);
const awsEnv = { ...process.env, AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test" };
const aws = (args, env = awsEnv) => execFileSync("aws",
  ["--endpoint-url", FLOCI, "--region", "us-east-1", "--output", "json", ...args], { encoding: "utf8", env });

const results = [];
function check(owner, name, expected, actual, ok) {
  results.push({ owner, name, expected, actual: String(actual), ok: Boolean(ok), at: new Date().toISOString() });
  console.log(`${ok ? "PASS" : "FAIL"} | ${owner} | ${name} | expected: ${expected} | actual: ${actual}`);
}

async function poll(fn, ms = 60000, every = 1000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const value = await fn(); if (value) return value; } catch { /* retry */ }
    await sleep(every);
  }
  return null;
}

class Client {
  cookie = ""; csrf = "";
  async req(method, url, body, { headers = {}, base = BASE } = {}) {
    await sleep(25); // let pending socket closes be seen after synchronous docker calls
    const h = { Accept: "application/json", Origin: BASE, ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (method !== "GET" && this.csrf) h["X-CSRF-Token"] = this.csrf;
    if (body !== undefined) h["Content-Type"] = "application/json";
    const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(40000) });
    for (const c of res.headers.getSetCookie?.() || []) if (c.startsWith("supporthub.sid=")) this.cookie = c.split(";")[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }
  async login(name, password = PASSWORD) {
    this.csrf = (await this.req("GET", "/api/auth/csrf")).data.csrfToken;
    const r = await this.req("POST", "/api/auth/login", { email: `${name}@supporthub.test`, password });
    if (r.data.csrfToken) this.csrf = r.data.csrfToken;
    if (r.status === 200) this.csrf = (await this.req("GET", "/api/auth/csrf")).data.csrfToken || this.csrf;
    return r;
  }
}

const clients = {};
for (const name of ["author", "author2", "editor", "editor2", "admin"]) {
  clients[name] = new Client();
  const r = await clients[name].login(name);
  if (r.status !== 200) throw new Error(`login ${name} failed: HTTP ${r.status}`);
}
const { author, author2, editor, editor2, admin } = clients;
const categoryId = Number(sql("SELECT min(id) FROM categories") || 0) || 1;

let counter = 0;
async function draft() {
  counter += 1;
  const r = await author.req("POST", "/api/articles", {
    title: `Resilience article ${Date.now()} number ${counter}`,
    content: `Isolated resilience test content ${crypto.randomUUID()} with enough detail to be valid.`,
    categoryId
  });
  if (r.status !== 201) throw new Error(`create failed ${r.status} ${JSON.stringify(r.data)}`);
  return Number(r.data.article.id);
}
const submit = id => author.req("POST", `/api/articles/${id}/submit`);
const inQueue = id => poll(() => sql(`SELECT count(*) FROM editorial_reviews WHERE article_id=${id} AND decision='pending'`) === "1");
const queued = async () => { const id = await draft(); await submit(id); if (!(await inQueue(id))) throw new Error(`article ${id} never queued`); return id; };
const decide = (who, id, decision) => who.req("POST", `/api/articles/${id}/reviews`, { decision, comments: "Resilience test decision." });
const status = id => sql(`SELECT status FROM articles WHERE id=${id}`);
async function published() {
  const id = await queued();
  await decide(editor, id, "approved");
  const r = await editor.req("PATCH", `/api/articles/${id}/publication`);
  if (r.status !== 200) throw new Error(`publish ${id} failed: ${r.status} ${JSON.stringify(r.data)}`);
  return id;
}

// ------------------------------------------------------------ ALYAA
async function alyaa() {
  let id = await draft();
  let rs = await Promise.all(Array.from({ length: 10 }, () => submit(id)));
  const won = rs.filter(r => r.status === 200).length;
  const outbox = sql(`SELECT count(*) FROM article_event_outbox WHERE article_id=${id}`);
  check("alyaa", "10 concurrent submissions of one draft", "exactly 1 outbox event",
    `${won} x HTTP 200, statuses=${rs.map(r => r.status).join(",")}, outbox rows=${outbox}`, outbox === "1");

  rs = await Promise.all(Array.from({ length: 30 }, (_, i) => author.req("POST", "/api/articles", {
    title: `Concurrent create ${Date.now()} ${i}`, content: `Concurrent creation test content number ${i}, long enough.`, categoryId })));
  const ids = rs.filter(r => r.status === 201).map(r => r.data.article.id);
  check("alyaa", "30 concurrent article creations", "30 x 201, 30 different IDs", `${ids.length} x 201, ${new Set(ids).size} unique`, new Set(ids).size === 30);

  id = await draft();
  rs = await Promise.all(Array.from({ length: 10 }, (_, i) => author.req("PATCH", `/api/articles/${id}`, {
    title: `Concurrent edit ${id} ${i}`, content: `Concurrent edit content number ${i}, long enough to be valid.`, categoryId })));
  const okEdits = rs.filter(r => r.status === 200).length;
  const versions = sql(`SELECT count(*) || '/' || count(DISTINCT version_number) FROM article_versions WHERE article_id=${id}`);
  const five = rs.filter(r => r.status >= 500).length;
  check("alyaa", "10 concurrent edits keep version history consistent", "no 5xx; version numbers unique",
    `${okEdits} x 200, ${five} x 5xx, versions total/distinct=${versions}`, five === 0 && versions.split("/")[0] === versions.split("/")[1]);

  // restore
  const list = (await author.req("GET", `/api/articles/${id}/versions`)).data.versions || [];
  const first = list.reduce((a, b) => Number(a.version_number) < Number(b.version_number) ? a : b, list[0] || {});
  const firstId = Number(first.id ?? first.version_id);
  let r = await author.req("POST", `/api/articles/${id}/restore`, { versionId: firstId });
  check("alyaa", "restore an earlier version of an own draft", "HTTP 200", `HTTP ${r.status}`, r.status === 200);
  r = await author2.req("DELETE", `/api/articles/${id}`);
  check("alyaa", "another author deletes the draft (ownership)", "HTTP 403, article kept", `HTTP ${r.status}, status=${status(id)}`, r.status === 403 && status(id) === "draft");
  r = await author.req("DELETE", `/api/articles/${id}`);
  check("alyaa", "owner deletes own draft", "HTTP 200 or 204", `HTTP ${r.status}`, [200, 204].includes(r.status));

  // SQS / Floci outage with the transactional outbox
  stop("floci");
  id = await draft();
  r = await submit(id);
  await sleep(8000);
  const pending = sql(`SELECT status || ' attempts=' || attempts FROM article_event_outbox WHERE article_id=${id}`);
  check("alyaa", "submit while AWS (Floci) is down", "HTTP 200, event kept pending, API alive", `HTTP ${r.status}, outbox ${pending}`, r.status === 200 && pending.startsWith("pending"));
  const v = ((await author.req("GET", `/api/articles/${id}/versions`)).data.versions || [])[0] || {};
  const vid = v.id ?? v.version_id;
  r = await author.req("POST", `/api/articles/${id}/versions/${vid}/export`);
  check("alyaa", "S3 backup while AWS is down", "controlled 5xx, no crash", `HTTP ${r.status}`, r.status >= 500 && r.status < 600);
  r = await author.req("GET", "/api/articles/mine");
  check("alyaa", "Article API still serves requests during the outage", "HTTP 200", `HTTP ${r.status}`, r.status === 200);

  // Other owners' behaviour in the same outage
  r = await new Client().req("GET", "/api/public/articles?q=resilience");
  check("nermeen", "public search while AWS (Floci) is down", "HTTP 200", `HTTP ${r.status}`, r.status === 200);
  r = await admin.req("POST", "/api/analytics/exports");
  check("nermeen", "analytics S3 export while AWS is down", "controlled 5xx, no crash", `HTTP ${r.status}`, r.status >= 500 && r.status < 600);
  r = await admin.req("GET", "/api/analytics/overview");
  check("nermeen", "analytics overview (PostgreSQL) while AWS is down", "HTTP 200", `HTTP ${r.status}`, r.status === 200);
  r = await editor.req("GET", "/api/reviews?status=pending");
  check("salma", "review queue while AWS (Floci) is down", "HTTP 200", `HTTP ${r.status}`, r.status === 200);

  start("floci");
  const healthy = await poll(async () => (await fetch(`${FLOCI}/_floci/health`)).ok);
  const arrived = await inQueue(id);
  check("alyaa", "recovery after AWS returns: pending event is published automatically", "outbox published, article in review queue",
    `floci healthy=${Boolean(healthy)}, outbox=${sql(`SELECT status FROM article_event_outbox WHERE article_id=${id}`)}, queued=${Boolean(arrived)}`,
    arrived && sql(`SELECT status FROM article_event_outbox WHERE article_id=${id}`) === "published");

  // Signed internal API
  const internal = "http://localhost:3205";
  for (const [name, headers] of [
    ["no signature", {}],
    ["forged signature", { "x-service-name": "editorial-service", "x-service-timestamp": String(Date.now()), "x-service-signature": "a".repeat(64) }],
    ["expired timestamp", { "x-service-name": "editorial-service", "x-service-timestamp": String(Date.now() - 600000), "x-service-signature": "a".repeat(64) }]
  ]) {
    r = await new Client().req("GET", `/internal/articles/${id}`, undefined, { headers, base: internal });
    check("alyaa", `internal Article API, ${name}`, "HTTP 401", `HTTP ${r.status}`, r.status === 401);
  }

  // Identity
  const hash = sql("SELECT substr(password_hash,1,7) FROM users WHERE email='author@supporthub.test'");
  check("alyaa", "password stored as bcrypt cost 12", "$2?$12$ prefix", hash.replace(/^(\$2.\$12\$).*/, "$1"), /^\$2[aby]\$12\$$/.test(hash));
  r = await new Client().req("POST", "/api/auth/login", { email: "author@supporthub.test", password: "x" });
  check("alyaa", "login without CSRF token", "HTTP 403", `HTTP ${r.status}`, r.status === 403);
  const esc = new Client();
  esc.csrf = (await esc.req("GET", "/api/auth/csrf")).data.csrfToken;
  const email = `escalation-${Date.now()}@supporthub.test`;
  r = await esc.req("POST", "/api/auth/register", { fullName: "Escalation Test", email, password: `T-${crypto.randomUUID()}`, role: "admin", turnstileToken: TURNSTILE });
  const role = sql(`SELECT role FROM users WHERE email='${email}'`);
  check("alyaa", "registration body asks for role=admin", "201, stored role is not editor/admin", `HTTP ${r.status} ${r.data.error || ""}, stored role=${role || "(none)"}`, r.status === 201 && role !== "" && !["admin", "editor"].includes(role));

  const tmp = new Client();
  await tmp.login("author2");
  const stolen = tmp.cookie;
  r = await tmp.req("POST", "/api/auth/logout");
  const after = new Client(); after.cookie = stolen;
  const codes = [];
  for (const url of ["/api/auth/me", "/api/articles/mine", "/api/editorial/published", "/api/analytics/overview"]) codes.push((await after.req("GET", url)).status);
  check("alyaa", "old session cookie after logout, on all four services", "401 everywhere", `logout HTTP ${r.status}; me/articles/editorial/analytics=${codes.join(",")}`, codes.every(c => c === 401));

  // Identity -> SNS security alert, delivered to a temporary SQS subscriber
  const probe = `supporthub-alert-probe-${Date.now()}`;
  aws(["sqs", "create-queue", "--queue-name", probe]);
  const sub = JSON.parse(aws(["sns", "subscribe", "--topic-arn", ALERTS, "--protocol", "sqs", "--notification-endpoint", `arn:aws:sqs:us-east-1:${ACCOUNT}:${probe}`]));
  stop("identity"); start("identity"); // resets the one-per-minute alert throttle
  await poll(async () => (await fetch("http://localhost:3206/api/health")).ok);
  const bad = await new Client().login("author", "Wrong-password-1");
  const msg = await poll(() => {
    const out = aws(["sqs", "receive-message", "--queue-url", `${FLOCI}/${ACCOUNT}/${probe}`]);
    const body = out && JSON.parse(out).Messages?.[0]?.Body;
    return body && JSON.parse(JSON.parse(body).Message || body);
  }, 20000);
  check("alyaa", "failed login publishes an SNS security alert with the Identity IAM user", "event authentication_failed delivered, no personal data",
    `login HTTP ${bad.status}, message keys=${msg ? Object.keys(msg).sort().join(",") : "none"}, event=${msg?.event}`,
    bad.status === 401 && msg?.event === "authentication_failed" && Object.keys(msg).length === 3);
  aws(["sns", "unsubscribe", "--subscription-arn", sub.SubscriptionArn]);
  aws(["sqs", "delete-queue", "--queue-url", `${FLOCI}/${ACCOUNT}/${probe}`]);
}

// ------------------------------------------------------------ SALMA
async function salma() {
  let id = await queued();
  let rs = await Promise.all([decide(editor, id, "approved"), decide(editor2, id, "rejected")]);
  let rows = sql(`SELECT count(*) FROM editorial_reviews WHERE article_id=${id} AND decision<>'pending'`);
  check("salma", "two editors decide the same article at the same time", "exactly one 201, one decision, matching article status",
    `HTTP ${rs.map(r => r.status).join(",")}, decisions=${rows}, article=${status(id)}`,
    rs.filter(r => r.status === 201).length === 1 && rows === "1" && status(id) === (rs[0].status === 201 ? "approved" : "draft"));

  id = await queued();
  await decide(editor, id, "approved");
  rs = await Promise.all(Array.from({ length: 5 }, () => editor.req("PATCH", `/api/articles/${id}/publication`)));
  const events = sql(`SELECT count(*) FROM editorial_publication_event_outbox WHERE article_id=${id}`);
  check("salma", "5 concurrent publish requests", "published once, 1 publication event, no 5xx",
    `HTTP ${rs.map(r => r.status).join(",")}, article=${status(id)}, events=${events}`,
    status(id) === "published" && events === "1" && rs.every(r => r.status < 500));

  let r = await decide(editor, id, "rejected");
  check("salma", "decide an already published article", "HTTP 409", `HTTP ${r.status}`, r.status === 409);
  r = await decide(author, id, "approved");
  check("salma", "author tries to approve", "HTTP 403", `HTTP ${r.status}`, r.status === 403);
  id = await queued();
  r = await editor.req("POST", `/api/articles/${id}/reviews`, { decision: "rejected", comments: "" });
  check("salma", "reject without a comment", "HTTP 400, still pending", `HTTP ${r.status}, article=${status(id)}`, r.status === 400 && status(id) === "in_review");
  r = await editor.req("POST", `/api/articles/${id}/reviews`, { decision: "maybe", comments: "x" });
  check("salma", "invalid decision value", "HTTP 400", `HTTP ${r.status}`, r.status === 400);
  const noCsrf = new Client(); noCsrf.cookie = editor.cookie;
  r = await noCsrf.req("POST", `/api/articles/${id}/reviews`, { decision: "approved", comments: "Forged request" });
  check("salma", "decision without CSRF token", "HTTP 403", `HTTP ${r.status}`, r.status === 403);

  // Duplicate delivery: re-send the very same event (admin credentials, isolated queue)
  const payload = sql(`SELECT payload FROM article_event_outbox WHERE article_id=${id}`);
  for (let i = 0; i < 3; i += 1) aws(["sqs", "send-message", "--queue-url", QUEUE, "--message-body", payload]);
  await sleep(12000);
  check("salma", "the same SQS event delivered 3 more times", "1 inbox row, 1 review",
    `inbox=${sql(`SELECT count(*) FROM editorial_event_inbox WHERE article_id=${id}`)}, reviews=${sql(`SELECT count(*) FROM editorial_reviews WHERE article_id=${id}`)}`,
    sql(`SELECT count(*) FROM editorial_event_inbox WHERE article_id=${id}`) === "1" && sql(`SELECT count(*) FROM editorial_reviews WHERE article_id=${id}`) === "1");

  // Poison message -> dead-letter queue, worker keeps working
  const dlq = `${FLOCI}/${ACCOUNT}/supporthub-article-events-dlq`;
  const dlqCount = () => Number(JSON.parse(aws(["sqs", "get-queue-attributes", "--queue-url", dlq, "--attribute-names", "ApproximateNumberOfMessages"])).Attributes.ApproximateNumberOfMessages);
  const before = dlqCount();
  aws(["sqs", "send-message", "--queue-url", QUEUE, "--message-body", "not-json-poison-message"]);
  const id2 = await queued();
  check("salma", "valid event is processed while a malformed one is in the queue", "article queued", `article ${id2} queued`, true);
  const moved = await poll(() => dlqCount() > before, 240000, 5000);
  check("salma", "malformed event goes to the dead-letter queue after 5 receives", "DLQ count increases", `before=${before}, after=${dlqCount()}`, moved);

  // Consumer stopped, then restarted
  stop("editorial-article-worker");
  id = await draft(); await submit(id); await sleep(8000);
  const waiting = sql(`SELECT count(*) FROM editorial_reviews WHERE article_id=${id}`);
  start("editorial-article-worker");
  const recovered = await inQueue(id);
  check("salma", "event consumer stopped, article submitted, consumer restarted", "0 reviews while down, 1 after restart", `while down=${waiting}, after=${recovered ? 1 : 0}`, waiting === "0" && recovered);

  // Article Service down during a decision
  stop("article");
  r = await decide(editor, id, "approved");
  const during = r.status;
  start("article");
  await poll(async () => (await fetch("http://localhost:3205/api/health")).ok);
  r = await decide(editor, id, "approved");
  await poll(() => status(id) === "approved", 30000);
  check("salma", "Article Service down during approval, then retried", "safe 5xx, then one consistent approval",
    `down HTTP ${during}, retry HTTP ${r.status}, article=${status(id)}, decisions=${sql(`SELECT count(*) FROM editorial_reviews WHERE article_id=${id} AND decision='approved'`)}`,
    during >= 500 && status(id) === "approved" && sql(`SELECT count(*) FROM editorial_reviews WHERE article_id=${id} AND decision='approved'`) === "1");

  // Search Service down during publication: the publication outbox must recover it
  stop("search");
  r = await editor.req("PATCH", `/api/articles/${id}/publication`);
  const pub = r.status;
  start("search");
  await poll(async () => (await fetch("http://localhost:3208/api/health")).ok);
  const indexedSql = `SELECT count(*) FROM search_published_articles WHERE article_id=${id}`;
  // By design an uncertain delivery is not retried automatically: the outbox row
  // is parked as needs_reconciliation and the Search sync job repairs the index.
  const parked = sql(`SELECT state FROM publication_outbox WHERE article_id=${id} ORDER BY outbox_id DESC LIMIT 1`);
  const missing = sql(indexedSql) === "0";
  docker("exec", C("search"), "node", "start.js", "scripts/sync-published.js");
  const indexed = await poll(() => sql(indexedSql) === "1", 15000);
  check("salma", "Search Service down during publication, then Search sync job run", "published; delivery parked needs_reconciliation; indexed after the sync job",
    `publish HTTP ${pub}, article=${status(id)}, outbox=${parked}, missing before sync=${missing}, indexed after sync=${Boolean(indexed)}`,
    status(id) === "published" && parked === "needs_reconciliation" && missing && indexed);

  r = await new Client().req("POST", "/internal/retry-notifications", {}, { base: "http://localhost:3207", headers: { authorization: "Bearer wrong" } });
  check("salma", "internal job endpoint with a wrong secret", "rejected (401/403/404)", `HTTP ${r.status}`, [401, 403, 404].includes(r.status));
}

// ------------------------------------------------------------ NERMEEN
async function nermeen() {
  const anon = new Client();
  const id = await published();
  const vote = (who, helpful) => who.req("POST", `/api/articles/${id}/votes`, { helpful, turnstileToken: TURNSTILE });
  let rs = await Promise.all(Array.from({ length: 10 }, (_, i) => vote(author2, i % 2 === 0)));
  check("nermeen", "10 concurrent votes by one user on one article", "one stored vote",
    `HTTP ${[...new Set(rs.map(r => r.status))].join(",")}, rows=${sql(`SELECT count(*) FROM helpfulness_votes WHERE article_id=${id}`)}`,
    sql(`SELECT count(*) FROM helpfulness_votes WHERE article_id=${id}`) === "1");
  await vote(author2, false);
  check("nermeen", "vote can be changed without adding a row", "1 row, helpful=f",
    sql(`SELECT count(*) || ' row, helpful=' || bool_or(helpful) FROM helpfulness_votes WHERE article_id=${id}`),
    sql(`SELECT helpful FROM helpfulness_votes WHERE article_id=${id}`) === "f");
  let r = await vote(author2, "yes");
  check("nermeen", "invalid vote value", "HTTP 400", `HTTP ${r.status}`, r.status === 400);
  r = await author2.req("POST", `/api/articles/${id}/votes`, { helpful: true });
  check("nermeen", "vote without Turnstile token", "HTTP 400 or 403", `HTTP ${r.status}`, [400, 403].includes(r.status));
  const noCsrf = new Client(); noCsrf.cookie = author2.cookie;
  r = await noCsrf.req("POST", `/api/articles/${id}/votes`, { helpful: true, turnstileToken: TURNSTILE });
  check("nermeen", "vote without CSRF token", "HTTP 403", `HTTP ${r.status}`, r.status === 403);

  for (const [text, label] of [
    ["Excellent support! I love this helpful article.", "POSITIVE"],
    ["Terrible support. This article is awful and useless.", "NEGATIVE"],
    ["The article contains information about account settings.", "NEUTRAL"]
  ]) {
    r = await author2.req("POST", `/api/articles/${id}/feedback`, { comment: text, turnstileToken: TURNSTILE });
    const stored = sql(`SELECT sentiment_status || '/' || sentiment_label FROM article_feedback WHERE article_id=${id} ORDER BY 1 DESC, feedback_id DESC LIMIT 50`).split("\n");
    const last = sql(`SELECT sentiment_label FROM article_feedback WHERE article_id=${id} ORDER BY feedback_id DESC LIMIT 1`);
    check("nermeen", `written feedback classified locally (${label})`, `HTTP 201, stored ${label}`, `HTTP ${r.status}, stored ${last} (${stored.length} rows)`, r.status === 201 && last === label);
  }
  r = await author2.req("POST", `/api/articles/${id}/feedback`, { comment: "", turnstileToken: TURNSTILE });
  check("nermeen", "empty feedback", "HTTP 400", `HTTP ${r.status}`, r.status === 400);
  await sleep(16000); // analytics cache
  r = await admin.req("GET", "/api/analytics/overview");
  check("nermeen", "sentiment appears in the analytics overview", "HTTP 200 with POSITIVE, NEGATIVE, NEUTRAL",
    `HTTP ${r.status}, sentiment=${JSON.stringify(r.data.sentiment ?? r.data.sentimentBreakdown ?? null)}`,
    r.status === 200 && ["POSITIVE", "NEGATIVE", "NEUTRAL"].every(x => JSON.stringify(r.data).toUpperCase().includes(x)));
  const dbSearches = sql("SELECT count(*) FROM search_query_logs");
  check("nermeen", "analytics totalSearches equals the database", `${dbSearches}`, r.data.totalSearches, Math.abs(Number(r.data.totalSearches) - Number(dbSearches)) === 0);

  const draftId = await draft();
  r = await anon.req("GET", `/api/public/articles/${draftId}`);
  check("nermeen", "public request for a draft", "HTTP 404", `HTTP ${r.status}`, r.status === 404);
  const title = sql(`SELECT title FROM articles WHERE id=${draftId}`);
  r = await anon.req("GET", `/api/public/articles?q=${encodeURIComponent(title)}`);
  check("nermeen", "draft is not in public search", "draft ID absent", `HTTP ${r.status}, ${(r.data.results || []).length} results`, r.status === 200 && !(r.data.results || []).some(x => Number(x.article_id ?? x.id) === draftId));
  r = await anon.req("GET", "/api/public/articles?q=resilience&page=1&pageSize=1");
  check("nermeen", "pagination limit", "at most 1 result", `HTTP ${r.status}, ${(r.data.results || []).length} result(s)`, r.status === 200 && (r.data.results || []).length <= 1);
  r = await anon.req("GET", `/api/public/articles?q=${"x".repeat(600)}`);
  check("nermeen", "600-character query", "HTTP 400", `HTTP ${r.status}`, r.status === 400);
  r = await anon.req("GET", `/api/public/articles?q=${encodeURIComponent("' OR 1=1 --")}`);
  check("nermeen", "SQL injection text in search", "handled as plain text (200 or 400), tables intact", `HTTP ${r.status}, articles=${sql("SELECT count(*)>0 FROM articles")}`, [200, 400].includes(r.status));
  r = await anon.req("GET", "/api/analytics/overview");
  check("nermeen", "analytics without login", "HTTP 401", `HTTP ${r.status}`, r.status === 401);
  r = await author.req("GET", "/api/analytics/exports");
  check("nermeen", "analytics exports as author", "HTTP 403", `HTTP ${r.status}`, r.status === 403);
  r = await anon.req("POST", "/internal/publications", { articleId: draftId }, { base: "http://localhost:3208" });
  check("nermeen", "internal publication endpoint without signature", "HTTP 401", `HTTP ${r.status}`, r.status === 401);

  r = await admin.req("POST", "/api/analytics/exports");
  const list = await admin.req("GET", "/api/analytics/exports");
  check("nermeen", "S3 CSV export after recovery", "created and listed", `HTTP ${r.status}, listed HTTP ${list.status}`, [200, 201].includes(r.status) && list.status === 200);
  const metrics = JSON.parse(aws(["cloudwatch", "list-metrics", "--namespace", "SupportHub/Search"])).Metrics || [];
  check("nermeen", "CloudWatch custom metrics recorded", "at least 1 metric", [...new Set(metrics.map(m => m.MetricName))].join(", "), metrics.length > 0);
  const items = JSON.parse(aws(["dynamodb", "scan", "--table-name", "supporthub-search-counters", "--select", "COUNT"])).Count;
  check("nermeen", "DynamoDB live counters stored", "at least 1 item", `${items} items`, items > 0);

  // Database outage (isolated PostgreSQL only)
  stop("postgres");
  const down = await poll(async () => { const x = await fetch("http://localhost:3208/api/health", { signal: AbortSignal.timeout(20000) }); return x.status !== 200 ? x.status : null; }, 60000);
  start("postgres");
  const up = await poll(async () => (await fetch("http://localhost:3208/api/health")).ok, 90000);
  const all = [];
  for (const p of [3205, 3206, 3207, 3208]) all.push(await poll(async () => (await fetch(`http://localhost:${p}/api/health`)).ok, 60000) ? 200 : "down");
  check("nermeen", "PostgreSQL stopped and started", "health 500 while down (documented in HEALTH-CHECK.md), 200 after; data kept", `down HTTP ${down}, recovered=${Boolean(up)}, votes kept=${sql(`SELECT count(*) FROM helpfulness_votes WHERE article_id=${id}`)}`, down === 500 && up);
  check("integration", "all four services reconnect after the database restart", "200,200,200,200", all.join(","), all.every(x => x === 200));
}

const only = process.argv[2];
for (const [name, run] of Object.entries({ alyaa, salma, nermeen })) {
  if (only && only !== name) continue;
  try { await run(); } catch (e) { check(name, "test section completed", "no exception", `${e.message} ${e.cause?.code || e.cause?.message || ""}`, false); console.error(e.stack); }
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
const COMPONENT = { alyaa: "Article Management + Identity (Alyaa)", salma: "Editorial (Salma)", nermeen: "Search & Analytics (Nermeen)", integration: "Integration (group)" };
for (const owner of Object.keys(COMPONENT)) {
  const mine = results.filter(r => r.owner === owner);
  if (!mine.length) continue;
  const dir = path.join(ROOT, "evidence/final", owner);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `resilience-security-${stamp}.txt`), [
    "Test command: node tests/integration/resilience-check.mjs",
    `Timestamp: ${new Date().toISOString()}`,
    `Component / owner: ${COMPONENT[owner]}`,
    "Environment: isolated stack supporthub-iso-* (own Floci :4567, own PostgreSQL; no Neon, no team containers)",
    "Evidence source: real HTTP responses, database queries, AWS CLI and docker stop/start",
    "", ...mine.flatMap(r => [`[${r.ok ? "PASS" : "FAIL"}] ${r.name}`, `    time:     ${r.at}`, `    expected: ${r.expected}`, `    actual:   ${r.actual}`]),
    "", `Total: ${mine.filter(r => r.ok).length} passed, ${mine.filter(r => !r.ok).length} failed`, ""].join("\n"));
}
console.log(`\nTotal: ${results.filter(r => r.ok).length} passed, ${results.filter(r => !r.ok).length} failed`);
process.exitCode = results.some(r => !r.ok) ? 1 : 0;
