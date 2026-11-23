import http from "k6/http";
import { check } from "k6";
import exec from "k6/execution";

export const options = {
  scenarios: {
    smoke: {
      executor: "shared-iterations",
      vus: 2,
      iterations: 10,
      maxDuration: "30s"
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    checks: ["rate==1"]
  }
};

export default function () {
  const n = exec.scenario.iterationInTest;
  const service = n % 2 === 0 ? "Article" : "Identity";

  const url = service === "Article"
    ? "http://127.0.0.1:3005/api/health"
    : "http://127.0.0.1:3006/api/health";

  const response = http.get(url, {
    tags: { service }
  });

  check(response, {
    "HTTP 200": r => r.status === 200,
    "Health OK": r => {
      try {
        return JSON.parse(r.body).status === "ok";
      } catch (_) {
        return false;
      }
    }
  });
}