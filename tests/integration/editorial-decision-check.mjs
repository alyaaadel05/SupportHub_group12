// SupportHub - Approve / Reject check (real services, real database)
//
// Logs in as an editor through the frontend proxy, approves one pending review
// and rejects another exactly like editorial.js does (CSRF from /api/csrf-token,
// browser Origin header, session cookie), then verifies the database
// transitions:
//   approve: editorial_reviews.decision = approved, articles.status = approved
//   reject : editorial_reviews.decision = rejected, articles.status = draft
//
//   node tests/integration/editorial-decision-check.mjs
// Env: BASE_URL (default http://localhost:8088), ORIGIN (default = BASE_URL origin),
//      EDITOR_EMAIL (default editor@supporthub.test), SUPPORTHUB_DEMO_PASSWORD,
//      DB_CONTAINER (default supporthub-int-postgres; "" skips database checks)

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = (process.env.BASE_URL || "http://localhost:8088").replace(/\/$/, "");
const ORIGIN = process.env.ORIGIN || new URL(BASE).origin;
const EDITOR = process.env.EDITOR_EMAIL || "editor@supporthub.test";
const DB = process.env.DB_CONTAINER ?? "supporthub-int-postgres";
const PASSWORD = process.env.SUPPORTHUB_DEMO_PASSWORD ||
  fs.readFileSync(path.join(ROOT, "infra/floci/.generated/demo-accounts.txt"), "utf8").match(/^password=(.+)$/m)[1].trim();

let cookie = "";
async function req(method, url, { body, csrf } = {}) {
  const headers = { Origin: ORIGIN, Accept: "application/json" };
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers["X-CSRF-Token"] = csrf;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  for (const c of res.headers.getSetCookie?.() || []) if (c.startsWith("supporthub.sid=")) cookie = c.split(";")[0];
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const sql = q => DB ? execFileSync("docker", ["exec", DB, "psql", "-U", "supporthub", "-d", "supporthub", "-tAc", q], { encoding: "utf8" }).trim() : "(skipped)";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };

console.log(`Editorial decision check - ${new Date().toISOString()} - ${BASE} (Origin ${ORIGIN})`);
let r = await req("GET", "/api/auth/csrf");
r = await req("POST", "/api/auth/login", { body: { email: EDITOR, password: PASSWORD }, csrf: r.data.csrfToken });
check("editor login", r.status === 200, `HTTP ${r.status} ${r.data.error || r.data.user?.role || ""}`);
const me = r.data.user;

r = await req("GET", "/api/reviews?status=pending");
const reviews = (r.data.reviews || []).filter(x => Number(x.article?.author_id ?? x.submitted_by) !== Number(me?.id));
check("review queue loads", r.status === 200 && reviews.length >= 2, `HTTP ${r.status}, ${reviews.length} reviewable items`);

async function decide(review, decision, comments) {
  // Same two requests as editorial.js submitEditorialDecision().
  const token = (await req("GET", "/api/csrf-token")).data.csrfToken;
  return req("POST", `/api/articles/${review.article_id}/reviews`, { body: { decision, comments }, csrf: token });
}

if (reviews.length >= 2) {
  const [a, b] = reviews;
  r = await decide(a, "approved", "Approved after editorial review.");
  check(`Approve article ${a.article_id}`, r.status === 201, `HTTP ${r.status} ${r.data.error || ""}`);
  const aState = sql(`SELECT a.status || '/' || r.decision FROM articles a JOIN editorial_reviews r ON r.article_id = a.id WHERE a.id = ${a.article_id} ORDER BY r.review_id DESC LIMIT 1`);
  check(`database: article ${a.article_id} approved`, !DB || aState === "approved/approved", `articles.status/review.decision = ${aState}`);

  r = await decide(b, "rejected", "Please add screenshots for each step.");
  check(`Reject article ${b.article_id}`, r.status === 201, `HTTP ${r.status} ${r.data.error || ""}`);
  const bState = sql(`SELECT a.status || '/' || r.decision FROM articles a JOIN editorial_reviews r ON r.article_id = a.id WHERE a.id = ${b.article_id} ORDER BY r.review_id DESC LIMIT 1`);
  check(`database: article ${b.article_id} back to draft, review rejected`, !DB || bState === "draft/rejected", `articles.status/review.decision = ${bState}`);
}

console.log(`\nTotal: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
