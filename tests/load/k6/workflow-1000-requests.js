// SupportHub Group 12 - k6 WORKFLOW load test (~1,000 requests)
//
// Unlike test-a-1000-requests.js (read-only, AWS disabled), this test runs
// real Author, Editor and Reader WORKFLOWS with writes against the integrated
// Floci stack (infra/floci/docker-compose.supporthub.yml started with
// RATE_LIMIT_PROFILE=loadtest). Every request is tagged role=author|editor|
// reader|setup and endpoint=<name>, so the report answers
// "which load requests are Author requests and which are Editor requests?".
//
// Request budget (fixed iteration counts, so the total is ~1,000):
//   setup   11  CSRF + login for 2 authors, 2 editors, 1 reader, + categories
//   author 440  55 iterations x 8 requests (mine, create, edit, versions,
//               duplicates, get, submit, + 1 expected-denied editor action)
//   editor 300  60 iterations x 5 requests (queue, approve|reject, publish,
//               published list, + 1 expected-denied author action)
//   reader 250  50 iterations x 5 requests (search, view, click, vote,
//               + 1 expected-denied anonymous vote)
//
// Expected denials (403/401) are deliberate authorization checks; they are
// tagged expected=denied and are NOT counted as failures.
//
// Run (Docker, on the stack network):
//   docker run --rm --network supporthub-int-net -v "$PWD/tests/load/k6:/scripts" \
//     -e BASE_URL=http://frontend:8080 -e ORIGIN=http://localhost:8088 \
//     -e PASSWORD=<demo password> -e RESULT_DIR=/scripts/results \
//     grafana/k6 run /scripts/workflow-1000-requests.js

import http from "k6/http";
import { check, sleep } from "k6";
import exec from "k6/execution";
import { Counter, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:8088";
const ORIGIN = __ENV.ORIGIN || "http://localhost:8088";
const PASSWORD = __ENV.PASSWORD;
const ROLES = ["setup", "author", "editor", "reader"];

const roleReqs = {}, role2xx = {}, role4xx = {}, role5xx = {}, roleDenied = {}, roleFailed = {}, roleTime = {};
for (const r of ROLES) {
  roleReqs[r] = new Counter(`role_${r}_requests`);
  role2xx[r] = new Counter(`role_${r}_2xx`);
  role4xx[r] = new Counter(`role_${r}_4xx`);
  role5xx[r] = new Counter(`role_${r}_5xx`);
  roleDenied[r] = new Counter(`role_${r}_expected_denied`);
  roleFailed[r] = new Counter(`role_${r}_failed`);
  roleTime[r] = new Trend(`role_${r}_duration`, true);
}

const ENDPOINTS = [
  "auth_csrf", "auth_login",
  "articles_mine", "article_create", "article_edit", "article_versions", "article_duplicates", "article_get", "article_submit",
  "author_tries_review_queue",
  "reviews_queue", "review_decision", "publication", "editorial_published", "editor_tries_create_article",
  "public_search", "public_article", "search_click", "vote", "anonymous_vote"
];
const endpointThresholds = {};
for (const e of [...ENDPOINTS, "categories"]) {
  endpointThresholds[`http_req_duration{endpoint:${e}}`] = ["p(95)<60000"];
  endpointThresholds[`http_reqs{endpoint:${e}}`] = ["count>=0"];
}

export const options = {
  setupTimeout: "60s",
  scenarios: {
    authors: { executor: "shared-iterations", exec: "authorFlow", vus: 6, iterations: 55, maxDuration: "5m" },
    editors: { executor: "shared-iterations", exec: "editorFlow", vus: 2, iterations: 60, maxDuration: "5m", startTime: "3s" },
    readers: { executor: "shared-iterations", exec: "readerFlow", vus: 6, iterations: 50, maxDuration: "5m" }
  },
  thresholds: {
    ...endpointThresholds,
    http_req_failed: ["rate<0.02"],
    role_author_5xx: ["count<1"],
    role_editor_5xx: ["count<1"],
    role_reader_5xx: ["count<1"]
  },
  // Expected 401/403/409 responses are not transport failures.
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "max", "min"]
};
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 401, 403, 409));

