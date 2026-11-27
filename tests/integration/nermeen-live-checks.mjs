// SupportHub Group 12 - Nermeen (Search, Feedback & Analytics): final LIVE checks.
// Runs ONLY against the public site https://supporthub-group12.pages.dev/api/* (Cloudflare Pages -> Vercel APIs).
// Never uses localhost, Docker, Floci, AWS CLI or the database. No code, settings or deployments are changed.
//
//   node tests/integration/nermeen-live-checks.mjs before   (read-only analytics snapshot)
//   ... vote / send feedback in the browser (Turnstile needs a real browser) ...
//   node tests/integration/nermeen-live-checks.mjs after    (search, Article S3 backup, analytics comparison, evidence)
//
// Logins are read at runtime from ~/supporthub-nermeen-accounts.env (outside the repository).
// Emails are masked; passwords, cookies and CSRF tokens are never printed or saved.
// Protected demo articles 7, 21 and 22 are never used: Check 3 uses its own "Nermeen live verification" draft.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = "https://supporthub-group12.pages.dev";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = path.join(ROOT, "evidence", "final-verification-nermeen");
const PROTECTED = new Set([7, 21, 22]);
const PHASE = process.argv[2];
if (!["before", "after"].includes(PHASE)) { console.log("Usage: node tests/integration/nermeen-live-checks.mjs before|after"); process.exit(2); }

