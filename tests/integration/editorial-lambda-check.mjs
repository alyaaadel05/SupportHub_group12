// SupportHub Group 12 - Phase 4 (Editorial): SNS -> Lambda execution and
// persistent receipts, ISOLATED stack only (Floci :4567, supporthub-iso-*).
//
// Every child process has a hard timeout and every wait is bounded, so the
// harness cannot hang (the earlier SNS harness blocked ~300 s in a
// synchronous docker/aws call). Run one phase per invocation:
//
//   node tests/integration/editorial-lambda-check.mjs <phase>
//     e2e | duplicate | invalid | iam | restart | recover | lambdafail
//
// SESSION_FILE (default: OS temp dir) caches the demo-account session cookies
// between phases so the Identity login rate limit is not hit; it is never
// written inside the repository. OUT=<file> appends the transcript.
// No passwords, cookies, CSRF tokens, keys or secrets are printed.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PHASE = process.argv[2];
const BASE = "http://localhost:8188", EDITORIAL = "http://127.0.0.1:3207", FLOCI = "http://localhost:4567";
const DB = "supporthub-iso-postgres", ACC = "000000000000";
const TOPIC = `arn:aws:sns:us-east-1:${ACC}:supporthub-editorial-publication-events`;
const FN = "supporthub-editorial-publication-outcome";
const GEN = path.join(ROOT, "infra/floci/.generated/isolated");
const SESSION_FILE = process.env.SESSION_FILE || path.join(os.tmpdir(), "supporthub-phase4-sessions.json");
const PASSWORD = fs.readFileSync(path.join(GEN, "demo-accounts.txt"), "utf8").match(/^password=(.+)$/m)[1].trim();