function record(role, res, { expectDenied = false, accept = [] } = {}) {
  roleReqs[role].add(1);
  roleTime[role].add(res.timings.duration);
  const s = res.status;
  if (s >= 200 && s < 300) role2xx[role].add(1);
  else if (s >= 400 && s < 500) role4xx[role].add(1);
  else if (s >= 500 || s === 0) role5xx[role].add(1);
  const ok = expectDenied ? (s === 401 || s === 403) : ((s >= 200 && s < 300) || accept.includes(s));
  if (expectDenied && ok) roleDenied[role].add(1);
  if (!ok) roleFailed[role].add(1);
  return ok;
}

function call(role, endpoint, method, path, body, session, opts = {}) {
  const headers = { Origin: ORIGIN, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (session) {
    headers.Cookie = session.cookie;
    if (method !== "GET") headers["X-CSRF-Token"] = session.csrf;
  }
  const res = http.request(method, BASE + path, body === undefined ? null : JSON.stringify(body), {
    headers, tags: { role, endpoint, expected: opts.expectDenied ? "denied" : "success" }
  });
  const ok = record(role, res, opts);
  check(res, { [`${role} ${endpoint} ${opts.expectDenied ? "denied" : "ok"}`]: () => ok });
  return res;
}

function json(res) { try { return res.json(); } catch { return {}; } }

function login(email) {
  const jar = http.cookieJar();
  jar.clear(BASE);
  const c = http.get(`${BASE}/api/auth/csrf`, { headers: { Origin: ORIGIN }, tags: { role: "setup", endpoint: "auth_csrf" } });
  record("setup", c);
  const sid = (c.cookies["supporthub.sid"] || [])[0]?.value;
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email, password: PASSWORD }), {
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "X-CSRF-Token": json(c).csrfToken, Cookie: `supporthub.sid=${sid}` },
    tags: { role: "setup", endpoint: "auth_login" }
  });
  record("setup", res);
  const newSid = (res.cookies["supporthub.sid"] || [])[0]?.value;
  if (res.status !== 200 || !newSid) throw new Error(`login failed for ${email}: HTTP ${res.status}`);
  jar.clear(BASE);
  return { cookie: `supporthub.sid=${newSid}`, csrf: json(res).csrfToken, id: json(res).user.id };
}

export function setup() {
  if (!PASSWORD) throw new Error("PASSWORD is required");
  const sessions = {
    authors: [login("author@supporthub.test"), login("author2@supporthub.test")],
    editors: [login("editor@supporthub.test"), login("editor2@supporthub.test")],
    reader: login("admin@supporthub.test")
  };
  const catRes = http.get(`${BASE}/api/categories`, { tags: { role: "setup", endpoint: "categories" } });
  record("setup", catRes);
  const cats = json(catRes).categories || [];
  sessions.categoryIds = cats.map(c => c.id);
  return sessions;
}

const TOPICS = ["Reset your password", "Configure two-factor login", "Update billing card", "Router keeps disconnecting",
  "Install the desktop app", "Recover a deleted file", "Email not syncing on mobile", "Printer is offline"];

export function authorFlow(data) {
  http.cookieJar().clear(BASE);
  const i = exec.scenario.iterationInTest;
  const s = data.authors[i % 2];
  const categoryId = data.categoryIds[i % data.categoryIds.length];
  const topic = TOPICS[i % TOPICS.length];
  const title = `${topic} - k6 guide ${i} ${exec.vu.idInTest}`;
  const content = `Load test article ${i}. Step-by-step: ${topic.toLowerCase()}. Open settings, follow the steps, ` +
    `restart if needed and contact support if the problem continues.`;

  call("author", "articles_mine", "GET", "/api/articles/mine", undefined, s);
  const created = json(call("author", "article_create", "POST", "/api/articles", { title, content, categoryId }, s)).article;
  if (!created) return;
  call("author", "article_edit", "PATCH", `/api/articles/${created.id}`, { title, content: content + " Updated.", categoryId }, s);
  call("author", "article_versions", "GET", `/api/articles/${created.id}/versions`, undefined, s);
  call("author", "article_duplicates", "POST", "/api/articles/check-duplicates", { title, content, categoryId, excludeId: created.id }, s);
  call("author", "article_get", "GET", `/api/articles/${created.id}`, undefined, s);
  call("author", "article_submit", "POST", `/api/articles/${created.id}/submit`, undefined, s);
  // Authorization check: an author must not open the editorial queue.
  call("author", "author_tries_review_queue", "GET", "/api/reviews?status=pending", undefined, s, { expectDenied: true });
  sleep(0.2);
}

