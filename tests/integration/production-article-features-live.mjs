// SupportHub Group 12 - LIVE production check of the Article backup fix and features A, B, C.
//
//   OUT=evidence/.../10-article-features-live.json node tests/integration/production-article-features-live.mjs
//
// All calls go through the public Cloudflare Pages site (Pages Function -> Article API on Vercel ->
// Cloudflare Worker gateway -> tunnel -> production Floci). AWS-side confirmation is READ-ONLY
// (S3 list/get and CloudWatch get-metric-statistics on Floci; READ ONLY Neon transaction with the
// restricted Article role).
// Account: Alyaa's dedicated author test account (%LOCALAPPDATA%\SupportHub\remote\e2e-accounts.env).
// No credential, cookie, token or connection string is printed; the e-mail is masked.
// Production writes: an S3 backup of article 23's latest version, and two labelled verification
// DRAFTS (one restored from its S3 backup, one refused for submission with 422). Nothing is submitted,
// approved or published.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const P = "https://supporthub-group12.pages.dev";
const LAD = process.env.LOCALAPPDATA || "";
const ARTICLE_23 = Number(process.env.BACKUP_ARTICLE || 23);
const acc = Object.fromEntries([...fs.readFileSync(path.join(LAD, "SupportHub/remote/e2e-accounts.env"), "utf8")
  .replace(/^﻿/, "").matchAll(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/gm)].map(m => [m[1], m[2].replace(/^["']|["']$/g, "")]));
const mask = e => String(e).replace(/^(.{2}).*(@.*)$/, "$1***$2");

const rows = []; let pass = 0, fail = 0;
const now = () => new Date().toISOString();
const short = v => (typeof v === "string" ? v : JSON.stringify(v ?? "")).slice(0, 140);
function record(feature, operation, endpoint, http, detail, ok) {
  ok ? pass++ : fail++;
  const r = { time: now(), feature, operation, endpoint, http, detail, result: ok ? "PASS" : "FAIL" };
  rows.push(r); console.log(`${r.result} | ${feature} | ${operation} | ${endpoint} -> ${http} | ${detail}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Session {
  constructor() { this.jar = new Map(); this.csrf = null; }
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
  async token() { if (!this.csrf) this.csrf = (await this.req("GET", "/auth/csrf")).data?.csrfToken; return this.csrf; }
  async write(method, p, body) { return this.req(method, p, body, { "X-CSRF-Token": await this.token() }); }
  async login(email, password) {
    const r = await this.req("POST", "/auth/login", { email, password }, { "X-CSRF-Token": await this.token() });
    if (r.data?.csrfToken) this.csrf = r.data.csrfToken;
    return r;
  }
}

function floci(...args) {
  const out = execFileSync("aws", ["--endpoint-url", "http://127.0.0.1:4566", "--region", "us-east-1", ...args, "--output", "json"],
    { env: { ...process.env, AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test", AWS_PAGER: "", MSYS_NO_PATHCONV: "1" }, timeout: 30000, encoding: "utf8" });
  return out.trim() ? JSON.parse(out) : {};
}
const requirePg = createRequire(path.join(ROOT, "services/search-analytics-service/package.json"));
const { Client } = requirePg("pg");
async function db(sql, params = []) {
  if (!/^\s*SELECT\b/i.test(sql) || sql.includes(";")) throw new Error("read-only SELECT only");
  const url = fs.readFileSync(path.join(LAD, "SupportHub/database-security/article.database.env"), "utf8").match(/^DATABASE_URL_POOLED=(.+)$/m)[1].trim().replace(/^["']|["']$/g, "");
  const c = new Client({ connectionString: url, options: "-c default_transaction_read_only=on", connectionTimeoutMillis: 15000, query_timeout: 20000 });
  await c.connect();
  try { await c.query("BEGIN READ ONLY"); const r = await c.query(sql, params); await c.query("ROLLBACK"); return r.rows; } finally { await c.end(); }
}
const METRICS = ["ArticlesCreated", "ArticlesSubmitted", "BackupsExported", "BackupFailures"];
const T0 = new Date(Date.now() - 5 * 60000).toISOString();
function sums() {
  const out = {};
  for (const m of METRICS) {
    const d = floci("cloudwatch", "get-metric-statistics", "--namespace", "SupportHub/Article", "--metric-name", m,
      "--start-time", T0, "--end-time", new Date(Date.now() + 120000).toISOString(), "--period", "60", "--statistics", "Sum").Datapoints || [];
    out[m] = d.reduce((a, x) => a + (x.Sum || 0), 0);
  }
  return out;
}
const s3Key = (a, v) => (floci("s3api", "list-objects-v2", "--bucket", "supporthub-article-backups", "--prefix", `articles/${a}/versions/${v}`).Contents || [])[0];
const versionsOf = async (s, id) => { const r = await s.req("GET", `/articles/${id}/versions`); return Array.isArray(r.data) ? r.data : (r.data?.versions || []); };
const vId = v => Number(v?.id ?? v?.version_id ?? v?.versionId);

console.log(`Article features live check ${now()} via ${P} (author ${mask(acc.AUTHOR_EMAIL)})`);
const before = sums();
console.log(`SupportHub/Article metrics since ${T0}, before: ${JSON.stringify(before)}`);

const author = new Session();
let r = await author.login(acc.AUTHOR_EMAIL, acc.AUTHOR_PASSWORD);
if (r.status !== 200) { console.log(`author login failed: HTTP ${r.status}`); process.exit(2); }
const term = "featlive" + Date.now().toString(36);

// ---------------------------------------------------------------- 1) backup fix: article 23
const v23 = vId((await versionsOf(author, ARTICLE_23))[0]);
const bk = await author.write("POST", `/articles/${ARTICLE_23}/versions/${v23}/export`);
const o23 = s3Key(ARTICLE_23, v23);
record("Backup fix", "S3 backup export (Secrets Manager read + PutObject)", `POST /api/articles/${ARTICLE_23}/versions/${v23}/export`, bk.status,
  o23 ? `s3://supporthub-article-backups/${o23.Key} ${o23.Size} B ${o23.LastModified}` : short(bk.data), bk.status === 200 && !!o23);
const back = await author.req("GET", `/articles/${ARTICLE_23}/versions/${v23}/export`);
record("Backup fix", "S3 backup read-back (GetObject)", `GET /api/articles/${ARTICLE_23}/versions/${v23}/export`, back.status,
  back.status === 200 ? `articleId=${back.data?.backup?.articleId ?? back.data?.articleId ?? "?"} versionId=${back.data?.backup?.versionId ?? back.data?.versionId ?? "?"}` : short(back.data), back.status === 200);

// ---------------------------------------------------------------- 2) feature A: restore a draft from its S3 backup
const cats = await author.req("GET", "/categories");
const categoryId = Number((Array.isArray(cats.data) ? cats.data : (cats.data?.categories || []))[0]?.id);
const original = `Live feature A verification (${term}) by Alyaa's test account: this is the ORIGINAL content saved to the S3 version backup before the draft is edited and restored.`;
r = await author.write("POST", "/articles", { title: `Live feature A restore ${term}`, categoryId, content: original });
const aId = Number(r.data?.article?.id);
record("A", "create verification draft", "POST /api/articles", r.status, `article ${aId}`, r.status === 201 && !!aId);
const aV = vId((await versionsOf(author, aId))[0]);
r = await author.write("POST", `/articles/${aId}/versions/${aV}/export`);
record("A", "back up version to S3", `POST /api/articles/${aId}/versions/${aV}/export`, r.status, short(r.data?.key ?? r.data), r.status === 200);
r = await author.write("PATCH", `/articles/${aId}`, { title: `Live feature A restore ${term} (edited)`, categoryId, content: `EDITED content for ${term} that must be replaced by the S3 backup when the draft is restored.` });
record("A", "edit the draft after the backup", `PATCH /api/articles/${aId}`, r.status, short(r.data?.article?.title ?? r.data), r.status === 200);
r = await author.write("POST", `/articles/${aId}/versions/${aV}/restore-backup`);
const restoredFrom = r.data?.restoredFrom;
record("A", "restore draft from S3 backup", `POST /api/articles/${aId}/versions/${aV}/restore-backup`, r.status, `restoredFrom=${restoredFrom ?? short(r.data)}`, r.status === 200 && /articles\/\d+\/versions\/\d+/.test(String(restoredFrom)));
const [row] = await db("SELECT title, content, status FROM articles WHERE id = $1", [aId]);
record("A", "Neon: draft content equals the backed-up version", "(read-only SELECT, article role)", "-",
  `status=${row?.status} title="${row?.title}"`, row?.content === original && row?.title === `Live feature A restore ${term}` && row?.status === "draft");
const audit = await db("SELECT count(*)::int n FROM article_versions WHERE article_id = $1", [aId]).catch(() => null);
if (audit) console.log(`info | A | article ${aId} now has ${audit[0].n} versions (create, edit, restore)`);

// ---------------------------------------------------------------- 3) feature C: submission quality rules
r = await author.write("POST", "/articles", { title: `Live feature C short ${term}`, categoryId, content: "Too short to review." });
const cId = Number(r.data?.article?.id);
record("C", "create short verification draft", "POST /api/articles", r.status, `article ${cId}`, r.status === 201 && !!cId);
r = await author.write("POST", `/articles/${cId}/submit`);
record("C", "submit a too-short draft -> 422 with issues", `POST /api/articles/${cId}/submit`, r.status, short(r.data),
  r.status === 422 && Array.isArray(r.data?.issues) && r.data.issues.some(i => /at least 100 characters/.test(i)));
const [crow] = await db("SELECT status FROM articles WHERE id = $1", [cId]);
const [cout] = await db("SELECT count(*)::int n FROM article_event_outbox WHERE article_id = $1", [cId]);
record("C", "Neon: still draft, no outbox event", "(read-only SELECT, article role)", "-", `status=${crow?.status} outbox_events=${cout?.n}`, crow?.status === "draft" && cout?.n === 0);

// ---------------------------------------------------------------- 4) feature B: CloudWatch metrics (flushed before each response on Vercel)
await sleep(3000);
let after = sums();
for (let i = 0; i < 5 && (after.ArticlesCreated - before.ArticlesCreated < 2 || after.BackupsExported - before.BackupsExported < 2); i++) { await sleep(3000); after = sums(); }
const diff = Object.fromEntries(METRICS.map(k => [k, after[k] - before[k]]));
console.log(`SupportHub/Article metrics after: ${JSON.stringify(after)} diff ${JSON.stringify(diff)}`);
record("B", "ArticlesCreated +2 (drafts A and C)", "cloudwatch get-metric-statistics SupportHub/Article", "-", `+${diff.ArticlesCreated}`, diff.ArticlesCreated === 2);
record("B", "BackupsExported +2 (article 23 and draft A)", "cloudwatch get-metric-statistics SupportHub/Article", "-", `+${diff.BackupsExported}`, diff.BackupsExported === 2);
record("B", "ArticlesSubmitted +0 (the 422 is not counted)", "cloudwatch get-metric-statistics SupportHub/Article", "-", `+${diff.ArticlesSubmitted}`, diff.ArticlesSubmitted === 0);
record("B", "BackupFailures +0", "cloudwatch get-metric-statistics SupportHub/Article", "-", `+${diff.BackupFailures}`, diff.BackupFailures === 0);

console.log(`Total: ${pass} passed, ${fail} failed. Verification drafts left in place: ${aId}, ${cId} (labelled ${term}).`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ at: now(), via: P, term, article23: { id: ARTICLE_23, version: v23 }, drafts: { A: aId, C: cId }, metricsBefore: before, metricsAfter: after, rows, pass, fail }, null, 2));
process.exitCode = fail ? 1 : 0;
