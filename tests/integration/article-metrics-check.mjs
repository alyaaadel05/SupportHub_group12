// SupportHub Group 12 - Article feature B: CloudWatch metrics through the real Article API.
//
// ISOLATED stack only: login through the isolated proxy (sessions live in the isolated Postgres),
// Article calls go to ARTICLE_URL - a temporary Article container built from the current source with
// CLOUDWATCH_NAMESPACE=SupportHub/Article and VERCEL=1 (flush before the response). Metrics are read
// back from the isolated Floci. Never production.
//
//   ARTICLE_URL=http://127.0.0.1:3299 node tests/integration/article-metrics-check.mjs

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROXY = "http://localhost:8188";
const ARTICLE = (process.env.ARTICLE_URL || "http://127.0.0.1:3299").replace(/\/$/, "");
const FLOCI = "http://localhost:4567";
const DB = "supporthub-iso-postgres";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(ARTICLE)) throw new Error("Refusing: local isolated Article only");
const PASSWORD = fs.readFileSync(path.join(ROOT, "infra/floci/.generated/isolated/demo-accounts.txt"), "utf8").match(/^password=(.+)$/m)[1].trim();
const lines = []; let pass = 0, fail = 0;
const log = t => { lines.push(t); console.log(t); };
const check = (n, ok, d = "") => { ok ? pass++ : fail++; log(`${ok ? "PASS" : "FAIL"} | ${n}${d ? " | " + d : ""}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sql = q => execFileSync("docker", ["exec", DB, "psql", "-U", "supporthub", "-d", "supporthub", "-tAc", q], { encoding: "utf8" }).trim();
const aws = (...a) => JSON.parse(execFileSync("aws", ["--endpoint-url", FLOCI, "--region", "us-east-1", ...a, "--output", "json"],
  { env: { ...process.env, AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test", AWS_PAGER: "", MSYS_NO_PATHCONV: "1" }, encoding: "utf8", timeout: 30000 }) || "{}");

class Client {
  constructor() { this.cookie = ""; this.csrf = null; }
  async raw(base, method, url, body, extra = {}) {
    const h = { Accept: "application/json", Origin: PROXY, ...extra };
    if (this.cookie) h.Cookie = this.cookie;
    if (body !== undefined) h["Content-Type"] = "application/json";
    const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() || []) if (c.startsWith("supporthub.sid=")) this.cookie = c.split(";")[0];
    let data = {}; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }
  async req(base, method, url, body) {
    if (!["GET", "HEAD"].includes(method) && !this.csrf) this.csrf = (await this.raw(PROXY, "GET", "/api/auth/csrf")).data.csrfToken;
    return this.raw(base, method, url, body, ["GET", "HEAD"].includes(method) ? {} : { "X-CSRF-Token": this.csrf });
  }
  async login(email) { const r = await this.req(PROXY, "POST", "/api/auth/login", { email, password: PASSWORD }); if (r.data.csrfToken) this.csrf = r.data.csrfToken; return r; }
}

const start = new Date(Date.now() - 60000).toISOString();
function sums() {
  const out = {};
  for (const m of ["ArticlesCreated", "ArticlesSubmitted", "BackupsExported", "BackupFailures"]) {
    const d = aws("cloudwatch", "get-metric-statistics", "--namespace", "SupportHub/Article", "--metric-name", m,
      "--start-time", start, "--end-time", new Date(Date.now() + 120000).toISOString(), "--period", "3600", "--statistics", "Sum").Datapoints || [];
    out[m] = d.reduce((a, x) => a + (x.Sum || 0), 0);
  }
  return out;
}
const RC = "supporthub/article/runtime-config";
const setBackups = enabled => aws("secretsmanager", "put-secret-value", "--secret-id", RC, "--secret-string", JSON.stringify({ feature: "article-backup", enabled }));

log(`Article metrics check ${new Date().toISOString()} - temporary Article ${ARTICLE}, isolated Floci ${FLOCI}`);
const before = sums();
log(`metrics before: ${JSON.stringify(before)}`);
const author = new Client(), author2 = new Client();
check("author login (isolated proxy)", (await author.login("author@supporthub.test")).status === 200);
check("author2 login", (await author2.login("author2@supporthub.test")).status === 200);
const cat = Number(sql("SELECT id FROM categories ORDER BY id LIMIT 1"));
const long = "Metrics check article with enough detail: open settings, follow each step, restart the device and contact support if it continues.";

let r = await author.req(ARTICLE, "POST", "/api/articles", { title: `Metrics check ${Date.now()}`, categoryId: cat, content: long });
const id = r.data.article?.id;
check("create -> 201", r.status === 201, `article ${id}`);
r = await author.req(ARTICLE, "POST", `/api/articles/${id}/submit`);
check("submit -> 200", r.status === 200, `${r.status}`);
r = await author.req(ARTICLE, "POST", `/api/articles/${id}/submit`);
check("second submit -> 409 (must NOT count)", r.status === 409, `${r.status}`);
r = await author.req(ARTICLE, "POST", "/api/articles", { title: `Metrics backup ${Date.now()}`, categoryId: cat, content: long });
const bid = r.data.article?.id;
const vid = Number(sql(`SELECT max(version_id) FROM article_versions WHERE article_id = ${bid}`));
r = await author.req(ARTICLE, "POST", `/api/articles/${bid}/versions/${vid}/export`);
check("backup export -> 200", r.status === 200, `${r.status} ${r.data.key || r.data.error || ""}`);
r = await author2.req(ARTICLE, "POST", `/api/articles/${bid}/versions/${vid}/export`);
check("export by another author -> 403 (must NOT count as BackupFailure)", r.status === 403, `${r.status}`);
let failStatus;
try {
  setBackups(false);                                   // isolated secret only, restored below
  r = await author.req(ARTICLE, "POST", `/api/articles/${bid}/versions/${vid}/export`);
  failStatus = r.status;
} finally { setBackups(true); }
check("export while backups disabled -> 503 (counts as BackupFailure)", failStatus === 503, `${failStatus}`);
check("isolated runtime-config restored to enabled=true",
  JSON.parse(aws("secretsmanager", "get-secret-value", "--secret-id", RC).SecretString).enabled === true);

// VERCEL=1: flushed before each response, so the datapoints are already there.
await sleep(1500);
const after = sums();
const diff = Object.fromEntries(Object.keys(after).map(k => [k, after[k] - before[k]]));
log(`metrics after:  ${JSON.stringify(after)}`);
check("ArticlesCreated +2", diff.ArticlesCreated === 2, `${diff.ArticlesCreated}`);
check("ArticlesSubmitted +1 (409 not counted)", diff.ArticlesSubmitted === 1, `${diff.ArticlesSubmitted}`);
check("BackupsExported +1", diff.BackupsExported === 1, `${diff.BackupsExported}`);
check("BackupFailures +1 (403 not counted)", diff.BackupFailures === 1, `${diff.BackupFailures}`);

log(`Total: ${pass} passed, ${fail} failed`);
if (process.env.OUT) fs.appendFileSync(process.env.OUT, "\n3. Real Article API (temporary container, CLOUDWATCH_NAMESPACE=SupportHub/Article, VERCEL=1):\n" + lines.join("\n") + "\n");
process.exitCode = fail ? 1 : 0;