export function editorFlow(data) {
  http.cookieJar().clear(BASE);
  const vu = exec.vu.idInInstance;
  const i = exec.scenario.iterationInTest;
  // Editor VU 1 = editor@ (even article IDs), VU 2 = editor2@ (odd IDs):
  // disjoint slices of the queue, so the two editors never race.
  const slot = (vu - 1) % 2;
  const s = data.editors[slot];
  const queue = json(call("editor", "reviews_queue", "GET", "/api/reviews?status=pending", undefined, s)).reviews || [];
  const mine = queue.filter(r => Number(r.article_id) % 2 === slot);
  const review = mine[Math.floor(Math.random() * Math.max(mine.length, 1))];
  if (review) {
    const approve = Math.random() < 0.75;
    const decision = call("editor", "review_decision", "POST", `/api/articles/${review.article_id}/reviews`,
      { decision: approve ? "approved" : "rejected", comments: approve ? "Accurate and clear." : "Please add screenshots." },
      s, { accept: [409] });
    if (approve && decision.status === 201) {
      call("editor", "publication", "PATCH", `/api/articles/${review.article_id}/publication`, undefined, s, { accept: [409] });
    } else {
      call("editor", "editorial_published", "GET", "/api/editorial/published", undefined, s);
    }
  } else {
    call("editor", "editorial_published", "GET", "/api/editorial/published", undefined, s);
    call("editor", "editorial_published", "GET", "/api/editorial/published", undefined, s);
  }
  call("editor", "editorial_published", "GET", "/api/editorial/published", undefined, s);
  // Authorization check: an editor (not an author) must not create articles.
  call("editor", "editor_tries_create_article", "POST", "/api/articles",
    { title: "Editor should not create", content: "This must be rejected by the backend.", categoryId: data.categoryIds[0] },
    s, { expectDenied: true });
  sleep(0.5 + (vu % 2) * 0.1);
}

const QUERIES = ["password", "billing", "router", "printer", "email", "install", "two-factor", "recover", "nonexistent-topic-xyz"];

export function readerFlow(data) {
  http.cookieJar().clear(BASE);
  const i = exec.scenario.iterationInTest;
  const q = QUERIES[i % QUERIES.length];
  const found = json(call("reader", "public_search", "GET", `/api/public/articles?q=${encodeURIComponent(q)}`));
  const hit = (found.results || [])[0];
  const articleId = hit ? (hit.article_id ?? hit.id) : null;
  if (articleId) {
    call("reader", "public_article", "GET", `/api/public/articles/${articleId}`);
    call("reader", "search_click", "POST", "/api/public/search-clicks", { searchId: found.searchId, articleId });
    call("reader", "vote", "POST", `/api/articles/${articleId}/votes`, { helpful: i % 4 !== 0 }, data.reader);
    call("reader", "anonymous_vote", "POST", `/api/articles/${articleId}/votes`, { helpful: true }, null, { expectDenied: true });
  } else {
    call("reader", "public_search", "GET", "/api/public/articles?q=guide");
    call("reader", "public_search", "GET", "/api/public/articles?q=support");
    call("reader", "public_search", "GET", "/api/public/articles?q=account");
    call("reader", "public_search", "GET", "/api/public/articles?q=help");
  }
  sleep(0.2);
}

// ------------------------------------------------------------- reporting
function v(data, name, key = "count") { return data.metrics[name] ? data.metrics[name].values[key] : 0; }
const ms = x => (x === undefined || x === null ? "-" : `${x.toFixed(1)} ms`);

