// SupportHub Group 12 - shared k6 helpers for the ISOLATED local load-test stack
// (tests/load/stack/docker-compose.loadtest.yml).
//
// Safety: every target must be 127.0.0.1 or localhost. The script aborts
// otherwise, so it can never be pointed at Vercel, Cloudflare or Neon.
//
// Authentication: at most two logins per run (author + editor) in setup().
// The Identity login limit stays fixed at 30 per 15 minutes; virtual users
// reuse the two synthetic session cookies instead of logging in themselves.

import http from "k6/http";
import { check, fail } from "k6";
import { Counter } from "k6/metrics";

export const BASE = {
  identity: __ENV.IDENTITY_URL || "http://127.0.0.1:13003",
  article: __ENV.ARTICLE_URL || "http://127.0.0.1:13001",
  editorial: __ENV.EDITORIAL_URL || "http://127.0.0.1:13002",
  search: __ENV.SEARCH_URL || "http://127.0.0.1:13004"
};

for (const [name, url] of Object.entries(BASE)) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) {
    throw new Error(`Refusing to run: ${name} target ${url} is not a local load-test service`);
  }
}

// Must match FRONTEND_ORIGIN in the load-test compose file.
export const ORIGIN = "http://127.0.0.1:18080";

// Synthetic accounts that exist only in the disposable load-test database.
const PASSWORD = __ENV.LOADTEST_PASSWORD || "LoadTest-Only-2026!";
export const USERS = {
  author: "loadtest-author@supporthub.test",
  editor: "loadtest-editor@supporthub.test"
};

export const SERVICES = ["identity", "article", "editorial", "search"];
export const ROLES = ["public", "author", "editor"];

// Response-class counters, tagged by service and role.
export const status2xx = new Counter("status_2xx");
export const status4xx = new Counter("status_4xx");
export const status429 = new Counter("status_429");
export const status5xx = new Counter("status_5xx");
export const statusError = new Counter("status_error");

const SEARCH_TERMS = [
  "password", "router", "vpn", "billing", "invoice", "email", "printer",
  "wifi", "refund", "subscription", "backup", "account", "two-factor", "slow"
];

const PUBLISHED_IDS = { min: 1001, count: 60 };   // published synthetic articles
const ALL_IDS = { min: 1001, count: 75 };          // all synthetic articles

function rand(n) { return Math.floor(Math.random() * n); }
function pick(list) { return list[rand(list.length)]; }

// Endpoint catalogue. weight = relative share of traffic in mixed tests.
export const ENDPOINTS = [
  // Unauthenticated visitors
  { name: "GET /api/public/articles?q", service: "search", role: "public", weight: 20,
    path: () => `/api/public/articles?q=${encodeURIComponent(pick(SEARCH_TERMS))}&page=1` },
  { name: "GET /api/public/articles/:id", service: "search", role: "public", weight: 12,
    path: () => `/api/public/articles/${PUBLISHED_IDS.min + rand(PUBLISHED_IDS.count)}` },
  { name: "GET /api/categories", service: "article", role: "public", weight: 8,
    path: () => "/api/categories" },
  { name: "GET /api/auth/csrf", service: "identity", role: "public", weight: 4,
    path: () => "/api/auth/csrf" },
  { name: "GET /api/health (identity)", service: "identity", role: "public", weight: 1, path: () => "/api/health" },
  { name: "GET /api/health (article)", service: "article", role: "public", weight: 1, path: () => "/api/health" },
  { name: "GET /api/health (editorial)", service: "editorial", role: "public", weight: 1, path: () => "/api/health" },
  { name: "GET /api/health (search)", service: "search", role: "public", weight: 1, path: () => "/api/health" },

  // Authors
  { name: "GET /api/auth/me (author)", service: "identity", role: "author", weight: 6,
    path: () => "/api/auth/me" },
  { name: "GET /api/articles/mine", service: "article", role: "author", weight: 10,
    path: () => "/api/articles/mine" },
  { name: "GET /api/articles/:id", service: "article", role: "author", weight: 6,
    path: () => `/api/articles/${ALL_IDS.min + rand(ALL_IDS.count)}` },
  { name: "GET /api/articles/:id/versions", service: "article", role: "author", weight: 4,
    path: () => `/api/articles/${ALL_IDS.min + rand(ALL_IDS.count)}/versions` },

  // Editors
  { name: "GET /api/auth/me (editor)", service: "identity", role: "editor", weight: 4,
    path: () => "/api/auth/me" },
  { name: "GET /api/reviews?status=pending", service: "editorial", role: "editor", weight: 6,
    path: () => "/api/reviews?status=pending" },
  { name: "GET /api/editorial/published", service: "editorial", role: "editor", weight: 4,
    path: () => "/api/editorial/published" },
  { name: "GET /api/analytics/overview", service: "search", role: "editor", weight: 4,
    path: () => "/api/analytics/overview" }
];

const TOTAL_WEIGHT = ENDPOINTS.reduce((sum, e) => sum + e.weight, 0);

export function pickWeighted() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const e of ENDPOINTS) {
    r -= e.weight;
    if (r < 0) return e;
  }
  return ENDPOINTS[ENDPOINTS.length - 1];
}

// Two logins per run. Returns { author: "supporthub.sid=...", editor: "..." }.
export function loginAll() {
  return { author: login(USERS.author), editor: login(USERS.editor) };
}

