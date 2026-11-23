// SupportHub Group 12 - SMOKE TEST (isolated local stack only)
// 1 virtual user calls every catalogued endpoint exactly once:
// public, author and editor requests across Identity, Article,
// Editorial and Search & Analytics. Every request must return HTTP 200.
//
// Run:  k6 run tests/load/k6/smoke.js
// Optional: RESULT_PREFIX=<path prefix> to save summary files.

import { ENDPOINTS, loginAll, call, breakdownThresholds, breakdownText } from "./lib/supporthub.js";

export const options = {
  scenarios: {
    smoke: { executor: "per-vu-iterations", vus: 1, iterations: 1, maxDuration: "2m" }
  },
  thresholds: {
    checks: ["rate==1"],
    http_req_failed: ["rate==0"],
    ...breakdownThresholds()
  }
};

export function setup() {
  return loginAll();
}

export default function (sessions) {
  for (const endpoint of ENDPOINTS) {
    const res = call(endpoint, sessions);
    console.log(`${String(res.status).padStart(3)}  ${endpoint.role.padEnd(6)}  ${endpoint.service.padEnd(9)}  ${endpoint.name}  (${Math.round(res.timings.duration)} ms)`);
  }
}

export function handleSummary(data) {
  const text = breakdownText(data, "SupportHub smoke test (isolated local stack)");
  const out = { stdout: text };
  if (__ENV.RESULT_PREFIX) {
    out[`${__ENV.RESULT_PREFIX}-summary.txt`] = text;
    out[`${__ENV.RESULT_PREFIX}-summary.json`] = JSON.stringify(data, null, 2);
  }
  return out;
}