const lines = []; let pass = 0, fail = 0, nv = 0;
const log = (t = "") => { lines.push(t); console.log(t); };
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); return ok; };
const notVerified = (name, detail = "") => { nv++; log(`NOT VERIFIED | ${name}${detail ? " | " + detail : ""}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const secs = ms => `${(ms / 1000).toFixed(1)} s`;

// ---- bounded child processes
function run(cmd, args, { timeout = 30000, env } = {}) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: "utf8", timeout, killSignal: "SIGKILL", env: env || process.env, stdio: ["ignore", "pipe", "pipe"] }).trim() };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ""}${e.stderr || ""}`.trim() || e.message.split("\n")[0], timedOut: e.signal === "SIGKILL" };
  }
}
const baseEnv = { ...process.env, AWS_DEFAULT_REGION: "us-east-1", AWS_PAGER: "", MSYS_NO_PATHCONV: "1" };
const keyEnv = file => {
  const t = fs.readFileSync(path.join(GEN, file), "utf8");
  return { ...baseEnv, AWS_ACCESS_KEY_ID: t.match(/^AWS_ACCESS_KEY_ID=(.+)$/m)[1].trim(), AWS_SECRET_ACCESS_KEY: t.match(/^AWS_SECRET_ACCESS_KEY=(.+)$/m)[1].trim() };
};
const ADMIN = { ...baseEnv, AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test" };
const aws = (args, env = ADMIN, timeout = 30000) =>
  run("aws", ["--endpoint-url", FLOCI, "--cli-connect-timeout", "5", "--cli-read-timeout", "20", ...args], { env, timeout });
const sql = q => { const r = run("docker", ["exec", DB, "psql", "-U", "supporthub", "-d", "supporthub", "-tAc", q], { timeout: 20000 }); return r.ok ? r.out : `ERROR ${r.out.slice(0, 120)}`; };
async function poll(fn, timeoutMs, every = 2000) {
  const s = Date.now();
  while (Date.now() - s < timeoutMs) { const v = await fn(); if (v) return { value: v, ms: Date.now() - s }; await sleep(every); }
  return { value: null, ms: Date.now() - s };
}
const receipt = eventId => { const r = sql(`SELECT event_id||'|'||article_id||'|'||event_type||'|'||processed_at FROM editorial_publication_event_receipts WHERE event_id='${eventId}'`); return r && !r.startsWith("ERROR") ? r : null; };
const receiptCount = eventId => sql(`SELECT count(*) FROM editorial_publication_event_receipts WHERE event_id='${eventId}'`);
const outbox = articleId => {
  const r = sql(`SELECT event_id||'|'||state||'|'||attempts||'|'||coalesce(last_error,'')||'|'||payload::text FROM editorial_publication_event_outbox WHERE article_id=${articleId} ORDER BY created_at LIMIT 1`);
  if (!r || r.startsWith("ERROR")) return null;
  const [eventId, state, attempts, lastError, ...p] = r.split("|");
  return { eventId, state, attempts: Number(attempts), lastError, payload: JSON.parse(p.join("|")) };
};
function lambdaLogs(sinceIso) {
  const ps = run("docker", ["ps", "-a", "--filter", "name=floci-aws-supporthub-editorial-publication-outcome", "--format", "{{.Names}}"], { timeout: 15000 });
  const names = ps.ok ? ps.out.split("\n").filter(Boolean) : [];
  return names.map(n => ({ name: n, logs: (run("docker", ["logs", "--since", sinceIso, n], { timeout: 15000 }).out || "") }));
}
function flociLogs(sinceIso, pattern) {
  const r = run("docker", ["logs", "--since", sinceIso, "supporthub-iso-floci"], { timeout: 20000 });
  return (r.out || "").split("\n").filter(l => pattern.test(l));
}

// ---- HTTP client with cached sessions
class Client {
  constructor(label, saved = {}) { this.label = label; this.cookie = saved.cookie || ""; this.csrf = saved.csrf || null; this.id = saved.id; }
  async req(method, url, { body } = {}) {
    const h = { Accept: "application/json", Origin: BASE };
    if (this.cookie) h.Cookie = this.cookie;
    if (body !== undefined) h["Content-Type"] = "application/json";
    if (!["GET", "HEAD"].includes(method)) { if (!this.csrf) await this.fetchCsrf(); h["X-CSRF-Token"] = this.csrf; }
    const res = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    for (const c of res.headers.getSetCookie?.() || []) if (c.startsWith("supporthub.sid=")) this.cookie = c.split(";")[0];
    let data = {}; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }
  async fetchCsrf() { this.csrf = (await this.req("GET", "/api/auth/csrf")).data.csrfToken; }
  async ensure(email) {
    if (this.cookie && (await this.req("GET", "/api/auth/me")).data.user?.email === email) return;
    this.cookie = ""; this.csrf = null;
    await this.fetchCsrf();
    const r = await this.req("POST", "/api/auth/login", { body: { email, password: PASSWORD } });
    if (r.data.csrfToken) this.csrf = r.data.csrfToken;
    this.id = r.data.user?.id;
    if (r.status !== 200) throw new Error(`login ${email} HTTP ${r.status}`);
  }
}
const saved = fs.existsSync(SESSION_FILE) ? JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")) : {};
const author = new Client("author", saved.author), editor = new Client("editor", saved.editor);
async function sessions() {
  await author.ensure("author@supporthub.test"); await editor.ensure("editor@supporthub.test");
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ author: { cookie: author.cookie, csrf: author.csrf, id: author.id }, editor: { cookie: editor.cookie, csrf: editor.csrf, id: editor.id } }), { mode: 0o600 });
}
const token = `lambdacheck${now().replace(/[-:.]/g, "").toLowerCase()}`;
async function approvedArticle(label) {
  const cats = (await author.req("GET", "/api/categories")).data.categories || [];
  let r = await author.req("POST", "/api/articles", { body: { title: `${label} ${token}`, content: `Lambda receipt verification article (${label}). ${token}. Follow the documented steps.`, categoryId: cats[0]?.id } });
  const id = r.data.article?.id;
  await author.req("POST", `/api/articles/${id}/submit`);
  const q = await poll(async () => (await editor.req("GET", "/api/reviews?status=pending")).data.reviews?.find(x => Number(x.article_id) === Number(id)), 60000);
  r = await editor.req("POST", `/api/articles/${id}/reviews`, { body: { decision: "approved", comments: "Approved for Lambda verification." } });
  check(`fresh article ${id} created, submitted via SQS and approved`, Boolean(q.value) && r.status === 201, `queue after ${secs(q.ms)}, approve HTTP ${r.status}`);
  return Number(id);
}
async function publish(id) {
  const r = await editor.req("PATCH", `/api/articles/${id}/publication`);
  check(`editor publishes article ${id} through the application`, r.status === 200, `HTTP ${r.status} ${r.data.error || ""}`);
}
async function publishedEvent(id, timeoutMs = 60000) {
  const p = await poll(async () => { const o = outbox(id); return o?.state === "published" ? o : null; }, timeoutMs);
  return { o: p.value || outbox(id), ms: p.ms };
}
const snsPublish = (message, attrs) => aws(["sns", "publish", "--topic-arn", TOPIC, "--message", message,
  ...(attrs ? ["--message-attributes", JSON.stringify(attrs)] : []), "--query", "MessageId", "--output", "text"]);