function login(email) {
  const jar = new http.CookieJar();
  const tags = { service: "identity", role: "setup" };

  const csrf = http.get(`${BASE.identity}/api/auth/csrf`, {
    jar, tags: { ...tags, endpoint: "GET /api/auth/csrf (setup)" }
  });
  const token = csrf.status === 200 ? csrf.json("csrfToken") : null;
  if (!token) fail(`CSRF request failed for ${email}: HTTP ${csrf.status}`);

  const res = http.post(
    `${BASE.identity}/api/auth/login`,
    JSON.stringify({ email, password: PASSWORD }),
    {
      jar,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token, Origin: ORIGIN },
      tags: { ...tags, endpoint: "POST /api/auth/login (setup)" }
    }
  );
  if (res.status !== 200) fail(`Login failed for ${email}: HTTP ${res.status} ${res.body}`);

  const sid = jar.cookiesForURL(`${BASE.identity}/`)["supporthub.sid"];
  if (!sid || !sid.length) fail(`No session cookie returned for ${email}`);
  return `supporthub.sid=${sid[0]}`;
}

// Sends one request for an endpoint and records its response class.
// A fresh cookie jar per request keeps public requests unauthenticated and
// stops sessions leaking between roles.
export function call(endpoint, sessions) {
  const headers = {};
  if (endpoint.role === "author") headers.Cookie = sessions.author;
  if (endpoint.role === "editor") headers.Cookie = sessions.editor;

  const tags = { service: endpoint.service, role: endpoint.role, endpoint: endpoint.name };
  const res = http.get(`${BASE[endpoint.service]}${endpoint.path()}`, {
    headers, tags, jar: new http.CookieJar(), timeout: "30s"
  });

  const ct = { service: endpoint.service, role: endpoint.role };
  if (res.status === 0) statusError.add(1, ct);
  else if (res.status === 429) status429.add(1, ct);
  else if (res.status >= 500) status5xx.add(1, ct);
  else if (res.status >= 400) status4xx.add(1, ct);
  else status2xx.add(1, ct);

  check(res, { [`${endpoint.name} -> 200`]: r => r.status === 200 }, tags);
  return res;
}

// Trivial thresholds that make k6 keep a sub-metric for every
// service/role combination, so the summary can report them separately.
export function breakdownThresholds() {
  const t = {};
  const pairs = new Set(ENDPOINTS.map(e => `${e.service}|${e.role}`));
  for (const pair of pairs) {
    const [service, role] = pair.split("|");
    const sel = `{service:${service},role:${role}}`;
    t[`http_reqs${sel}`] = ["count>=0"];
    t[`http_req_duration${sel}`] = ["max>=0"];
    for (const m of ["status_2xx", "status_4xx", "status_429", "status_5xx", "status_error"]) {
      t[`${m}${sel}`] = ["count>=0"];
    }
  }
  for (const s of SERVICES) {
    t[`http_reqs{service:${s}}`] = ["count>=0"];
    t[`http_req_duration{service:${s}}`] = ["max>=0"];
  }
  for (const r of ROLES) {
    t[`http_reqs{role:${r}}`] = ["count>=0"];
    t[`http_req_duration{role:${r}}`] = ["max>=0"];
  }
  return t;
}

function metricValue(data, name, field) {
  const m = data.metrics[name];
  return m && m.values && m.values[field] !== undefined ? m.values[field] : 0;
}

function fmtMs(v) { return `${Math.round(v)} ms`; }

// Plain-text breakdown by service x role, by service and by role.
export function breakdownText(data, title) {
  const lines = [];
  lines.push(`==== ${title} ====`);
  lines.push(`Total HTTP requests (incl. setup logins): ${metricValue(data, "http_reqs", "count")}`);
  lines.push(`Failed (non-2xx/3xx): ${(metricValue(data, "http_req_failed", "rate") * 100).toFixed(2)}%`);
  lines.push(`Latency avg ${fmtMs(metricValue(data, "http_req_duration", "avg"))}, ` +
             `p95 ${fmtMs(metricValue(data, "http_req_duration", "p(95)"))}, ` +
             `max ${fmtMs(metricValue(data, "http_req_duration", "max"))}`);
  lines.push(`Throughput: ${metricValue(data, "http_reqs", "rate").toFixed(1)} req/s`);
  lines.push("");
  lines.push("Service    Role     Requests   2xx   4xx   429   5xx  err   p95");
  lines.push("---------  -------  --------  ----  ----  ----  ----  ---  --------");
  const pairs = [...new Set(ENDPOINTS.map(e => `${e.service}|${e.role}`))].sort();
  for (const pair of pairs) {
    const [service, role] = pair.split("|");
    const sel = `{service:${service},role:${role}}`;
    const n = (k) => metricValue(data, `${k}${sel}`, "count");
    lines.push(
      `${service.padEnd(9)}  ${role.padEnd(7)}  ${String(n("http_reqs")).padStart(8)}  ` +
      `${String(n("status_2xx")).padStart(4)}  ${String(n("status_4xx")).padStart(4)}  ` +
      `${String(n("status_429")).padStart(4)}  ${String(n("status_5xx")).padStart(4)}  ` +
      `${String(n("status_error")).padStart(3)}  ` +
      `${fmtMs(metricValue(data, `http_req_duration${sel}`, "p(95)")).padStart(8)}`
    );
  }
  lines.push("");
  lines.push("By service: " + SERVICES.map(s =>
    `${s}=${metricValue(data, `http_reqs{service:${s}}`, "count")} ` +
    `(p95 ${fmtMs(metricValue(data, `http_req_duration{service:${s}}`, "p(95)"))})`).join(", "));
  lines.push("By role:    " + ROLES.map(r =>
    `${r}=${metricValue(data, `http_reqs{role:${r}}`, "count")} ` +
    `(p95 ${fmtMs(metricValue(data, `http_req_duration{role:${r}}`, "p(95)"))})`).join(", "));
  return lines.join("\n") + "\n";
}
