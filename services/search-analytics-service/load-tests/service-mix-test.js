// SupportHub Search & Analytics — mixed load test (k6)
// Realistic mix on ONE service: 70% search, 15% open article (view), 10% author votes, 5% editor analytics.
// Logs in once as the author and the editor through the local Identity service, then shares the sessions.
// Run (passwords come from environment variables, never written in this file):
//   k6 run -e BASE_URL=http://localhost:3014 -e IDENTITY_URL=http://localhost:3006 \
//          -e AUTHOR_PW=... -e EDITOR_PW=... load-tests/service-mix-test.js
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3014";
const IDENT = __ENV.IDENTITY_URL || "http://localhost:3006";
const ORIGIN = __ENV.ORIGIN || "http://127.0.0.1:8080";
const ARTICLE = __ENV.ARTICLE_ID || "1";
const rateLimited = new Counter("rate_limited_429");

export const options = {
  stages: [
    { duration: "30s", target: 250 },
    { duration: "30s", target: 500 },
    { duration: "30s", target: 1000 },
    { duration: "60s", target: 1000 },
    { duration: "15s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{action:search}": ["p(95)<800"],
    "http_req_duration{action:view}": ["p(95)<800"],
    "http_req_duration{action:vote}": ["p(95)<800"],
    "http_req_duration{action:analytics}": ["p(95)<1500"],
  },
};

function login(email, password) {
  const jar = http.cookieJar();
  jar.clear(IDENT);
  let csrf = http.get(`${IDENT}/api/auth/csrf`).json("csrfToken");
  const res = http.post(`${IDENT}/api/auth/login`, JSON.stringify({ email, password }), {
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-CSRF-Token": csrf },
  });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: HTTP ${res.status}`);
  csrf = http.get(`${IDENT}/api/auth/csrf`).json("csrfToken");
  const cookie = jar.cookiesForURL(IDENT)["supporthub.sid"][0];
  return { cookie: `supporthub.sid=${cookie}`, csrf };
}

export function setup() {
  return {
    author: login("supporthub.nermeen.author@example.com", __ENV.AUTHOR_PW),
    editor: login("supporthub.nermeen.editor@example.com", __ENV.EDITOR_PW),
  };
}

const words = ["password", "login", "account", "router", "email", "billing", "reset", "3bac7db5"];

export default function (data) {
  const r = Math.random();
  let res;
  if (r < 0.70) {
    const q = words[Math.floor(Math.random() * words.length)];
    res = http.get(`${BASE}/api/public/articles?q=${q}`, { tags: { action: "search" } });
    check(res, { "search 200": (x) => x.status === 200 });
  } else if (r < 0.85) {
    res = http.get(`${BASE}/api/public/articles/${ARTICLE}`, { tags: { action: "view" } });
    check(res, { "view 200": (x) => x.status === 200 });
  } else if (r < 0.95) {
    res = http.post(`${BASE}/api/articles/${ARTICLE}/votes`, JSON.stringify({ helpful: Math.random() < 0.5 }), {
      headers: { "Content-Type": "application/json", Origin: ORIGIN,
                 "X-CSRF-Token": data.author.csrf, Cookie: data.author.cookie },
      tags: { action: "vote" },
    });
    check(res, { "vote 200": (x) => x.status === 200 });
  } else {
    res = http.get(`${BASE}/api/analytics/overview`, {
      headers: { Cookie: data.editor.cookie }, tags: { action: "analytics" },
    });
    check(res, { "analytics 200": (x) => x.status === 200 });
  }
  if (res.status === 429) rateLimited.add(1);
  sleep(1);
}