const ACC_FILE = process.env.ACCOUNTS || path.join(os.homedir(), "supporthub-nermeen-accounts.env");
const acc = Object.fromEntries([...fs.readFileSync(ACC_FILE, "utf8").replace(/^\uFEFF/, "")
  .matchAll(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/gm)].map(m => [m[1], m[2].replace(/^["']|["']$/g, "")]));
for (const k of ["AUTHOR_EMAIL", "AUTHOR_PASSWORD", "EDITOR_EMAIL", "EDITOR_PASSWORD"])
  if (!acc[k]) { console.log(`Missing ${k} in the accounts file`); process.exit(2); }
const mask = e => String(e).replace(/^(.{2}).*(@).*$/, "$1***$2...");
const now = () => new Date().toISOString();

const rows = [];
function record(check, operation, endpoint, http, confirmed, ok) {
  const r = { time: now(), check, operation, endpoint, http, confirmed, result: ok ? "PASS" : "FAIL" };
  rows.push(r);
  console.log(`${r.result} | ${check} | ${operation} | ${endpoint} -> ${http} | ${confirmed}`);
  return ok;
}

// Browser-like session through the public site (same approach as production-live-aws-e2e.mjs).
class Session {
  constructor() { this.jar = new Map(); this.csrf = null; }
  async req(method, p, body, extra = {}) {
    const headers = { Origin: SITE, Accept: "application/json", ...extra };
    if (this.jar.size) headers.Cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(SITE + "/api" + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(30000) });
    for (const c of res.headers.getSetCookie?.() || []) {
      const [kv] = c.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(c) || !v) this.jar.delete(k); else this.jar.set(k, v);
    }
    const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text.slice(0, 120); }
    return { status: res.status, data };
  }
  async token() { if (!this.csrf) this.csrf = (await this.req("GET", "/auth/csrf")).data?.csrfToken; return this.csrf; }
  async write(method, p, body) { return this.req(method, p, body, { "X-CSRF-Token": await this.token() }); }
  async login(email, password) {
    const r = await this.req("POST", "/auth/login", { email, password }, { "X-CSRF-Token": await this.token() });
    if (r.data?.csrfToken) this.csrf = r.data.csrfToken;
    const me = await this.req("GET", "/auth/me");
    return { status: r.status, role: me.data?.user?.role ?? me.data?.role };
  }
}

async function analyticsSnapshot() {
  const editor = new Session();
  const li = await editor.login(acc.EDITOR_EMAIL, acc.EDITOR_PASSWORD);
  if (li.status !== 200) { console.log(`Editor login failed (HTTP ${li.status}) for ${mask(acc.EDITOR_EMAIL)}`); process.exit(2); }
  const o = await editor.req("GET", "/analytics/overview");
  await editor.write("POST", "/auth/logout");
  const d = o.data || {};
  const sentiment = Object.fromEntries((d.sentimentBreakdown || []).map(x => [String(x.label).toUpperCase(), Number(x.count)]));
  return { http: o.status, role: li.role, at: now(), totalVotes: d.totalVotes, helpfulVotes: d.helpfulVotes, unhelpfulVotes: d.unhelpfulVotes, sentiment };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const BEFORE_FILE = path.join(OUT_DIR, "analytics-before.json");
console.log(`Nermeen live checks, phase "${PHASE}", ${now()}, via ${SITE} (author ${mask(acc.AUTHOR_EMAIL)}, editor ${mask(acc.EDITOR_EMAIL)})`);

if (PHASE === "before") {
  const snap = await analyticsSnapshot();
  fs.writeFileSync(BEFORE_FILE, JSON.stringify(snap, null, 2));
  console.log(`Saved analytics snapshot (HTTP ${snap.http}, editor role ${snap.role}): votes ${snap.totalVotes} (helpful ${snap.helpfulVotes}, unhelpful ${snap.unhelpfulVotes}), sentiment ${JSON.stringify(snap.sentiment)}`);
  console.log("Now vote and send feedback in the browser, then run the 'after' phase.");
  process.exit(snap.http === 200 ? 0 : 1);
}

// ------------------------------------------------------------------ AFTER
const before = fs.existsSync(BEFORE_FILE) ? JSON.parse(fs.readFileSync(BEFORE_FILE, "utf8")) : null;

// Check 2a - search indexing: a word from a published article title must find that article.
const anon = new Session();
const list = await anon.req("GET", "/public/articles?pageSize=10");
const pub = (list.data?.results || []).find(a => /[a-z]{4,}/i.test(a.title || ""));
if (!pub) {
  record("Check 2 search", "List published articles", "GET /api/public/articles", list.status, "no published article found", false);
} else {
  const word = (pub.title.match(/[A-Za-z]{4,}/g) || []).sort((a, b) => b.length - a.length)[0].toLowerCase();
  const s = await anon.req("GET", `/public/articles?q=${encodeURIComponent(word)}&pageSize=50`);
  const found = (s.data?.results || []).some(a => String(a.article_id ?? a.id) === String(pub.article_id ?? pub.id));
  record("Check 2 search", `Search for "${word}" from published article ${pub.article_id ?? pub.id}`, `GET /api/public/articles?q=${word}`, s.status,
    found ? `article ${pub.article_id ?? pub.id} "${pub.title}" is in the results (total ${s.data?.total})` : "article not in results", s.status === 200 && found);
}

// Check 3 - Article S3 backup through the deployed Article API (reads Secrets Manager config first).
// Uses ONLY an article titled "Nermeen live verification ..." (never 7, 21 or 22); creates one draft if none exists.
const author = new Session();
const al = await author.login(acc.AUTHOR_EMAIL, acc.AUTHOR_PASSWORD);
if (al.status !== 200) {
  record("Check 3 backup", "Author login", "POST /api/auth/login", al.status, `login failed for ${mask(acc.AUTHOR_EMAIL)}`, false);
} else {
  const mine = await author.req("GET", "/articles/mine");
  const arts = Array.isArray(mine.data) ? mine.data : (mine.data?.articles || []);
  let art = arts.find(a => /^Nermeen live verification/.test(a.title || "") && !PROTECTED.has(Number(a.id ?? a.article_id)));
  if (!art) {
    const cats = await author.req("GET", "/categories");
    const catList = Array.isArray(cats.data) ? cats.data : (cats.data?.categories || []);
    const stamp = now().replace(/[:.]/g, "-");
    const c = await author.write("POST", "/articles", { title: `Nermeen live verification ${stamp}`, categoryId: Number(catList[0]?.id),
      content: `Draft created by Nermeen's test account on ${stamp} to verify the Article S3 version backup through the deployed API.` });
    art = c.data?.article ?? c.data;
    console.log(`Created draft article ${art?.id ?? art?.article_id} (HTTP ${c.status})`);
  }
  const articleId = Number(art?.id ?? art?.article_id);
  if (!articleId || PROTECTED.has(articleId)) {
    record("Check 3 backup", "Choose verification article", "GET /api/articles/mine", mine.status, `no safe article (got ${articleId})`, false);
  } else {
    const versions = await author.req("GET", `/articles/${articleId}/versions`);
    const vlist = Array.isArray(versions.data) ? versions.data : (versions.data?.versions || []);
    const versionId = Number(vlist[0]?.id ?? vlist[0]?.version_id ?? vlist[0]?.versionId);
    const ep = `/articles/${articleId}/versions/${versionId}/export`;
    let bk = await author.write("POST", ep);
    if (bk.status === 503) { console.log("Backup returned 503, retrying once in 5 s"); await new Promise(r => setTimeout(r, 5000)); bk = await author.write("POST", ep); }
    record("Check 3 backup", "S3 backup export (Secrets Manager config read first)", `POST /api${ep}`, bk.status,
      bk.status < 300 ? "backup stored in S3 through the deployed Article API" : `failed: ${JSON.stringify(bk.data).slice(0, 100)}`, bk.status >= 200 && bk.status < 300);
    const back = await author.req("GET", ep);
    record("Check 3 backup", "S3 backup read-back", `GET /api${ep}`, back.status,
      back.status === 200 ? "backup returned by the API from S3" : `failed: ${JSON.stringify(back.data).slice(0, 100)}`, back.status === 200);
  }
  await author.write("POST", "/auth/logout");
}

// Checks 1 and 2b - compare analytics with the "before" snapshot (browser feedback and vote counted).
const after = await analyticsSnapshot();
if (!before) {
  record("Check 1/2 analytics", "Analytics comparison", "GET /api/analytics/overview", after.http, "no 'before' snapshot: run the before phase first", false);
} else {
  const dv = (after.totalVotes ?? 0) - (before.totalVotes ?? 0);
  const changedVote = dv >= 1 || after.helpfulVotes !== before.helpfulVotes || after.unhelpfulVotes !== before.unhelpfulVotes;
  record("Check 2 vote", "Helpfulness vote counted", "GET /api/analytics/overview", after.http,
    `votes ${before.totalVotes} -> ${after.totalVotes} (helpful ${before.helpfulVotes} -> ${after.helpfulVotes}, unhelpful ${before.unhelpfulVotes} -> ${after.unhelpfulVotes})`, after.http === 200 && changedVote);
  const pos = (after.sentiment.POSITIVE ?? 0) - (before.sentiment.POSITIVE ?? 0);
  const neg = (after.sentiment.NEGATIVE ?? 0) - (before.sentiment.NEGATIVE ?? 0);
  record("Check 1 sentiment", "Positive feedback stored as POSITIVE", "GET /api/analytics/overview", after.http,
    `POSITIVE ${before.sentiment.POSITIVE ?? 0} -> ${after.sentiment.POSITIVE ?? 0}`, after.http === 200 && pos >= 1);
  record("Check 1 sentiment", "Negative feedback stored as NEGATIVE", "GET /api/analytics/overview", after.http,
    `NEGATIVE ${before.sentiment.NEGATIVE ?? 0} -> ${after.sentiment.NEGATIVE ?? 0}`, after.http === 200 && neg >= 1);
}

// ------------------------------------------------------------------ evidence files
const pass = rows.filter(r => r.result === "PASS").length, fail = rows.length - pass;
const summary = { ranBy: "Nermeen Mostafa (239814)", at: now(), via: SITE, author: mask(acc.AUTHOR_EMAIL), editor: mask(acc.EDITOR_EMAIL), before, after, rows, pass, fail };
fs.writeFileSync(path.join(OUT_DIR, "nermeen-live-checks.json"), JSON.stringify(summary, null, 2));
const line = r => `${r.time} | ${r.result.padEnd(4)} | ${r.check.padEnd(18)} | ${r.operation} | ${r.endpoint} -> HTTP ${r.http} | ${r.confirmed}`;
fs.writeFileSync(path.join(OUT_DIR, "nermeen-live-checks.txt"),
  `SupportHub Group 12 - Nermeen final LIVE checks\nRun by: Nermeen Mostafa (239814) at ${now()} via ${SITE}\n` +
  `Accounts: author ${mask(acc.AUTHOR_EMAIL)}, editor ${mask(acc.EDITOR_EMAIL)} (masked)\n\n` +
  rows.map(line).join("\n") + `\n\nTotal: ${pass} PASS, ${fail} FAIL\n` +
  `\nNotes: the vote and the two feedback messages were sent in a real browser on the live site, because the\n` +
  `Search service requires a Cloudflare Turnstile token that only a browser can produce. This script confirms\n` +
  `them by comparing the analytics overview before and after. Protected articles 7, 21 and 22 are never used.\n` +
  `Checks run with Claude assistance.\n`);
console.log(`Total: ${pass} passed, ${fail} failed. Evidence saved in evidence/final-verification-nermeen/`);
process.exitCode = fail ? 1 : 0;