// SupportHub Group 12 - TEST A: exactly 1,000 HTTP requests in total
// (isolated local stack only)
//
// Total = 4 setup requests + 996 test requests = 1,000 HTTP requests:
//   setup: 2 x GET /api/auth/csrf + 2 x POST /api/auth/login
//          (one synthetic author session + one synthetic editor session;
//           login limit stays fixed at 30 per 15 minutes)
//   test:  50 virtual users share 996 iterations; each iteration sends
//          exactly ONE request chosen from the weighted endpoint mix
//          (public, author, editor across Identity, Article, Editorial
//          and Search & Analytics).
//
// Stops immediately (abortOnFail) if any HTTP 5xx is recorded.
//
// Run:  k6 run tests/load/k6/test-a-1000-requests.js
// Optional: RESULT_PREFIX=<path prefix> to save summary files.

import { pickWeighted, loginAll, call, breakdownThresholds, breakdownText } from "./lib/supporthub.js";

const SETUP_REQUESTS = 4;
const TEST_REQUESTS = 996;
const EXPECTED_TOTAL = SETUP_REQUESTS + TEST_REQUESTS; // 1,000

export const options = {
  scenarios: {
    test_a_1000_requests: {
      executor: "shared-iterations",
      vus: 50,
      iterations: TEST_REQUESTS,
      maxDuration: "5m"
    }
  },
  thresholds: {
    ...breakdownThresholds(),
    status_5xx: [{ threshold: "count<1", abortOnFail: true }],
    http_req_failed: ["rate<0.01"],
    "http_req_duration{role:public}": ["p(95)<2000"]
  }
};

export function setup() {
  return loginAll(); // exactly 4 HTTP requests
}

export default function (sessions) {
  call(pickWeighted(), sessions); // exactly 1 HTTP request per iteration
}

export function handleSummary(data) {
  const total = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  const verdict = total === EXPECTED_TOTAL
    ? `Request count check: PASS (${total} = ${SETUP_REQUESTS} setup + ${TEST_REQUESTS} test)\n`
    : `Request count check: FAIL (${total} recorded, expected ${EXPECTED_TOTAL}; run may have been aborted)\n`;
  const text = breakdownText(data, "SupportHub Test A - 1,000 total HTTP requests, 50 VUs (isolated local stack)") + verdict;
  const out = { stdout: text };
  if (__ENV.RESULT_PREFIX) {
    out[`${__ENV.RESULT_PREFIX}-summary.txt`] = text;
    out[`${__ENV.RESULT_PREFIX}-summary.json`] = JSON.stringify(data, null, 2);
  }
  return out;
}
