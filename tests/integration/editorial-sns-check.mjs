// SupportHub Group 12 - Phase 4 (Editorial): SNS publication notifications
//
// Real application actions in the ISOLATED stack trigger the Editorial
// publication outbox -> publication worker -> SNS (isolated Floci :4567).
// A verification-only SQS queue subscribed to the topic captures the exact
// SNS envelope that subscribers receive. Disruptive steps (stopping the
// isolated worker / isolated Floci) touch supporthub-iso-* containers only.
//
//   node tests/integration/editorial-sns-check.mjs baseline   # A-E + recovery probe
//   node tests/integration/editorial-sns-check.mjs recovery   # recovery of failed events
//
// OUT=<file> writes the transcript (no passwords, cookies, tokens or keys).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODE = process.argv[2] || "baseline";
const BASE = "http://localhost:8188";           // isolated same-origin proxy
const EDITORIAL = "http://127.0.0.1:3207";      // isolated Editorial (internal endpoints)
const FLOCI = "http://localhost:4567";          // isolated Floci
const DB = "supporthub-iso-postgres";
const ACC = "000000000000";
const TOPIC = `arn:aws:sns:us-east-1:${ACC}:supporthub-editorial-publication-events`;
const AUDIT = "supporthub-editorial-publication-audit";
const AUDIT_URL = `${FLOCI}/${ACC}/${AUDIT}`;
const WORKER = "supporthub-iso-editorial-publication-worker";
const PASSWORD = fs.readFileSync(path.join(ROOT, "infra/floci/.generated/isolated/demo-accounts.txt"), "utf8")
  .match(/^password=(.+)$/m)[1].trim();

const lines = []; let pass = 0, fail = 0;
const log = (t = "") => { lines.push(t); console.log(t); };
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); return ok; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();

const awsEnv = { ...process.env, AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test", AWS_DEFAULT_REGION: "us-east-1", AWS_PAGER: "", MSYS_NO_PATHCONV: "1" };
const aws = (...a) => execFileSync("aws", ["--endpoint-url", FLOCI, "--cli-read-timeout", "20", ...a], { encoding: "utf8", env: awsEnv }).trim();
const sql = q => { try { return execFileSync("docker", ["exec", DB, "psql", "-U", "supporthub", "-d", "supporthub", "-tAc", q], { encoding: "utf8" }).trim(); } catch (e) { return `ERROR ${e.message.split("\n")[0]}`; } };
const docker = (...a) => execFileSync("docker", a, { encoding: "utf8" }).trim();
async function poll(fn, timeoutMs, every = 1000) {
  const s = Date.now();
  while (Date.now() - s < timeoutMs) { const v = await fn(); if (v) return { value: v, ms: Date.now() - s }; await sleep(every); }
  return { value: null, ms: Date.now() - s };
}
const secs = ms => `${(ms / 1000).toFixed(1)} s`;

class Client {
  constructor(label) { this.label = label; this.cookie = ""; this.csrf = null; }
  async req(method, url, { body } = {}) {
    const h = { Accept: "application/json", Origin: BASE };
    if (this.cookie) h.Cookie = this.cookie;
    if (body !== undefined) h["Content-Type"] = "application/json";
    if (!["GET", "HEAD"].includes(method)) { if (!this.csrf) await this.fetchCsrf(); h["X-CSRF-Token"] = this.csrf; }
    const res = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() || []) if (c.startsWith("supporthub.sid=")) this.cookie = c.split(";")[0];
    let data = {}; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }
  async fetchCsrf() { this.csrf = (await this.req("GET", "/api/auth/csrf")).data.csrfToken; }
  async login(email) {
    await this.fetchCsrf();
    const r = await this.req("POST", "/api/auth/login", { body: { email, password: PASSWORD } });
    if (r.data.csrfToken) this.csrf = r.data.csrfToken;
    this.id = r.data.user?.id; return r;
  }
}

