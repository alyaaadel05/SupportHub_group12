// SupportHub Group 12 - Article versions page: "Export to S3 Backup" button (ISOLATED stack only).
//
// Real Chrome (playwright-core, system Chrome) on http://localhost:8188/versions.html with the
// isolated demo author account. Clicks Export to S3 Backup, checks the object in the isolated Floci,
// edits the draft, clicks Restore from S3 Backup and checks the restored content in the isolated
// Postgres. Then checks the export endpoint's protections through the same proxy: authentication,
// CSRF, origin validation, ownership and the rate limiter (exhausted last; isolated only).
//
//   PW_DIR=<dir containing node_modules/playwright-core> node tests/integration/frontend-export-backup-check.mjs
// Env: CHROME_PATH (default C:\Program Files\Google\Chrome\Application\chrome.exe), OUT (evidence .txt)

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = "http://localhost:8188";
const FLOCI = "http://localhost:4567";
const DB = "supporthub-iso-postgres";
const BUCKET = "supporthub-article-backups";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const { chromium } = createRequire(path.join(process.env.PW_DIR || ROOT, "package.json"))("playwright-core");
const PASSWORD = fs.readFileSync(path.join(ROOT, "infra/floci/.generated/isolated/demo-accounts.txt"), "utf8").match(/^password=(.+)$/m)[1].trim();

