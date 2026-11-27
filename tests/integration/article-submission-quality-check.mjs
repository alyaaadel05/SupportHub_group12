// SupportHub Group 12 - Article feature C: submission quality rules (422) before review.
// Real HTTP through the ISOLATED proxy (supporthub-iso-*) and the isolated Postgres. Never production.
//
//   node tests/integration/article-submission-quality-check.mjs

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = (process.env.BASE_URL || "http://localhost:8188").replace(/\/$/, "");
const ORIGIN = new URL(BASE).origin;
const DB = process.env.DB_CONTAINER || "supporthub-iso-postgres";
if (!/:8188\b/.test(BASE) || !/iso/.test(DB)) throw new Error("Refusing: isolated stack only");
const PASSWORD = fs.readFileSync(path.join(ROOT, "infra/floci/.generated/isolated/demo-accounts.txt"), "utf8").match(/^password=(.+)$/m)[1].trim();
const lines = []; let pass = 0, fail = 0;
const log = t => { lines.push(t); console.log(t); };
const check = (n, ok, d = "") => { ok ? pass++ : fail++; log(`${ok ? "PASS" : "FAIL"} | ${n}${d ? " | " + d : ""}`); };
const sql = q => execFileSync("docker", ["exec", DB, "psql", "-U", "supporthub", "-d", "supporthub", "-tAc", q], { encoding: "utf8" }).trim();

class Client {
  constructor() { this.cookie = ""; this.csrf = null; }
  async raw(method, url, body, extra = {}) {
    const h = { Accept: "application/json", Origin: ORIGIN, ...extra };
    if (this.cookie) h.Cookie = this.cookie;
    if (body !== undefined) h["Content-Type"] = "application/json";
    const res = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() || []) if (c.startsWith("supporthub.sid=")) this.cookie = c.split(";")[0];
    let data = {}; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }
  async req(method, url, body) {
    if (!["GET", "HEAD"].includes(method) && !this.csrf) this.csrf = (await this.raw("GET", "/api/auth/csrf")).data.csrfToken;
    return this.raw(method, url, body, ["GET", "HEAD"].includes(method) ? {} : { "X-CSRF-Token": this.csrf });
  }
  async login(email) { const r = await this.req("POST", "/api/auth/login", { email, password: PASSWORD }); if (r.data.csrfToken) this.csrf = r.data.csrfToken; return r; }
}

log(`Article submission-quality check ${new Date().toISOString()} - isolated ${BASE}`);
const author = new Client();
check("author login", (await author.login("author@supporthub.test")).status === 200);
const cat = Number(sql("SELECT id FROM categories ORDER BY id LIMIT 1"));
const stamp = Date.now();
const events = id => Number(sql(`SELECT count(*) FROM article_event_outbox WHERE article_id = ${id}`));
const status = id => sql(`SELECT status FROM articles WHERE id = ${id}`);

// 1. too short
let r = await author.req("POST", "/api/articles", { title: `Short draft ${stamp}`, categoryId: cat, content: "Only forty characters of content here.." });
const shortId = r.data.article?.id;
r = await author.req("POST", `/api/articles/${shortId}/submit`);
check("content < 100 characters -> 422 with clear message", r.status === 422 && /at least 100 characters .*currently \d+/.test(r.data.error) && r.data.issues?.length === 1, `${r.status} ${r.data.error}`);
check("rejected draft stays draft, no outbox event", status(shortId) === "draft" && events(shortId) === 0);

// 2. duplicate title (different case and spacing than an existing article)
const existing = sql("SELECT title FROM articles WHERE status <> 'draft' ORDER BY id LIMIT 1");
const long = "This article explains every step in detail so that it is long enough to pass the minimum content length rule for review.";
r = await author.req("POST", "/api/articles", { title: "  " + existing.toUpperCase().replace(/ /g, "  ") + " ", categoryId: cat, content: long });
const dupId = r.data.article?.id;
r = await author.req("POST", `/api/articles/${dupId}/submit`);
check("duplicate title (case/space-insensitive) -> 422", r.status === 422 && /already uses this title/.test(r.data.error), `${r.status} ${r.data.error}`);
check("duplicate stays draft, no outbox event", status(dupId) === "draft" && events(dupId) === 0);

// 3. both problems at once
r = await author.req("POST", "/api/articles", { title: existing, categoryId: cat, content: "Too short content." });
const bothId = r.data.article?.id;
r = await author.req("POST", `/api/articles/${bothId}/submit`);
check("several problems are listed together", r.status === 422 && r.data.issues?.length === 2, `${r.status} issues=${r.data.issues?.length}`);

// 4. fixing the draft makes it submittable
r = await author.req("PATCH", `/api/articles/${shortId}`, { title: `Short draft ${stamp}`, categoryId: cat, content: long });
r = await author.req("POST", `/api/articles/${shortId}/submit`);
check("after fixing, submit -> 200 in_review with one outbox event", r.status === 200 && status(shortId) === "in_review" && events(shortId) === 1, `${r.status}`);
r = await author.req("POST", `/api/articles/${shortId}/submit`);
check("re-submitting a non-draft keeps the existing 409", r.status === 409, `${r.status}`);

log(`Total: ${pass} passed, ${fail} failed`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, lines.join("\n") + "\n");
process.exitCode = fail ? 1 : 0;
