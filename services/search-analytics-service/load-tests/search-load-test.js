// SupportHub - Search & Analytics Service load test (k6)
// Tests the PUBLIC search endpoint only (no login needed).
//
// How to run (from the search-analytics-service folder):
//   k6 run -e PROFILE=low      load-tests/search-load-test.js
//   k6 run -e PROFILE=moderate load-tests/search-load-test.js
//   k6 run -e PROFILE=high     load-tests/search-load-test.js

import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3004";

// Traffic levels: number of virtual users (people) and how long.
const profiles = {
  low:      { vus: 5,   duration: "30s" },
  moderate: { vus: 25,  duration: "1m"  },
  high:     { vus: 100, duration: "1m"  },
};
const profile = profiles[__ENV.PROFILE] || profiles.low;

export const options = {
  vus: profile.vus,
  duration: profile.duration,
  thresholds: {
    http_req_failed:   ["rate<0.01"],  // less than 1% errors
    http_req_duration: ["p(95)<800"],  // 95% of requests under 800 ms
  },
};

// Example search words readers might type.
const keywords = ["password", "login", "account", "router", "email", "billing"];

export default function () {
  const q = keywords[Math.floor(Math.random() * keywords.length)];
  const res = http.get(`${BASE_URL}/api/public/articles?q=${q}&page=1`);

  check(res, {
    "search returned 200": (r) => r.status === 200,
  });

  sleep(1); // each user waits 1 second between searches
}