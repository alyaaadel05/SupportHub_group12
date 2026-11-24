// SupportHub Group 12 - verifies that PRODUCTION rate limits are active.
//
// Run against a stack started with RATE_LIMIT_PROFILE=production (default):
//   node tests/integration/rate-limit-production.mjs
// Checks (per client, 15-minute window):
//   duplicate check  30  -> request 31 must be 429
//   public search   120  -> request 121 must be 429
//   login            30  -> attempt 31 must be 429 (wrong passwords: brute force)
// WARNING: this locks the test client out of those endpoints for 15 minutes
// (restart the containers to reset the in-memory counters).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = (process.env.BASE_URL || "http://localhost:8088").replace(/\/$/, "");
const ORIGIN = new URL(BASE).origin;
const PASSWORD = process.env.SUPPORTHUB_DEMO_PASSWORD ||
  fs.readFileSync(path.join(ROOT, "infra/floci/.generated/demo-accounts.txt"), "utf8").match(/^password=(.+)$/m)[1].trim();

let cookie = "", csrf = "";
async function req(method, url, body) {
  const headers = { Origin: ORIGIN, Accept: "application/json" };
  if (cookie) headers.Cookie = cookie;
  if (csrf && method !== "GET") headers["X-CSRF-Token"] = csrf;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  for (const c of res.headers.getSetCookie?.() || []) if (c.startsWith("supporthub.sid=")) cookie = c.split(";")[0];
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, limit: res.headers.get("ratelimit-policy") };
}

const lines = [];
const log = t => { lines.push(t); console.log(t); };
let pass = 0, fail = 0;
const check = (name, ok, detail) => { ok ? pass++ : fail++; log(`${ok ? "PASS" : "FAIL"} | ${name} | ${detail}`); };

async function burst(label, n, fn) {
  const statuses = [];
  for (let i = 0; i < n; i++) statuses.push((await fn()).status);
  const first429 = statuses.indexOf(429) + 1;
  return { statuses, first429, ok: statuses.filter(s => s !== 429).length };
}

log(`Production rate-limit verification - ${new Date().toISOString()} - ${BASE}`);
csrf = (await req("GET", "/api/auth/csrf")).data.csrfToken;
const login = await req("POST", "/api/auth/login", { email: "author@supporthub.test", password: PASSWORD });
csrf = login.data.csrfToken || csrf;
check("author login", login.status === 200, `HTTP ${login.status}`);

const cats = (await req("GET", "/api/categories")).data.categories;
const dup = await burst("duplicates", 32, () => req("POST", "/api/articles/check-duplicates",
  { title: "Reset password guide", content: "Steps to reset a password safely.", categoryId: cats[0].id }));
check("duplicate check limited at 30/15 min", dup.first429 === 31, `first 429 at request ${dup.first429}, ${dup.ok} allowed`);

const search = await burst("search", 122, () => req("GET", "/api/public/articles?q=password"));
check("public search limited at 120/15 min", search.first429 === 121, `first 429 at request ${search.first429}, ${search.ok} allowed`);

cookie = ""; csrf = (await req("GET", "/api/auth/csrf")).data.csrfToken;
const brute = await burst("login", 32, () => req("POST", "/api/auth/login", { email: "author@supporthub.test", password: "wrong-password-guess" }));
// One successful login above already consumed 1 of the 30 attempts.
check("login brute force limited at 30/15 min", brute.first429 > 0 && brute.first429 <= 30,
  `first 429 at attempt ${brute.first429} (1 earlier login counted), earlier attempts all 401: ${brute.statuses.slice(0, brute.first429 - 1).every(s => s === 401)}`);

log(`\nTotal: ${pass} passed, ${fail} failed`);
const dir = path.join(ROOT, "evidence/final/rate-limits");
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, `production-limits-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}.txt`);
fs.writeFileSync(out, lines.join("\n") + "\n");
console.log("Saved", path.relative(ROOT, out));
process.exitCode = fail ? 1 : 0;