// ---- audit subscriber: drain all messages, index envelopes by eventId
const audit = new Map();
function drainAudit() {
  for (let i = 0; i < 20; i++) {
    const out = aws("sqs", "receive-message", "--queue-url", AUDIT_URL, "--max-number-of-messages", "10", "--wait-time-seconds", "1", "--output", "json");
    const msgs = out ? JSON.parse(out).Messages || [] : [];
    if (!msgs.length) return;
    for (const m of msgs) {
      const env = JSON.parse(m.Body);
      let inner = null; try { inner = JSON.parse(env.Message); } catch {}
      const key = inner?.eventId || `non-json:${env.MessageId}`;
      if (!audit.has(key)) audit.set(key, []);
      audit.get(key).push(env);
      aws("sqs", "delete-message", "--queue-url", AUDIT_URL, "--receipt-handle", m.ReceiptHandle);
    }
  }
}
async function auditFor(eventId, timeoutMs = 30000) {
  return poll(async () => { drainAudit(); return audit.get(eventId)?.length ? audit.get(eventId) : null; }, timeoutMs, 1500);
}
const outbox = id => {
  const r = sql(`SELECT event_id||'|'||state||'|'||attempts||'|'||coalesce(last_error,'')||'|'||payload::text FROM editorial_publication_event_outbox WHERE article_id=${id} ORDER BY created_at`);
  if (!r || r.startsWith("ERROR")) return null;
  const [eventId, state, attempts, lastError, ...p] = r.split("\n")[0].split("|");
  return { eventId, state, attempts: Number(attempts), lastError, payload: JSON.parse(p.join("|")), rows: r.split("\n").length };
};

