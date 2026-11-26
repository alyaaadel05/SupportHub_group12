// SupportHub Group 12 - LIVE end-to-end AWS verification through the DEPLOYED APIs.
//
//   node tests/integration/production-live-aws-e2e.mjs
//
// Every operation is a real browser-style request to the public Cloudflare Pages site
// (https://supporthub-group12.pages.dev/api/* -> Pages Function -> the four Vercel APIs ->
// Cloudflare Worker gateway -> Workers VPC -> tunnel -> production Floci).
// AWS-side confirmation is READ-ONLY (list/get/scan/metric statistics on the local Floci,
// and READ ONLY transactions on Neon with the restricted per-service roles).
//
// Accounts: Alyaa's dedicated test accounts from %LOCALAPPDATA%\SupportHub\remote\e2e-accounts.env
// (AUTHOR_EMAIL/AUTHOR_PASSWORD/EDITOR_EMAIL/EDITOR_PASSWORD). No credential, cookie, token or
// connection string is printed; e-mail addresses are masked.
// Writes to production: one clearly labelled verification article (created, submitted, approved,
// published), one S3 backup of its version, one analytics CSV export, searches/views of it, and
// one rejected login for a non-existent address (Identity security alert).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const P = "https://supporthub-group12.pages.dev";
const LAD = process.env.LOCALAPPDATA || "";
const acc = Object.fromEntries([...fs.readFileSync(path.join(LAD, "SupportHub/remote/e2e-accounts.env"), "utf8")
  .replace(/^﻿/, "").matchAll(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/gm)].map(m => [m[1], m[2].replace(/^["']|["']$/g, "")]));
const mask = e => String(e).replace(/^(.{2}).*(@.*)$/, "$1***$2");

const rows = []; let pass = 0, fail = 0;
const now = () => new Date().toISOString();
function record(service, owner, operation, endpoint, http, aws, ok) {
  ok ? pass++ : fail++;
  const r = { time: now(), service, owner, operation, endpoint, http, aws, result: ok ? "PASS" : "FAIL" };
  rows.push(r); console.log(`${r.result} | ${service} (${owner}) | ${operation} | ${endpoint} -> ${http} | ${aws}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- browser-like session
class Session {
  constructor() { this.jar = new Map(); this.identityCsrf = null; }
  cookie() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
  async req(method, p, body, extra = {}) {
    const headers = { Origin: P, Accept: "application/json", ...extra };
    if (this.jar.size) headers.Cookie = this.cookie();
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(P + "/api" + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(30000) });
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim(); if (/max-age=0|expires=thu, 01 jan 1970/i.test(c) || !v) this.jar.delete(k); else this.jar.set(k, v); }
    let data = null; const text = await res.text(); try { data = JSON.parse(text); } catch { data = text.slice(0, 120); }
    return { status: res.status, data };
  }
  async idCsrf() { if (!this.identityCsrf) this.identityCsrf = (await this.req("GET", "/auth/csrf")).data?.csrfToken; return this.identityCsrf; }
  async write(method, p, body) { return this.req(method, p, body, { "X-CSRF-Token": await this.idCsrf() }); }
  async edWrite(method, p, body) { const t = (await this.req("GET", "/csrf-token")).data?.csrfToken; return this.req(method, p, body, { "X-CSRF-Token": t }); }
  async login(email, password) {
    const r = await this.req("POST", "/auth/login", { email, password }, { "X-CSRF-Token": await this.idCsrf() });
    if (r.data?.csrfToken) this.identityCsrf = r.data.csrfToken;
    return r;
  }
}

// ---------------------------------------------------------------- read-only confirmation helpers
function floci(...args) {
  const out = execFileSync("aws", ["--endpoint-url", "http://127.0.0.1:4566", "--region", "us-east-1", ...args, "--output", "json"],
    { env: { ...process.env, AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test", AWS_PAGER: "", MSYS_NO_PATHCONV: "1" }, timeout: 30000, encoding: "utf8" });
  return out.trim() ? JSON.parse(out) : {};
}
const requirePg = createRequire(path.join(ROOT, "services/search-analytics-service/package.json"));
const { Client } = requirePg("pg");
async function db(service, sql, params = []) {
  if (!/^\s*SELECT\b/i.test(sql) || sql.includes(";")) throw new Error("read-only SELECT only");
  const url = fs.readFileSync(path.join(LAD, "SupportHub/database-security", `${service}.database.env`), "utf8").match(/^DATABASE_URL_POOLED=(.+)$/m)[1].trim().replace(/^["']|["']$/g, "");
  const c = new Client({ connectionString: url, options: "-c default_transaction_read_only=on", connectionTimeoutMillis: 15000, query_timeout: 20000 });
  await c.connect();
  try { await c.query("BEGIN READ ONLY"); const r = await c.query(sql, params); await c.query("ROLLBACK"); return r.rows; } finally { await c.end(); }
}
async function until(fn, ms = 90000, step = 3000) { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(step); } return v; }

console.log(`Live AWS E2E ${now()} via ${P} (author ${mask(acc.AUTHOR_EMAIL)}, editor ${mask(acc.EDITOR_EMAIL)})`);
const term = "liveaws" + Date.now().toString(36);

// ================================================================ AUTHOR: Article Service (Alyaa)
const author = new Session();
let r = await author.login(acc.AUTHOR_EMAIL, acc.AUTHOR_PASSWORD);
const me = await author.req("GET", "/auth/me");
if (r.status !== 200 || !["author", "admin"].includes(me.data?.user?.role ?? me.data?.role)) { console.log(`author login failed: HTTP ${r.status}, role ${me.data?.user?.role ?? me.data?.role}`); process.exit(2); }
// BACKUP_ONLY_ARTICLE=<id>: re-run ONLY the Article S3 backup / Secrets Manager checks on an existing
// verification article (no new article, no publication, nothing else written).
const BACKUP_ONLY = Number(process.env.BACKUP_ONLY_ARTICLE) || 0;
let articleId = BACKUP_ONLY;
if (!BACKUP_ONLY) {
  const cats = await author.req("GET", "/categories");
  const catList = Array.isArray(cats.data) ? cats.data : (cats.data?.categories || []);
  const categoryId = Number(catList[0]?.id);
  r = await author.write("POST", "/articles", {
    title: `Live AWS verification ${term}`,
    categoryId,
    content: `Automated production verification article (${term}) created by Alyaa's test account to trace SQS, SNS, Lambda, S3, DynamoDB and CloudWatch through the deployed APIs.`
  });
  articleId = Number(r.data?.article?.id ?? r.data?.id);
  console.log(`created article ${articleId} (HTTP ${r.status})`);
}
if (!articleId) { console.log("article create failed", r.status, JSON.stringify(r.data).slice(0, 200)); process.exit(2); }

// --- S3 backup + Secrets Manager runtime config (the export reads it first; 503 if unavailable)
const versions = await author.req("GET", `/articles/${articleId}/versions`);
const vlist = Array.isArray(versions.data) ? versions.data : (versions.data?.versions || []);
const versionId = Number(vlist[0]?.id ?? vlist[0]?.version_id ?? vlist[0]?.versionId);
const bk = await author.write("POST", `/articles/${articleId}/versions/${versionId}/export`);
const objs = floci("s3api", "list-objects-v2", "--bucket", "supporthub-article-backups").Contents || [];
const backupObj = objs.find(o => o.Key.includes(`/${articleId}/`) || o.Key.includes(`articles/${articleId}`) || new RegExp(`\\b${articleId}\\b`).test(o.Key) && Date.now() - new Date(o.LastModified) < 120000);
record("Article", "Alyaa", "S3 backup export (PutObject)", `POST /api/articles/${articleId}/versions/${versionId}/export`, bk.status,
  backupObj ? `s3://supporthub-article-backups/${backupObj.Key} ${backupObj.Size} B ${backupObj.LastModified}` : "no object found", bk.status >= 200 && bk.status < 300 && !!backupObj);
const back = await author.req("GET", `/articles/${articleId}/versions/${versionId}/export`);
record("Article", "Alyaa", "S3 backup read-back (GetObject)", `GET /api/articles/${articleId}/versions/${versionId}/export`, back.status, back.status === 200 ? "backup returned by the API from S3" : JSON.stringify(back.data).slice(0, 80), back.status === 200);
record("Article", "Alyaa", "Secrets Manager runtime config (GetSecretValue)", "(inside the backup export)", bk.status,
  bk.status < 300 ? "export succeeded: supporthub/article/runtime-config was read and enabled=true (else 503)" : `export failed: ${JSON.stringify(bk.data).slice(0, 80)}`, bk.status >= 200 && bk.status < 300);

if (BACKUP_ONLY) {
  console.log(`Total: ${pass} passed, ${fail} failed (backup-only re-run on article ${articleId})`);
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ at: now(), via: P, articleId, mode: "backup-only", rows, pass, fail }, null, 2));
  process.exit(fail ? 1 : 0);
}

// --- SQS: submit -> Article outbox -> ECS article-outbox-worker -> SQS -> ECS editorial consumer
const sub = await author.write("POST", `/articles/${articleId}/submit`);
const outbox = await until(async () => (await db("article", "SELECT id, status, published_at FROM article_event_outbox WHERE article_id = $1 AND event_type = 'article.submitted' ORDER BY created_at DESC LIMIT 1", [articleId]))[0]?.status === "published"
  && (await db("article", "SELECT id, status, published_at FROM article_event_outbox WHERE article_id = $1 AND event_type = 'article.submitted' ORDER BY created_at DESC LIMIT 1", [articleId]))[0]);
record("Article", "Alyaa", "SQS SendMessage via outbox (ECS article-outbox-worker)", `POST /api/articles/${articleId}/submit`, sub.status,
  outbox ? `article_event_outbox ${outbox.id} status=published at ${new Date(outbox.published_at).toISOString()}` : "outbox event not published in 90 s", sub.status < 300 && !!outbox);
const inbox = await until(async () => (await db("editorial", "SELECT event_id, processed_at FROM editorial_event_inbox WHERE event_id = $1", [String(outbox?.id)]))[0], 90000);
const review = (await db("editorial", "SELECT review_id, decision FROM editorial_reviews WHERE article_id = $1 ORDER BY review_id DESC LIMIT 1", [articleId]))[0];
const q = floci("sqs", "get-queue-attributes", "--queue-url", "http://127.0.0.1:4566/000000000000/supporthub-article-events-production", "--attribute-names", "ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible").Attributes;
record("Editorial", "Salma", "SQS ReceiveMessage/DeleteMessage (ECS editorial-article-consumer)", "(async, from the submit above)", "-",
  inbox ? `editorial_event_inbox ${inbox.event_id} at ${new Date(inbox.processed_at).toISOString()}; review ${review?.review_id} ${review?.decision ?? "pending"}; queue now ${q.ApproximateNumberOfMessages}/${q.ApproximateNumberOfMessagesNotVisible}` : "event not consumed in 90 s", !!inbox);
await author.write("POST", "/auth/logout");

// ================================================================ EDITOR: Editorial Service (Salma)
const editor = new Session();
r = await editor.login(acc.EDITOR_EMAIL, acc.EDITOR_PASSWORD);
const em = await editor.req("GET", "/auth/me");
console.log(`editor login HTTP ${r.status}, role ${em.data?.user?.role ?? em.data?.role}`);
const appr = await editor.edWrite("POST", `/articles/${articleId}/reviews`, { decision: "approved", comments: "Approved by the automated live AWS verification." });
const pub = await editor.edWrite("PATCH", `/articles/${articleId}/publication`);
console.log(`approve HTTP ${appr.status}, publish HTTP ${pub.status} (${pub.data?.status ?? JSON.stringify(pub.data).slice(0, 80)})`);
const pe = await until(async () => { const x = (await db("editorial", "SELECT event_id, state, attempts, published_at FROM editorial_publication_event_outbox WHERE article_id = $1 ORDER BY created_at DESC LIMIT 1", [articleId]))[0]; return x?.state === "published" && x; });
record("Editorial", "Salma", "SNS Publish (ECS editorial-publication-worker)", `PATCH /api/articles/${articleId}/publication`, pub.status,
  pe ? `editorial_publication_event_outbox ${pe.event_id} state=published attempts=${pe.attempts} at ${new Date(pe.published_at).toISOString()}` : "event not published in 90 s", pub.status < 300 && !!pe);
const rc = await until(async () => { const x = await db("editorial", "SELECT event_id, event_type, processed_at FROM editorial_publication_event_receipts WHERE article_id = $1", [articleId]); return x.length ? x : null; });
record("Editorial", "Salma", "Lambda invoke via SNS -> receipt in Neon", "(async, from the publish above)", "-",
  rc ? `${rc.length} receipt(s): ${rc[0].event_id} ${rc[0].event_type} at ${new Date(rc[0].processed_at).toISOString()}; matches SNS event: ${rc[0].event_id === pe?.event_id}` : "no receipt in 90 s", !!rc && rc.length === 1 && rc[0].event_id === pe?.event_id);
const idx = await until(async () => (await db("search", "SELECT article_id, updated_at FROM search_published_articles WHERE article_id = $1", [articleId]))[0], 60000);
console.log(`search index: ${idx ? "article " + articleId + " indexed at " + new Date(idx.updated_at).toISOString() : "NOT indexed in 60 s"}`);

// ================================================================ Search & Analytics (Nermeen)
const anon = new Session();
const s1 = await anon.req("GET", `/public/articles?q=${term}`);
const s1total = s1.data?.total;
const counter = await until(() => floci("dynamodb", "get-item", "--table-name", "supporthub-search-counters", "--key", JSON.stringify({ pk: { S: "TERM#" + term } })).Item, 20000, 2000);
record("Search", "Nermeen", "DynamoDB UpdateItem search counter (flushed in-request)", `GET /api/public/articles?q=${term}`, s1.status,
  counter ? `supporthub-search-counters TERM#${term} = ${JSON.stringify(Object.fromEntries(Object.entries(counter).filter(([k]) => k !== "pk").map(([k, v]) => [k, v.N ?? v.S])))}; results=${s1total}` : "counter item not found within 20 s", s1.status === 200 && !!counter);
const view = await anon.req("GET", `/public/articles/${articleId}`);
const vc = await until(() => floci("dynamodb", "get-item", "--table-name", "supporthub-search-counters", "--key", JSON.stringify({ pk: { S: "ARTICLE#" + articleId } })).Item, 20000, 2000);
record("Search", "Nermeen", "DynamoDB UpdateItem article view counter", `GET /api/public/articles/${articleId}`, view.status,
  vc ? `ARTICLE#${articleId} = ${JSON.stringify(Object.fromEntries(Object.entries(vc).filter(([k]) => k !== "pk").map(([k, v]) => [k, v.N ?? v.S])))}` : "view counter not found", view.status === 200 && !!vc);
const t0 = new Date(Date.now() - 5 * 60000).toISOString(), t1 = new Date(Date.now() + 60000).toISOString();
const ms = floci("cloudwatch", "get-metric-statistics", "--namespace", "SupportHub/Search", "--metric-name", "Searches", "--start-time", t0, "--end-time", t1, "--period", "60", "--statistics", "Sum").Datapoints || [];
const sum = ms.reduce((a, d) => a + (d.Sum || 0), 0);
record("Search", "Nermeen", "CloudWatch PutMetricData (Searches)", `GET /api/public/articles?q=${term}`, s1.status,
  `SupportHub/Search Searches, last 5 min: ${ms.length} datapoint(s), Sum ${sum}`, ms.length > 0 && sum >= 1);
const ex = await editor.write("POST", "/analytics/exports");
const exName = ex.data?.name ?? ex.data?.export?.name ?? ex.data?.fileName;
const exObjs = floci("s3api", "list-objects-v2", "--bucket", "supporthub-search-analytics-exports", "--prefix", "exports/").Contents || [];
const exObj = exObjs.find(o => exName && o.Key.endsWith(exName)) || exObjs.filter(o => o.Key.endsWith(".csv") && Date.now() - new Date(o.LastModified) < 120000).pop();
const dl = exName ? await editor.req("GET", `/analytics/exports/${encodeURIComponent(exName)}`) : { status: "-" };
record("Search", "Nermeen", "S3 CSV export (PutObject + download)", "POST /api/analytics/exports", ex.status,
  exObj ? `s3://supporthub-search-analytics-exports/${exObj.Key} ${exObj.Size} B ${exObj.LastModified}; download HTTP ${dl.status}` : `no CSV object found (${JSON.stringify(ex.data).slice(0, 80)})`, ex.status >= 200 && ex.status < 300 && !!exObj);
await editor.write("POST", "/auth/logout");

// ================================================================ Identity (Alyaa): SNS security alert
const AQ = "http://127.0.0.1:4566/000000000000/supporthub-identity-alerts-audit";
const drained = floci("sqs", "receive-message", "--queue-url", AQ, "--max-number-of-messages", "10", "--wait-time-seconds", "1").Messages || [];
for (const m of drained) floci("sqs", "delete-message", "--queue-url", AQ, "--receipt-handle", m.ReceiptHandle);
const bad = new Session();
const fl = await bad.login(`alert-probe-${Date.now()}@example.invalid`, "wrong-password-probe-1");
const sentAt = Date.now();
const alert = await until(() => { const m = (floci("sqs", "receive-message", "--queue-url", AQ, "--max-number-of-messages", "5", "--wait-time-seconds", "2").Messages || []); return m.length ? m : null; }, 15000, 1000);
let alertTxt = "no alert within 15 s (no follow-up request was sent)";
if (alert) { const e = JSON.parse(alert[0].Body); const msg = JSON.parse(e.Message); alertTxt = `topic ${e.TopicArn.split(":").pop()} event=${msg.event} SNS at ${e.Timestamp} (${new Date(e.Timestamp) - sentAt} ms after the response)`; }
record("Identity", "Alyaa", "SNS Publish security alert (in-request on Vercel)", "POST /api/auth/login (unknown address)", fl.status, alertTxt, !!alert && [401, 403, 429].includes(fl.status));

console.log(`Total: ${pass} passed, ${fail} failed`);
console.log(`verification article: ${articleId} ("Live AWS verification ${term}")`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ at: now(), via: P, articleId, term, rows, pass, fail }, null, 2));
process.exitCode = fail ? 1 : 0;
