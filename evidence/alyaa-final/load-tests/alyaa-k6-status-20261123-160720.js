import http from "k6/http";
import { Counter } from "k6/metrics";
import exec from "k6/execution";

const ok = new Counter("status_200");
const limited = new Counter("status_429");
const serverErrors = new Counter("status_5xx");
const other = new Counter("status_other");
const networkErrors = new Counter("network_errors");

export const options = {
  scenarios: {
    diagnostic: {
      executor: "shared-iterations",
      vus: 5,
      iterations: 100,
      maxDuration: "2m"
    }
  },
  thresholds: {
    status_5xx: ["count==0"],
    network_errors: ["count==0"],
    status_other: ["count==0"]
  }
};

export default function () {
  const n = exec.scenario.iterationInTest;
  const service = n % 2 === 0 ? "Article" : "Identity";

  const url = service === "Article"
    ? "http://127.0.0.1:3005/api/health"
    : "http://127.0.0.1:3006/api/health";

  const response = http.get(url, {
    timeout: "10s",
    tags: { service }
  });

  const tags = { service };

  if (response.status === 200) {
    ok.add(1, tags);
  } else if (response.status === 429) {
    limited.add(1, tags);
  } else if (response.status >= 500) {
    serverErrors.add(1, tags);
  } else if (response.status === 0) {
    networkErrors.add(1, tags);
  } else {
    other.add(1, tags);
  }
}