export function handleSummary(data) {
  const durationS = data.state.testRunDurationMs / 1000;
  const total = v(data, "http_reqs");
  const rows = ROLES.map(r => {
    const t = data.metrics[`role_${r}_duration`]?.values || {};
    const n = v(data, `role_${r}_requests`);
    return { role: r, n, ok2: v(data, `role_${r}_2xx`), c4: v(data, `role_${r}_4xx`), c5: v(data, `role_${r}_5xx`),
      denied: v(data, `role_${r}_expected_denied`), failed: v(data, `role_${r}_failed`),
      avg: t.avg, med: t.med, p90: t["p(90)"], p95: t["p(95)"], max: t.max };
  });
  const sum = k => rows.reduce((a, r) => a + r[k], 0);
  const d = data.metrics.http_req_duration.values;
  let text = `SupportHub k6 WORKFLOW load test - ${new Date().toISOString()}\n`;
  text += `Target: ${BASE} (integrated Floci stack, RATE_LIMIT_PROFILE=loadtest)\n`;
  text += `Duration: ${durationS.toFixed(1)} s   Peak VUs: 14 (6 author, 2 editor, 6 reader)   Throughput: ${(total / durationS).toFixed(1)} req/s\n\n`;
  text += `| Metric | Result |\n|---|---|\n`;
  text += `| Total requests | ${total} |\n`;
  for (const r of rows) text += `| ${r.role[0].toUpperCase() + r.role.slice(1)} requests | ${r.n} |\n`;
  text += `| Successful (2xx + expected denials + tolerated 409) | ${total - sum("failed")} |\n`;
  text += `| Failed (unexpected status) | ${sum("failed")} |\n`;
  text += `| HTTP 2xx | ${sum("ok2")} |\n| HTTP 4xx | ${sum("c4")} (of which expected authorization denials: ${sum("denied")}) |\n| HTTP 5xx | ${sum("c5")} |\n`;
  text += `| Average response time | ${ms(d.avg)} |\n| Median response time | ${ms(d.med)} |\n| P90 | ${ms(d["p(90)"])} |\n| P95 | ${ms(d["p(95)"])} |\n| Max | ${ms(d.max)} |\n`;
  text += `| Throughput | ${(total / durationS).toFixed(1)} req/s |\n| Error rate (unexpected) | ${((sum("failed") / Math.max(total, 1)) * 100).toFixed(2)} % |\n`;
  text += `| k6 http_req_failed rate | ${(v(data, "http_req_failed", "rate") * 100).toFixed(2)} % |\n\n`;
  text += `Per role:\n| Role | Requests | 2xx | 4xx | expected denials | 5xx | failed | avg | median | p90 | p95 | max |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of rows) text += `| ${r.role} | ${r.n} | ${r.ok2} | ${r.c4} | ${r.denied} | ${r.c5} | ${r.failed} | ${ms(r.avg)} | ${ms(r.med)} | ${ms(r.p90)} | ${ms(r.p95)} | ${ms(r.max)} |\n`;
  text += `\nPer endpoint:\n| Endpoint | Requests | avg | p95 |\n|---|---|---|---|\n`;
  for (const e of [...ENDPOINTS, "categories"]) {
    const m = data.metrics[`http_req_duration{endpoint:${e}}`];
    if (!m) continue;
    const count = Object.keys(data.metrics).includes(`http_reqs{endpoint:${e}}`) ? v(data, `http_reqs{endpoint:${e}}`) : "";
    text += `| ${e} | ${count} | ${ms(m.values.avg)} | ${ms(m.values["p(95)"])} |\n`;
  }
  text += `\nChecks: ${v(data, "checks", "passes")} passed, ${v(data, "checks", "fails")} failed\n`;
  const out = { stdout: text };
  if (__ENV.RESULT_DIR) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    out[`${__ENV.RESULT_DIR}/workflow-${stamp}-summary.md`] = text;
    out[`${__ENV.RESULT_DIR}/workflow-${stamp}-summary.json`] = JSON.stringify(data, null, 2);
  }
  return out;
}