const lines = []; let pass = 0, fail = 0;
const log = t => { lines.push(t); console.log(t); };
const check = (n, ok, d = "") => { ok ? pass++ : fail++; log(`${ok ? "PASS" : "FAIL"} | ${n}${d ? " | " + d : ""}`); };
const sql = q => execFileSync("docker", ["exec", DB, "psql", "-U", "supporthub", "-d", "supporthub", "-tAc", q], { encoding: "utf8" }).trim();
const aws = (...a) => { const o = execFileSync("aws", ["--endpoint-url", FLOCI, "--region", "us-east-1", ...a, "--output", "json"],
  { env: { ...process.env, AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test", AWS_PAGER: "", MSYS_NO_PATHCONV: "1" }, encoding: "utf8", timeout: 30000 }); return o.trim() ? JSON.parse(o) : {}; };
const s3Obj = key => (aws("s3api", "list-objects-v2", "--bucket", BUCKET, "--prefix", key).Contents || []).find(o => o.Key === key);

// Plain HTTP client through the proxy (same path as the browser).
class Client {
  constructor() { this.cookie = ""; this.csrf = null; }
  async raw(method, url, { body, headers = {}, origin = BASE } = {}) {
    const h = { Accept: "application/json", ...(origin ? { Origin: origin } : {}), ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (body !== undefined) h["Content-Type"] = "application/json";
    const res = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() || []) if (c.startsWith("supporthub.sid=")) this.cookie = c.split(";")[0];
    let data = {}; try { data = await res.json(); } catch {}
    return { status: res.status, data, headers: res.headers };
  }
  async token() { if (!this.csrf) this.csrf = (await this.raw("GET", "/api/auth/csrf")).data.csrfToken; return this.csrf; }
  async write(method, url, body, opts = {}) { return this.raw(method, url, { body, headers: { "X-CSRF-Token": await this.token() }, ...opts }); }
  async login(email) { const r = await this.write("POST", "/api/auth/login", { email, password: PASSWORD }); if (r.data.csrfToken) this.csrf = r.data.csrfToken; return r; }
}

log(`Export to S3 Backup button check ${new Date().toISOString()} - isolated ${BASE}, Floci ${FLOCI}`);
const term = "uiexport" + Date.now().toString(36);
const author = new Client(), author2 = new Client();
check("author login (author@supporthub.test)", (await author.login("author@supporthub.test")).status === 200);
check("author2 login (author2@supporthub.test)", (await author2.login("author2@supporthub.test")).status === 200);
const cat = Number(sql("SELECT id FROM categories ORDER BY id LIMIT 1"));
const original = `Export button check (${term}): ORIGINAL draft content that the Export to S3 Backup button saves, so the restore can bring it back.`;
let r = await author.write("POST", "/api/articles", { title: `Export button ${term}`, categoryId: cat, content: original });
const id = r.data.article?.id;
check("create author draft", r.status === 201, `article ${id}`);
const vid = Number(sql(`SELECT max(version_id) FROM article_versions WHERE article_id = ${Number(id)}`));
const key = `articles/${id}/versions/${vid}.json`;
check("no S3 backup exists yet for this version", !s3Obj(key), key);

// ------------------------------------------------------------ real browser: export, edit, restore
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const problems = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const sid = author.cookie.split("=");
  await context.addCookies([{ name: sid[0], value: sid.slice(1).join("="), url: BASE, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  page.on("pageerror", e => problems.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on("console", m => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(`CSP: ${m.text().slice(0, 160)}`); });
  const posts = [];
  page.on("request", q => { if (q.method() === "POST" && /\/versions\//.test(q.url())) posts.push({ url: q.url().replace(BASE, ""), csrf: !!q.headers()["x-csrf-token"] }); });
  let dialogs = 0;
  page.on("dialog", d => { dialogs++; d.accept(); });

  await page.goto(`${BASE}/versions.html?articleId=${id}`, { waitUntil: "networkidle" });
  const btn = page.locator("#export-backup-button");
  check("button 'Export to S3 Backup' is visible", await btn.isVisible() && (await btn.innerText()).trim() === "Export to S3 Backup");
  await page.locator(`#restore-version option[value="${vid}"]`).waitFor({ state: "attached", timeout: 15000 });

  await page.selectOption("#restore-version", "");
  await btn.click();
  check("no version selected -> message, no request", (await page.textContent("#version-message")).trim() === "Select a version to back up." && posts.length === 0);

  await page.selectOption("#restore-version", String(vid));
  const exportResp = page.waitForResponse(x => x.url().endsWith(`/versions/${vid}/export`) && x.request().method() === "POST");
  await btn.click();
  const er = await exportResp;
  await page.locator("#version-message", { hasText: "successfully exported" }).waitFor({ timeout: 15000 });
  check("click Export -> POST .../export 200", er.status() === 200, `${er.status()}`);
  check("success message shown", (await page.textContent("#version-message")).trim() === "Article version successfully exported to S3 backup.");
  check("button re-enabled after export", await btn.isEnabled());
  check("browser sent X-CSRF-Token on the export POST", posts.at(-1)?.csrf === true, posts.at(-1)?.url);
  const obj = s3Obj(key);
  check("object written to isolated S3", !!obj, obj ? `s3://${BUCKET}/${obj.Key} ${obj.Size} B ${obj.LastModified}` : "missing");
  const saved = (await author.raw("GET", `/api/articles/${id}/versions/${vid}/export`)).data;
  const b = saved.backup || {};
  check("backup read back: same article, version and original content", Number(b.articleId) === Number(id) && Number(b.versionId) === vid && b.version?.content === original);

  // edit the draft (API), then restore from the backup with the button
  r = await author.write("PATCH", `/api/articles/${id}`, { title: `Export button ${term} EDITED`, categoryId: cat, content: `EDITED content for ${term}, to be replaced by the S3 backup on restore.` });
  check("edit draft after the backup", r.status === 200);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(`#restore-version option[value="${vid}"]`).waitFor({ state: "attached", timeout: 15000 });
  await page.selectOption("#restore-version", String(vid));
  const restoreResp = page.waitForResponse(x => x.url().endsWith(`/versions/${vid}/restore-backup`));
  await page.click("#restore-backup-button");
  const rr = await restoreResp;
  await page.locator("#version-message", { hasText: "restored from the S3 backup" }).waitFor({ timeout: 15000 });
  check("click Restore from S3 Backup (confirm accepted) -> 200", rr.status() === 200 && dialogs === 1, `${rr.status()}, dialogs ${dialogs}`);
  const row = sql(`SELECT title || '|' || status || '|' || (content = '${original.replace(/'/g, "''")}') FROM articles WHERE id = ${Number(id)}`);
  check("draft restored to the exported content", row === `Export button ${term}|draft|true`, row);
  check("restore created a new history entry", Number(sql(`SELECT count(*) FROM article_versions WHERE article_id = ${Number(id)}`)) === 3);
  check("no CSP violations or page errors", problems.length === 0, problems.join("; "));
  await page.screenshot({ path: path.join(ROOT, "evidence/article-features/D-export-button-after-restore.png"), fullPage: true });
} finally { await browser.close(); }

// ------------------------------------------------------------ protections on the export endpoint
const exp = `/api/articles/${id}/versions/${vid}/export`;
r = await new Client().raw("POST", exp, { headers: { "X-CSRF-Token": "x" } });
check("no session -> 401", r.status === 401, `${r.status}`);
r = await author.raw("POST", exp);
check("session without CSRF token -> 403", r.status === 403, `${r.status} ${r.data.error || ""}`);
r = await author.raw("POST", exp, { headers: { "X-CSRF-Token": "0".repeat(64) } });
check("wrong CSRF token -> 403", r.status === 403, `${r.status} ${r.data.error || ""}`);
r = await author.write("POST", exp, undefined, { origin: "https://evil.example" });
check("foreign Origin -> 403 (origin validation)", r.status === 403, `${r.status} ${r.data.error || ""}`);
r = await author2.write("POST", exp);
check("another author exports this draft -> 403 (ownership)", r.status === 403, `${r.status} ${r.data.error || ""}`);
r = await author2.write("POST", `/api/articles/${id}/versions/${vid}/restore-backup`);
check("another author restores this draft -> 403 (ownership)", r.status === 403, `${r.status} ${r.data.error || ""}`);

// Rate limiter: version-backup, 20 per 15 minutes (production profile). Exhausted LAST.
r = await author.write("POST", exp);
const policy = r.headers.get("ratelimit-policy"), state = r.headers.get("ratelimit");
check("export carries the version-backup limiter headers", r.status === 200 && /^20;w=900/.test(policy || ""), `policy=${policy} ratelimit=${state}`);
let limited = null, n = 0;
for (; n < 25 && !limited; n++) { const x = await author.write("POST", exp); if (x.status === 429) limited = x; }
check("limit reached -> 429 version-backup", limited?.data?.limiter === "version-backup", `after ${n} more requests: ${limited?.status} ${limited?.data?.error || ""}`);

log(`Total: ${pass} passed, ${fail} failed (article ${id}, version ${vid})`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, lines.join("\n") + "\n");
process.exitCode = fail ? 1 : 0;