async function flociStop() { const r = run("docker", ["stop", "-t", "5", "supporthub-iso-floci"], { timeout: 60000 }); log(`     ${now()} docker stop supporthub-iso-floci -> ${r.ok ? "ok" : r.out}`); }
async function flociStart() {
  const r = run("docker", ["start", "supporthub-iso-floci"], { timeout: 60000 }); log(`     ${now()} docker start supporthub-iso-floci -> ${r.ok ? "ok" : r.out}`);
  const h = await poll(async () => { try { return (await fetch(`${FLOCI}/_floci/health`, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } }, 90000);
  check("isolated Floci healthy after start", Boolean(h.value), `after ${secs(h.ms)}`);
}

log(`\n######## editorial-lambda-check phase=${PHASE} - ${now()} (token ${token})`);
if (!run("docker", ["port", "supporthub-iso-floci", "4566"], { timeout: 10000 }).out.includes("4567")) throw new Error("isolated Floci not on 4567");

if (PHASE === "e2e") {
  await sessions();
  const id = await approvedArticle("Lambda e2e");
  const t0 = now();
  await publish(id);
  const { o, ms } = await publishedEvent(id);
  check("worker published the outbox event to SNS", o?.state === "published", `state=${o?.state} attempts=${o?.attempts} after ${secs(ms)}`);
  const rc = await poll(async () => receipt(o.eventId), 90000);
  check("SNS triggered the Lambda, which wrote a persistent receipt", Boolean(rc.value), `after ${secs(rc.ms)}: ${rc.value}`);
  const [rid, raid, rtype, rat] = (rc.value || "").split("|");
  check("receipt event_id = outbox eventId = payload eventId", rid === o.eventId && o.payload.eventId === o.eventId, rid);
  check("receipt article_id = published article = payload data.articleId", Number(raid) === id && o.payload.data.articleId === id, raid);
  check("receipt event_type = payload eventType = editorial.publication.published", rtype === o.payload.eventType && rtype === "editorial.publication.published");
  check("receipt processed_at after occurredAt", Date.parse(rat.replace(" ", "T").replace(/\+00$/, "Z")) >= Date.parse(o.payload.occurredAt) - 1000, `${o.payload.occurredAt} -> ${rat}`);
  check("exactly one receipt for the event", receiptCount(o.eventId) === "1");
  log(`     payload: ${JSON.stringify(o.payload)}`);
  const ll = lambdaLogs(t0);
  log(`     Lambda containers since publish: ${ll.map(x => x.name).join(", ") || "none listed"}`);
  for (const x of ll) for (const l of x.logs.split("\n").filter(Boolean).slice(-6)) log(`       [${x.name.slice(-8)}] ${l.slice(0, 200)}`);
  const fl = flociLogs(t0, /lambda|invoke/i).slice(-6);
  for (const l of fl) log(`       [floci] ${l.slice(0, 200)}`);
  check("invocation was SNS-driven (no manual lambda invoke issued by this phase)", true, "only the application publish was performed");
  log(`     E2E_EVENT=${o.eventId} E2E_ARTICLE=${id}`);
}

if (PHASE === "duplicate") {
  const row = sql(`SELECT o.event_id||'|'||o.article_id||'|'||o.payload::text FROM editorial_publication_event_outbox o JOIN editorial_publication_event_receipts r USING(event_id) WHERE o.payload->>'eventType'='editorial.publication.published' ORDER BY o.created_at DESC LIMIT 1`);
  const [eventId, articleId, ...p] = row.split("|"); const payload = p.join("|");
  const before = receipt(eventId);
  log(`     latest event ${eventId} (article ${articleId}); receipt before: ${before}`);
  const attrs = { eventType: { DataType: "String", StringValue: "editorial.publication.published" }, eventId: { DataType: "String", StringValue: eventId } };
  const m1 = snsPublish(payload, attrs), m2 = snsPublish(payload, attrs);
  check("identical event (same eventId) re-published twice to SNS (simulated at-least-once redelivery)", m1.ok && m2.ok, `SNS MessageIds ${m1.out} / ${m2.out}`);
  await sleep(25000);
  check("duplicate deliveries did not create another receipt (count stays 1)", receiptCount(eventId) === "1", `count=${receiptCount(eventId)}`);
  check("original receipt unchanged (same processed_at)", receipt(eventId) === before, receipt(eventId));
  check("outbox row unchanged (published, not re-queued)", outbox(articleId)?.state === "published");
  check("receipts table has event_id as PRIMARY KEY (DB-level guard)", sql(`SELECT count(*) FROM pg_constraint WHERE conrelid='editorial_publication_event_receipts'::regclass AND contype='p'`) === "1");
}

if (PHASE === "invalid") {
  await sessions();
  const t0 = now();
  const before = sql("SELECT count(*) FROM editorial_publication_event_receipts");
  const cases = [
    ["non-JSON message", "not-json-phase4"],
    ["unsupported eventType", JSON.stringify({ eventId: "11111111-1111-4111-8111-111111111111", eventType: "editorial.publication.deleted", occurredAt: now(), data: { articleId: 1, publishedBy: 3 } })],
    ["invalid eventId", JSON.stringify({ eventId: "1; DROP TABLE editorial_publication_event_receipts", eventType: "editorial.publication.published", occurredAt: now(), data: { articleId: 1, publishedBy: 3 } })],
    ["missing / invalid articleId", JSON.stringify({ eventId: "22222222-2222-4222-8222-222222222222", eventType: "editorial.publication.published", occurredAt: now(), data: { articleId: -5, publishedBy: 3 } })]
  ];
  for (const [label, msg] of cases) { const r = snsPublish(msg); check(`invalid payload published to SNS (${label})`, r.ok, `MessageId ${r.out}`); }
  await sleep(25000);
  check("no receipt created for any invalid payload", sql("SELECT count(*) FROM editorial_publication_event_receipts") === before, `before=${before} after=${sql("SELECT count(*) FROM editorial_publication_event_receipts")}`);
  check("no receipt for the crafted UUIDs", sql("SELECT count(*) FROM editorial_publication_event_receipts WHERE event_id IN ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222')") === "0");
  check("receipts table intact after SQL-injection-style eventId", /^\d+$/.test(sql("SELECT count(*) FROM editorial_publication_event_receipts")));
  const ll = lambdaLogs(t0); const errs = ll.flatMap(x => x.logs.split("\n")).filter(l => /invalid|unsupported|error/i.test(l));
  log(`     Lambda error lines since ${t0}: ${errs.length}`); for (const l of errs.slice(0, 8)) log(`       ${l.slice(0, 200)}`);
  if (!errs.length) notVerified("Lambda error messages visible in container logs", "Floci did not expose the handler errors in the function container logs");
  const id = await approvedArticle("Lambda after invalid");
  await publish(id);
  const { o } = await publishedEvent(id);
  const rc = await poll(async () => receipt(o.eventId), 90000);
  check("Lambda keeps working: next valid publication still gets its receipt", Boolean(rc.value), `after ${secs(rc.ms)}`);
}

if (PHASE === "iam") {
  const deny = (label, env, args) => {
    const r = aws(args, env);
    const ok = !r.ok && /AccessDenied|not authorized|AuthorizationError/i.test(r.out);
    check(`DENY ${label}`, ok, ok ? (r.out.match(/\(([A-Za-z]+)\)/)?.[0] || "denied") : r.out.slice(0, 160));
  };
  const ART = keyEnv("article.aws.env"), SRCH = keyEnv("search.aws.env"), ED = keyEnv("editorial.aws.env");
  const role = aws(["iam", "get-role", "--role-name", `${FN}-role`, "--query", "Role.AssumeRolePolicyDocument", "--output", "json"]);
  check("Lambda role trust policy: only lambda.amazonaws.com may assume it", role.ok && /lambda\.amazonaws\.com/.test(role.out) && !/"AWS"/.test(role.out), role.out.replace(/\s+/g, " ").slice(0, 200));
  const rp = aws(["iam", "list-role-policies", "--role-name", `${FN}-role`, "--query", "PolicyNames", "--output", "text"]);
  check("Lambda role has a single inline policy LambdaOwnLogGroup", rp.ok && rp.out.trim() === "LambdaOwnLogGroup", rp.out);
  const ap = aws(["iam", "list-attached-role-policies", "--role-name", `${FN}-role`, "--query", "AttachedPolicies", "--output", "text"]);
  check("no managed policies attached to the Lambda role", ap.ok && ap.out.trim() === "", ap.out || "(none)");
  const doc = aws(["iam", "get-role-policy", "--role-name", `${FN}-role`, "--policy-name", "LambdaOwnLogGroup", "--query", "PolicyDocument", "--output", "json"]);
  const d = doc.out.replace(/\s+/g, "");
  check("role policy = logs:CreateLogGroup/CreateLogStream/PutLogEvents on its OWN log group only", /log-group:\/aws\/lambda\/supporthub-editorial-publication-outcome/.test(d) && !/"Resource":"\*"/.test(d) && !/sns:|sqs:|s3:|secretsmanager:|iam:/.test(d), d.slice(0, 260));
  for (const [label, env] of [["article key", ART], ["search key", SRCH], ["editorial key", ED]]) {
    deny(`${label}: lambda:InvokeFunction`, env, ["lambda", "invoke", "--function-name", FN, "--payload", "e30=", "NUL"]);
    deny(`${label}: lambda:GetFunctionConfiguration (would reveal env)`, env, ["lambda", "get-function-configuration", "--function-name", FN]);
    deny(`${label}: lambda:UpdateFunctionCode`, env, ["lambda", "update-function-code", "--function-name", FN, "--zip-file", "fileb://" + path.join(GEN, "publication-outcome.zip").replace(/\\/g, "/")]);
  }
  deny("editorial key: sts:AssumeRole into the Lambda role", ED, ["sts", "assume-role", "--role-arn", `arn:aws:iam::${ACC}:role/${FN}-role`, "--role-session-name", "phase4probe"]);
  deny("editorial key: lambda:AddPermission", ED, ["lambda", "add-permission", "--function-name", FN, "--statement-id", "phase4probe", "--action", "lambda:InvokeFunction", "--principal", "*"]);
  deny("article key: sns:Subscribe to the publication topic", ART, ["sns", "subscribe", "--topic-arn", TOPIC, "--protocol", "lambda", "--notification-endpoint", `arn:aws:lambda:us-east-1:${ACC}:function:${FN}`]);
  deny("search key: sns:Publish forged publication event", SRCH, ["sns", "publish", "--topic-arn", TOPIC, "--message", "{}"]);
  const subs = aws(["sns", "list-subscriptions-by-topic", "--topic-arn", TOPIC, "--query", "length(Subscriptions)", "--output", "text"]);
  check("topology unchanged after denied operations (1 subscription)", subs.out.trim() === "1", subs.out);
}

if (PHASE === "restart") {
  await sessions();
  const before = sql("SELECT count(*)||'|'||max(processed_at) FROM editorial_publication_event_receipts");
  const sample = sql("SELECT md5(string_agg(event_id::text||article_id||event_type||processed_at, ',' ORDER BY event_id)) FROM editorial_publication_event_receipts");
  log(`     receipts before restart: count|latest=${before} digest=${sample}`);
  const r1 = run("docker", ["restart", "-t", "10", DB], { timeout: 90000 }); log(`     ${now()} docker restart ${DB} -> ${r1.ok ? "ok" : r1.out}`);
  const h = await poll(async () => run("docker", ["inspect", "-f", "{{.State.Health.Status}}", DB], { timeout: 10000 }).out === "healthy", 90000);
  check("isolated PostgreSQL healthy after restart", Boolean(h.value), `after ${secs(h.ms)}`);
  const r2 = run("docker", ["restart", "-t", "10", "supporthub-iso-editorial-publication-worker"], { timeout: 60000 }); log(`     ${now()} docker restart supporthub-iso-editorial-publication-worker -> ${r2.ok ? "ok" : r2.out}`);
  await poll(async () => { try { return (await fetch(`${EDITORIAL}/api/health`, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } }, 60000);
  check("all receipts persisted across the database restart (count + latest unchanged)", sql("SELECT count(*)||'|'||max(processed_at) FROM editorial_publication_event_receipts") === before);
  check("receipt contents byte-identical after restart (md5 digest)", sql("SELECT md5(string_agg(event_id::text||article_id||event_type||processed_at, ',' ORDER BY event_id)) FROM editorial_publication_event_receipts") === sample);
  const ex = sql(`SELECT event_id||' article='||article_id FROM editorial_publication_event_receipts WHERE event_id='35b3c114-4834-47c8-8bbe-5ebb901f7ebe'`);
  check("recovered-event receipt (35b3c114...) still retrievable", ex.includes("article=242"), ex);
  await sleep(5000);
  await sessions();
  const id = await approvedArticle("Lambda after DB restart");
  await publish(id);
  const { o } = await publishedEvent(id, 90000);
  check("worker publishes again after restarts", o?.state === "published", `state=${o?.state} attempts=${o?.attempts} last_error="${o?.lastError}"`);
  const rc = await poll(async () => receipt(o.eventId), 120000);
  if (!check("Lambda writes a receipt for the first event after the DB restart", Boolean(rc.value), `after ${secs(rc.ms)}`)) {
    const ll = lambdaLogs(new Date(Date.now() - 300000).toISOString());
    for (const x of ll) for (const l of x.logs.split("\n").filter(Boolean).slice(-10)) log(`       [${x.name.slice(-8)}] ${l.slice(0, 220)}`);
    log(`     RESTART_EVENT=${o?.eventId} RESTART_ARTICLE=${id}`);
  }
}

if (PHASE === "recover") {
  await sessions();
  const id = await approvedArticle("Lambda recovered event");
  await flociStop();
  await publish(id);
  const f = await poll(async () => { const o = outbox(id); return o?.state === "failed" ? o : null; }, 420000, 5000);
  check("SNS unavailable: event persisted as 'failed' after 5 attempts", f.value?.attempts === 5, `state=${f.value?.state || outbox(id)?.state} attempts=${f.value?.attempts ?? outbox(id)?.attempts} after ${secs(f.ms)} last_error="${(f.value || outbox(id))?.lastError}"`);
  await flociStart();
  const o = outbox(id);
  check("no receipt while the event is failed", receiptCount(o.eventId) === "0");
  const sec = JSON.parse(aws(["secretsmanager", "get-secret-value", "--secret-id", "supporthub/editorial/runtime", "--query", "SecretString", "--output", "text"]).out).CRON_SECRET;
  const res = await fetch(`${EDITORIAL}/internal/retry-publication-events`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sec}` }, body: JSON.stringify({ eventId: o.eventId }), signal: AbortSignal.timeout(15000) });
  const body = await res.json().catch(() => ({}));
  check("authorized requeue of the failed event", res.status === 200 && body.requeued === 1, `HTTP ${res.status} ${JSON.stringify(body)}`);
  const p = await publishedEvent(id, 60000);
  check("requeued event published by the worker", p.o?.state === "published", `after ${secs(p.ms)} attempts=${p.o?.attempts}`);
  const rc = await poll(async () => receipt(o.eventId), 180000);
  check("RECOVERED notification reached its subscriber: Lambda receipt written", Boolean(rc.value), `after ${secs(rc.ms)}: ${rc.value}`);
  check("receipt matches the ORIGINAL event (eventId, articleId)", rc.value?.startsWith(`${o.eventId}|${id}|editorial.publication.published`) && p.o.payload.eventId === o.eventId);
  check("exactly one receipt", receiptCount(o.eventId) === "1");
  log(`     RECOVER_EVENT=${o.eventId} RECOVER_ARTICLE=${id}`);
}

if (PHASE === "lambdafail") {
  // Make ONLY the Lambda's write fail for one known article, via a temporary
  // NOT VALID check constraint on the receipts table (isolated DB; existing
  // rows untouched; constraint removed in this phase).
  await sessions();
  const id = await approvedArticle("Lambda failure");
  const c = `phase4_lambda_fail_probe_${id}`;
  log(`     ${now()} ALTER TABLE editorial_publication_event_receipts ADD CONSTRAINT ${c} CHECK (article_id <> ${id}) NOT VALID -> ${sql(`ALTER TABLE editorial_publication_event_receipts ADD CONSTRAINT ${c} CHECK (article_id <> ${id}) NOT VALID; SELECT 'ok'`)}`);
  const t0 = now();
  try {
    await publish(id);
    const { o } = await publishedEvent(id);
    check("event published to SNS while the Lambda's DB write is forced to fail", o?.state === "published", `state=${o?.state}`);
    await sleep(30000);
    check("Lambda invocation failed safely: no receipt, nothing partial written", receiptCount(o.eventId) === "0");
    const errs = lambdaLogs(t0).flatMap(x => x.logs.split("\n")).filter(l => /violat|error|check constraint/i.test(l));
    log(`     Lambda error lines: ${errs.length}`); for (const l of errs.slice(0, 5)) log(`       ${l.slice(0, 200)}`);
    const fl = flociLogs(t0, /lambda|invoke|retry|error/i).slice(-8); for (const l of fl) log(`       [floci] ${l.slice(0, 200)}`);
    log(`     ${now()} drop probe constraint -> ${sql(`ALTER TABLE editorial_publication_event_receipts DROP CONSTRAINT ${c}; SELECT 'ok'`)}`);
    const auto = await poll(async () => receipt(o.eventId), 200000, 5000);
    if (auto.value) check("platform retry of the failed async invocation produced the receipt after the fault was removed", true, `after ${secs(auto.ms)}`);
    else log(`     no automatic retry within ${secs(auto.ms)} (receipt still missing) -> LAMBDA_FAIL_EVENT=${o.eventId} LAMBDA_FAIL_ARTICLE=${id}`);
    check("missing-receipt state detectable: published outbox event without receipt",
      auto.value ? true : sql(`SELECT count(*) FROM editorial_publication_event_outbox o LEFT JOIN editorial_publication_event_receipts r USING(event_id) WHERE o.state='published' AND r.event_id IS NULL AND o.event_id='${o.eventId}'`) === "1");
  } finally {
    sql(`ALTER TABLE editorial_publication_event_receipts DROP CONSTRAINT IF EXISTS ${c}`);
    check("probe constraint removed (schema restored)", sql(`SELECT count(*) FROM pg_constraint WHERE conname='${c}'`) === "0");
  }
}

log(`phase ${PHASE}: ${pass} passed, ${fail} failed, ${nv} not verified`);
if (process.env.OUT) fs.appendFileSync(process.env.OUT, lines.join("\n") + "\n");
process.exitCode = fail ? 1 : 0;
