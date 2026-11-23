// SupportHub Group 12 - TEST B: up to 1,000 concurrent users
// (isolated local stack only)
//
// Ramps in steps: 0 -> 250 -> 500 -> 1,000 virtual users, holding each level.
// Each user sends one request from the weighted endpoint mix (public, author,
// editor across Identity, Article, Editorial and Search & Analytics), then
// pauses 1-3 s like a real visitor.
//
// Setup: 4 HTTP requests (2 x CSRF + 2 x login) for one synthetic author and
// one synthetic editor session, shared by all users. The Identity login
// limit stays fixed at 30 per 15 minutes.
//
// 5xx policy (Option 1): the test does NOT stop on the first 5xx. Every 5xx
// is counted by service, role and load level. Safety stops (after a 30 s
// warm-up, evaluated over the whole run so far):
//   - 5xx responses above 5%
//   - failed requests above 20%
//   - p95 latency above 10 s
//
// Run:  k6 run tests/load/k6/test-b-1000-concurrent-users.js
// Optional: RESULT_PREFIX=<path prefix> to save summary files.

import { sleep } from "k6";
import exec from "k6/execution";
import { Rate } from "k6/metrics";
import { pickWeighted, loginAll, call, breakdownThresholds, breakdownText } from "./lib/supporthub.js";

const rate5xx = new Rate("rate_5xx");

// Load levels, used to label every request with the level it was sent at.
const STAGES = [
  { duration: "1m", target: 250 },   // ramp to 250
  { duration: "1m", target: 250 },   // hold 250
  { duration: "1m", target: 500 },   // ramp to 500
  { duration: "1m", target: 500 },   // hold 500
  { duration: "1m", target: 1000 },  // ramp to 1,000
  { duration: "2m", target: 1000 },  // hold 1,000
  { duration: "30s", target: 0 }     // ramp down
];
const LEVELS = ["ramp-250", "hold-250", "ramp-500", "hold-500", "ramp-1000", "hold-1000", "ramp-down"];
const STAGE_END_MS = [60, 120, 180, 240, 300, 420, 450].map(s => s * 1000);

function levelAt(elapsedMs) {
  const i = STAGE_END_MS.findIndex(end => elapsedMs < end);
  return LEVELS[i === -1 ? LEVELS.length - 1 : i];
}

function levelThresholds() {
  const t = {};
  for (const level of LEVELS) {
    t[`http_reqs{level:${level}}`] = ["count>=0"];
    t[`http_req_duration{level:${level}}`] = ["max>=0"];
    t[`status_5xx{level:${level}}`] = ["count>=0"];
    t[`http_req_failed{level:${level}}`] = ["rate>=0"];
  }
  return t;
}

export const options = {
  scenarios: {
    test_b_1000_users: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: STAGES,
      gracefulRampDown: "30s"
    }
  },
  thresholds: {
    ...breakdownThresholds(),
    ...levelThresholds(),
    rate_5xx: [{ threshold: "rate<0.05", abortOnFail: true, delayAbortEval: "30s" }],
    http_req_failed: [{ threshold: "rate<0.20", abortOnFail: true, delayAbortEval: "30s" }],
    http_req_duration: [{ threshold: "p(95)<10000", abortOnFail: true, delayAbortEval: "30s" }]
  }
};

export function setup() {
  return loginAll(); // exactly 4 HTTP requests
}

export default function (sessions) {
  // Label all metrics from this request with the current load level.
  exec.vu.tags.level = levelAt(exec.instance.currentTestRunDuration);

  const res = call(pickWeighted(), sessions); // 1 request per iteration
  rate5xx.add(res.status >= 500);

  sleep(1 + Math.random() * 2); // 1-3 s think time
}

function v(data, name, field) {
  const m = data.metrics[name];
  return m && m.values && m.values[field] !== undefined ? m.values[field] : 0;
}

export function handleSummary(data) {
  const lines = [];
  lines.push("");
  lines.push("By load level:");
  lines.push("Level       Requests   5xx   Failed%    p95");
  lines.push("----------  --------  ----  -------  --------");
  for (const level of LEVELS) {
    const sel = `{level:${level}}`;
    lines.push(
      `${level.padEnd(10)}  ${String(v(data, `http_reqs${sel}`, "count")).padStart(8)}  ` +
      `${String(v(data, `status_5xx${sel}`, "count")).padStart(4)}  ` +
      `${(v(data, `http_req_failed${sel}`, "rate") * 100).toFixed(2).padStart(6)}%  ` +
      `${(Math.round(v(data, `http_req_duration${sel}`, "p(95)")) + " ms").padStart(8)}`
    );
  }
  lines.push("");
  lines.push(`Peak concurrent virtual users: ${v(data, "vus_max", "max")}`);
  lines.push(`Overall 5xx rate: ${(v(data, "rate_5xx", "rate") * 100).toFixed(2)}%`);

  const text = breakdownText(data, "SupportHub Test B - up to 1,000 concurrent users (isolated local stack)") +
               lines.join("\n") + "\n";
  const out = { stdout: text };
  if (__ENV.RESULT_PREFIX) {
    out[`${__ENV.RESULT_PREFIX}-summary.txt`] = text;
    out[`${__ENV.RESULT_PREFIX}-summary.json`] = JSON.stringify(data, null, 2);
  }
  return out;
}