const author = new Client("author"), editor = new Client("editor"), editor2 = new Client("editor2");
const token = `snscheck${now().replace(/[-:.]/g, "").toLowerCase()}`;
let categoryId;
async function approved(title) {
  let r = await author.req("POST", "/api/articles", { body: { title: `${title} ${token}`, content: `Notification test article for ${title}. ${token}. Follow the documented steps.`, categoryId } });
  const id = r.data.article?.id;
  r = await author.req("POST", `/api/articles/${id}/submit`);
  const q = await poll(async () => (await editor.req("GET", "/api/reviews?status=pending")).data.reviews?.find(x => Number(x.article_id) === Number(id)), 60000);
  r = await editor.req("POST", `/api/articles/${id}/reviews`, { body: { decision: "approved", comments: "Approved for notification test." } });
  check(`article ${id} created, submitted (SQS ${q.value ? "ok" : "timeout"}) and approved`, Boolean(q.value) && r.status === 201, `HTTP ${r.status}`);
  return id;
}
async function publish(id) {
  const r = await editor.req("PATCH", `/api/articles/${id}/publication`);
  check(`editor publishes article ${id} (real application action)`, r.status === 200 && r.data.status === "published", `HTTP ${r.status} ${r.data.error || ""}`);
  return r;
}
async function flociDown() { docker("stop", "-t", "5", "supporthub-iso-floci"); log(`     ${now()} docker stop supporthub-iso-floci`); }
async function flociUp() {
  docker("start", "supporthub-iso-floci"); log(`     ${now()} docker start supporthub-iso-floci`);
  const h = await poll(async () => { try { return (await fetch(`${FLOCI}/_floci/health`)).ok; } catch { return false; } }, 90000);
  check("isolated Floci healthy again (persistent storage)", Boolean(h.value), `after ${secs(h.ms)}`);
}
function cronSecret() {
  const s = aws("secretsmanager", "get-secret-value", "--secret-id", "supporthub/editorial/runtime", "--query", "SecretString", "--output", "text");
  return JSON.parse(s).CRON_SECRET;
}
async function internal(pathname, secret, body) {
  const res = await fetch(EDITORIAL + pathname, { method: "POST", headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify(body || {}) });
  let data = {}; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

log(`Editorial SNS publication notification check (${MODE}) - ${now()}`);
log(`Proxy ${BASE}  Editorial ${EDITORIAL}  Floci ${FLOCI}  DB ${DB}  token ${token}`);
if (!docker("port", "supporthub-iso-floci", "4566").includes("4567")) throw new Error("isolated Floci not on 4567");

// ---- audit subscriber setup (idempotent, isolated Floci only)
const queueArn = `arn:aws:sqs:us-east-1:${ACC}:${AUDIT}`;
aws("sqs", "create-queue", "--queue-name", AUDIT);
const subs = aws("sns", "list-subscriptions-by-topic", "--topic-arn", TOPIC, "--query", "Subscriptions[].Endpoint", "--output", "text");
if (!subs.includes(queueArn)) aws("sns", "subscribe", "--topic-arn", TOPIC, "--protocol", "sqs", "--notification-endpoint", queueArn);
log(`     subscriptions: ${aws("sns", "list-subscriptions-by-topic", "--topic-arn", TOPIC, "--query", "Subscriptions[].[Protocol,Endpoint]", "--output", "text").replace(/\s+/g, " ")}`);
drainAudit();
log(`     audit queue drained before test (${[...audit.values()].flat().length} older messages: ${[...audit.keys()].map(k => k.startsWith("non-json") ? "non-json probe" : k).join(", ") || "none"})`);
audit.clear();

for (const [c, e] of [[author, "author"], [editor, "editor"], [editor2, "editor2"]]) {
  const r = await c.login(`${e}@supporthub.test`); check(`login ${e}`, r.status === 200, `HTTP ${r.status} id=${c.id}`);
}
categoryId = ((await author.req("GET", "/api/categories")).data.categories || [])[0]?.id;

if (MODE === "baseline") {
  // ------------------------------------------------------------ A
  log("\n== A. Publication notification triggered by a real publish");
  const p1 = await approved("SNS normal");
  const since = now();
  await publish(p1);
  const ob1 = await poll(async () => { const o = outbox(p1); return o?.state === "published" ? o : null; }, 30000);
  const o1 = ob1.value || outbox(p1);
  check("publication event queued in outbox in the publish transaction and published by the worker", o1?.state === "published", `state=${o1?.state} attempts=${o1?.attempts} after ${secs(ob1.ms)}`);
  check("payload eventType = editorial.publication.published", o1?.payload.eventType === "editorial.publication.published");
  check("payload articleId = published article", o1?.payload.data?.articleId === Number(p1), `articleId=${o1?.payload.data?.articleId}`);
  check("payload publishedBy = publishing editor", o1?.payload.data?.publishedBy === Number(editor.id), `publishedBy=${o1?.payload.data?.publishedBy}`);
  check("payload occurredAt is ISO-8601 and within the publish window", !Number.isNaN(Date.parse(o1?.payload.occurredAt)) && Math.abs(Date.parse(o1.payload.occurredAt) - Date.parse(since)) < 60000, o1?.payload.occurredAt);
  check("payload eventId is a UUID equal to the outbox primary key", /^[0-9a-f-]{36}$/.test(o1?.payload.eventId) && o1.payload.eventId === o1.eventId, o1?.eventId);
  const a1 = await auditFor(o1.eventId);
  const env = a1.value?.[0];
  check("SNS delivered the notification to a topic subscriber (audit SQS)", Boolean(env), `after ${secs(a1.ms)}`);
  if (env) {
    log(`     SNS envelope: Type=${env.Type} MessageId=${env.MessageId} TopicArn=${env.TopicArn} Timestamp=${env.Timestamp}`);
    log(`     MessageAttributes: ${JSON.stringify(env.MessageAttributes)}`);
    log(`     Message: ${env.Message}`);
    check("envelope Type=Notification from the publication topic", env.Type === "Notification" && env.TopicArn === TOPIC);
    check("delivered Message is byte-identical to the outbox payload", JSON.stringify(JSON.parse(env.Message)) === JSON.stringify(o1.payload));
    check("MessageAttributes eventType/eventId match the payload", env.MessageAttributes?.eventType?.Value === o1.payload.eventType && env.MessageAttributes?.eventId?.Value === o1.eventId);
    check("SNS Timestamp is after the event occurredAt", Date.parse(env.Timestamp) >= Date.parse(o1.payload.occurredAt) - 1000, `${o1.payload.occurredAt} -> ${env.Timestamp}`);
    const wlog = docker("logs", "--since", since, WORKER);
    check("worker log records the same SNS MessageId (publish used the Editorial key)", wlog.includes(env.MessageId), wlog.split("\n").filter(l => l.includes(env.MessageId))[0]?.slice(0, 200));
  }

  // ------------------------------------------------------------ B
  log("\n== B. Duplicate publication is handled safely");
  let r = await editor.req("PATCH", `/api/articles/${p1}/publication`);
  check("second publish of the same article -> 409, no new event", r.status === 409, `HTTP ${r.status} ${r.data.error || ""}`);
  r = await editor2.req("PATCH", `/api/articles/${p1}/publication`);
  check("publish by another editor -> 409", r.status === 409, `HTTP ${r.status} ${r.data.error || ""}`);
  await sleep(8000); drainAudit();
  check("still exactly one outbox event for the article", outbox(p1)?.rows === 1, `rows=${outbox(p1)?.rows}`);
  check("subscriber received exactly ONE notification for the event", audit.get(o1.eventId)?.length === 1, `deliveries=${audit.get(o1.eventId)?.length}`);
  check("editorial_publication_event_outbox.event_id is the primary key (DB-level duplicate guard)",
    sql(`SELECT count(*) FROM pg_constraint WHERE conrelid='editorial_publication_event_outbox'::regclass AND contype='p'`) === "1");

  // ------------------------------------------------------------ C
  log("\n== C. Worker and Editorial restart: notification is durable, not lost");
  const p2 = await approved("SNS worker restart");
  docker("stop", "-t", "10", WORKER); log(`     ${now()} docker stop ${WORKER}`);
  await publish(p2);
  await sleep(10000);
  const o2 = outbox(p2);
  check("with the worker stopped the event stays durable in the outbox (pending, 0 attempts)", o2?.state === "pending" && o2.attempts === 0, `state=${o2?.state} attempts=${o2?.attempts}`);
  drainAudit();
  check("nothing was delivered while the worker was stopped", !audit.get(o2.eventId));
  docker("restart", "-t", "10", "supporthub-iso-editorial"); log(`     ${now()} docker restart supporthub-iso-editorial (API restart)`);
  await poll(async () => { try { return (await fetch(`${EDITORIAL}/api/health`)).ok; } catch { return false; } }, 60000);
  r = await editor2.req("GET", "/api/editorial/flags?limit=100");
  const f3 = (r.data.flags || []).find(f => Number(f.flag_id) === 3);
  check("[Task 1 persistence] open re-review flag #3 (article 233) survived the Editorial restart", r.status === 200 && f3?.status === "open", `HTTP ${r.status}`);
  if (f3) {
    r = await editor2.req("PATCH", "/api/flags/3", { body: { resolution: "Baseline test flag reviewed after restart; content still valid." } });
    check("[Task 1] flag #3 resolved through the API after the restart", r.status === 200, `HTTP ${r.status}`);
  }
  docker("start", WORKER); log(`     ${now()} docker start ${WORKER}`);
  const ob2 = await poll(async () => outbox(p2)?.state === "published", 30000);
  check("after worker restart the pending event is published", Boolean(ob2.value), `after ${secs(ob2.ms)} attempts=${outbox(p2)?.attempts}`);
  const a2 = await auditFor(o2.eventId);
  check("subscriber received the recovered notification exactly once", a2.value?.length === 1, `deliveries=${a2.value?.length}`);

  // ------------------------------------------------------------ D
  log("\n== D. Short SNS outage: failure recorded, automatic retry with backoff");
  const p3 = await approved("SNS short outage");
  await flociDown();
  await publish(p3);
  const f = await poll(async () => { const o = outbox(p3); return o && o.attempts >= 1 ? o : null; }, 60000);
  check("SNS failure recorded on the event (attempts incremented, last_error stored, state pending)",
    f.value?.attempts >= 1 && f.value.state === "pending" && f.value.lastError.length > 0, `state=${f.value?.state} attempts=${f.value?.attempts} last_error="${f.value?.lastError}" after ${secs(f.ms)}`);
  const nxt = sql(`SELECT round(extract(epoch from next_attempt_at-now()))||' s' FROM editorial_publication_event_outbox WHERE article_id=${p3}`);
  log(`     next retry scheduled in ${nxt}`);
  const wl = docker("logs", "--since", "2m", WORKER).split("\n").filter(l => /pending|Publication event/.test(l)).slice(-2);
  check("worker logged the failed attempt (not silent)", wl.length > 0, wl.join(" / ").slice(0, 220));
  await sleep(10000);
  await flociUp();
  const ob3 = await poll(async () => outbox(p3)?.state === "published", 90000, 2000);
  const o3 = outbox(p3);
  check("event published automatically after SNS recovered", Boolean(ob3.value), `after ${secs(ob3.ms)}, attempts=${o3?.attempts}`);
  const a3 = await auditFor(o3.eventId, 30000);
  check("subscriber received the retried notification exactly once", a3.value?.length === 1, `deliveries=${a3.value?.length}`);

  // ------------------------------------------------------------ E
  log("\n== E. Long SNS outage: retries exhausted, event kept as 'failed'");
  const p4 = await approved("SNS long outage");
  await flociDown();
  await publish(p4);
  const fe = await poll(async () => { const o = outbox(p4); return o?.state === "failed" ? o : null; }, 240000, 3000);
  check("after 5 failed attempts the event is persisted as 'failed' (not deleted)", fe.value?.state === "failed" && fe.value.attempts === 5,
    `state=${fe.value?.state} attempts=${fe.value?.attempts} last_error="${fe.value?.lastError}" after ${secs(fe.ms)}`);
  await flociUp();
  await sleep(20000); drainAudit();
  const o4 = outbox(p4);
  check("article itself stays published (notification failure does not roll back publication)", sql(`SELECT status FROM articles WHERE id=${p4}`) === "published");
  log(`     after SNS recovered: state=${o4.state} attempts=${o4.attempts}; delivered=${audit.get(o4.eventId)?.length || 0}`);
  log(`     FAILED_EVENT_ID=${o4.eventId} FAILED_ARTICLE_ID=${p4}`);

  log("\n== E2. Is there a supported recovery path for a failed notification?");
  const secret = cronSecret();
  r = await internal("/internal/retry-notifications", secret);
  check("existing protected retry endpoint answers", r.status === 200, `HTTP ${r.status}`);
  await sleep(8000); drainAudit();
  check("existing retry endpoint (Search outbox only) does NOT recover the failed SNS event", outbox(p4).state === "failed", `state=${outbox(p4).state}`);
  r = await internal("/internal/retry-publication-events", secret, { eventId: o4.eventId });
  check("an authenticated recovery path for failed SNS notifications exists", r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.data)}`);
}

if (MODE === "recovery") {
  log("\n== R. Recovery of failed SNS notifications (POST /internal/retry-publication-events)");
  const failed = sql(`SELECT event_id||'|'||article_id FROM editorial_publication_event_outbox WHERE state='failed' ORDER BY created_at DESC LIMIT 1`);
  const [eventId, articleId] = failed.split("|");
  check("a failed event from the baseline long-outage test is present", /^[0-9a-f-]{36}$/.test(eventId || ""), `event=${eventId} article=${articleId}`);
  const secret = cronSecret();
  let r = await internal("/internal/retry-publication-events", null, { eventId });
  check("no Authorization -> 401", r.status === 401, `HTTP ${r.status}`);
  r = await internal("/internal/retry-publication-events", "x".repeat(64), { eventId });
  check("wrong cron secret -> 401", r.status === 401, `HTTP ${r.status}`);
  const pr = await fetch(`${BASE}/internal/retry-publication-events`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: "{}" });
  check("endpoint is not exposed through the browser proxy", pr.status !== 200, `HTTP ${pr.status}`);
  r = await editor.req("POST", "/api/editorial/notifications/retry");
  log(`     (editor session cannot reach /internal; existing editor retry route answered HTTP ${r.status})`);
  r = await internal("/internal/retry-publication-events", secret, { eventId: "not-a-uuid" });
  check("invalid eventId -> 400", r.status === 400, `HTTP ${r.status}`);
  check("still failed after rejected requests", outbox(articleId).state === "failed");
  r = await internal("/internal/retry-publication-events", secret, { eventId });
  check("authorized requeue -> 200, 1 event requeued", r.status === 200 && r.data.requeued === 1, `HTTP ${r.status} ${JSON.stringify(r.data)}`);
  const ob = await poll(async () => outbox(articleId)?.state === "published", 30000);
  const o = outbox(articleId);
  check("worker published the requeued event", Boolean(ob.value), `after ${secs(ob.ms)} state=${o.state} attempts=${o.attempts} last_error="${o.lastError}"`);
  const a = await auditFor(eventId);
  const env = a.value?.[0];
  check("subscriber received the recovered notification exactly once", a.value?.length === 1, `deliveries=${a.value?.length}`);
  if (env) {
    log(`     SNS envelope: MessageId=${env.MessageId} Timestamp=${env.Timestamp}`);
    log(`     Message: ${env.Message}`);
    check("recovered notification keeps the ORIGINAL eventId / articleId / occurredAt", JSON.stringify(JSON.parse(env.Message)) === JSON.stringify(o.payload) && o.payload.data.articleId === Number(articleId));
  }
  r = await internal("/internal/retry-publication-events", secret, { eventId });
  check("repeating the requeue for a published event is a no-op (requeued 0)", r.status === 200 && r.data.requeued === 0, JSON.stringify(r.data));
  await sleep(8000); drainAudit();
  check("no duplicate delivery after the repeated requeue", audit.get(eventId)?.length === 1, `deliveries=${audit.get(eventId)?.length}`);
  log(`     outbox states: ${sql("SELECT string_agg(state||'='||n, ', ') FROM (SELECT state, count(*) n FROM editorial_publication_event_outbox GROUP BY state ORDER BY state) t")}`);
}

log(`\nTotal: ${pass} passed, ${fail} failed`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, lines.join("\n") + "\n");
process.exitCode = fail ? 1 : 0;
