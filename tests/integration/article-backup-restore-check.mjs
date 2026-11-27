// SupportHub Group 12 - Article feature A: restore a draft from its S3 backup.
//
// Real HTTP through the ISOLATED same-origin proxy (supporthub-iso-*), real Floci S3 and Postgres.
// Never targets production, Neon or the main Floci.
//
//   node tests/integration/article-backup-restore-check.mjs
//
// Environment: BASE_URL (default http://localhost:8188), FLOCI_URL (default http://localhost:4567),
//              DB_CONTAINER (default supporthub-iso-postgres), OUT (optional transcript, no secrets).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = (process.env.BASE_URL || "http://localhost:8188").replace(/\/$/, "");
const ORIGIN = new URL(BASE).origin;
const FLOCI = process.env.FLOCI_URL || "http://localhost:4567";
const DB = process.env.DB_CONTAINER || "supporthub-iso-postgres";
if (!/:8188\b/.test(BASE) || !/:4567\b/.test(FLOCI)) throw new Error("Refusing: isolated stack only");
const demo = fs.readFileSync(path.join(ROOT, "infra/floci/.generated/isolated/demo-accounts.txt"), "utf8");
const PASSWORD = demo.match(/^password=(.+)$/m)[1].trim();

const lines = []; let pass = 0, fail = 0;
const log = t => { lines.push(t); console.log(t); };
const check = (n, ok, d = "") => { ok ? pass++ : fail++; log(`${ok ? "PASS" : "FAIL"} | ${n}${d ? " | " + d : ""}`); return ok; };

class Client {
  constructor() { this.cookie = ""; this.csrf = null; }
  async req(method, url, body) {
    if (!["GET", "HEAD"].includes(method) && !this.csrf) await this.fetchCsrf(); // sets the session cookie first
    const h = { Accept: "application/json", Origin: ORIGIN };
    if (this.cookie) h.Cookie = this.cookie;
    if (body !== undefined) h["Content-Type"] = "application/json";
    if (!["GET", "HEAD"].includes(method)) h["X-CSRF-Token"] = this.csrf;
    const res = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() || []) if (c.startsWith("supporthub.sid=")) this.cookie = c.split(";")[0];
    let data = {}; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }
  async fetchCsrf() { const h = { Accept: "application/json", Origin: ORIGIN }; if (this.cookie) h.Cookie = this.cookie;
    const res = await fetch(BASE + "/api/auth/csrf", { headers: h }); for (const c of res.headers.getSetCookie?.() || []) if (c.startsWith("supporthub.sid=")) this.cookie = c.split(";")[0];
    this.csrf = (await res.json()).csrfToken; }
  async login(email) { const r = await this.req("POST", "/api/auth/login", { email, password: PASSWORD }); if (r.data.csrfToken) this.csrf = r.data.csrfToken; return r; }
}
const sql = q => execFileSync("docker", ["exec", DB, "psql", "-U", "supporthub", "-d", "supporthub", "-tAc", q], { encoding: "utf8" }).trim();
function s3Has(key) {
  try { execFileSync("aws", ["--endpoint-url", FLOCI, "--region", "us-east-1", "s3api", "head-object", "--bucket", "supporthub-article-backups", "--key", key],
    { env: { ...process.env, AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test", AWS_PAGER: "", MSYS_NO_PATHCONV: "1" }, stdio: "ignore", timeout: 30000 }); return true; } catch { return false; }
}

log(`Article backup-restore check ${new Date().toISOString()} - isolated ${BASE}`);
const author = new Client(), author2 = new Client(), editor = new Client(), admin = new Client();
check("author login", (await author.login("author@supporthub.test")).status === 200);
const cat = Number(sql("SELECT id FROM categories ORDER BY id LIMIT 1"));
const original = { title: `Restore check ${Date.now()}`, categoryId: cat, content: "Original content that will be backed up to S3 and restored later." };
let r = await author.req("POST", "/api/articles", original);
const id = Number(r.data.article?.id ?? r.data.id);
check("author creates a draft", r.status === 201 && id > 0, `article ${id}`);
r = await author.req("GET", `/api/articles/${id}/versions`);
const v1 = Number(r.data.versions?.at(-1)?.version_id);
r = await author.req("POST", `/api/articles/${id}/versions/${v1}/export`);
check("backup of version 1 exported to S3", r.status === 200 && s3Has(`articles/${id}/versions/${v1}.json`), `${r.status} ${r.data.key || r.data.error}`);
r = await author.req("PATCH", `/api/articles/${id}`, { title: original.title + " (edited)", categoryId: cat, content: "Edited content that should be replaced by the S3 backup." });
check("draft edited (creates version 2)", r.status === 200, `${r.status}`);
const versionsBefore = Number(sql(`SELECT count(*) FROM article_versions WHERE article_id = ${id}`));
const v2 = Number(sql(`SELECT max(version_id) FROM article_versions WHERE article_id = ${id}`));

check("author2 login", (await author2.login("author2@supporthub.test")).status === 200);
r = await author2.req("POST", `/api/articles/${id}/versions/${v1}/restore-backup`);
check("another author -> 403", r.status === 403, `${r.status} ${r.data.error || ""}`);
check("editor login", (await editor.login("editor@supporthub.test")).status === 200);
r = await editor.req("POST", `/api/articles/${id}/versions/${v1}/restore-backup`);
check("editor -> 403 (authors only)", r.status === 403, `${r.status}`);
check("admin login", (await admin.login("admin@supporthub.test")).status === 200);
r = await admin.req("POST", `/api/articles/${id}/versions/${v1}/restore-backup`);
check("admin -> 403 (authors only)", r.status === 403, `${r.status}`);
r = await author.req("POST", `/api/articles/${id}/versions/${v2}/restore-backup`);
check("version without a backup -> 404", r.status === 404 && /backup not found/i.test(r.data.error || ""), `${r.status} ${r.data.error || ""}`);
check("rejected attempts changed nothing", sql(`SELECT title FROM articles WHERE id = ${id}`) === original.title + " (edited)");

r = await author.req("POST", `/api/articles/${id}/versions/${v1}/restore-backup`);
check("owner restores from the S3 backup -> 200", r.status === 200 && r.data.restoredFrom === `articles/${id}/versions/${v1}.json`, `${r.status} ${r.data.restoredFrom || r.data.error}`);
const row = sql(`SELECT title || '|' || content FROM articles WHERE id = ${id}`);
check("article title/content are the backed-up version", row === `${original.title}|${original.content}`);
check("a new version history entry was added", Number(sql(`SELECT count(*) FROM article_versions WHERE article_id = ${id}`)) === versionsBefore + 1);

log(`Total: ${pass} passed, ${fail} failed`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, lines.join("\n") + "\n");
process.exitCode = fail ? 1 : 0;
