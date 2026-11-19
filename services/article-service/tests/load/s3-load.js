
"use strict";
const BASE = "http://127.0.0.1:3005";
const COUNT = 25;


// Receive the first author's session cookie
// through standard input, not source code.
async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  const cookie = Buffer.concat(chunks)
    .toString("utf8")
    .trim();

  if (!cookie.startsWith("supporthub.sid=")) {
    throw new Error("A valid session cookie is required");
  }

  const results = await Promise.all(
    Array.from({ length: COUNT }, async () => {
      const start = performance.now();

      try {
        const response = await fetch(
          `${BASE}/api/articles/6/versions/14/export`,
          {
            headers: { Cookie: cookie },
            signal: AbortSignal.timeout(15000)
          }
        );

        await response.arrayBuffer();

        return {
          status: response.status,
          ms: performance.now() - start
        };
      } catch {
        return {
          status: "ERROR",
          ms: performance.now() - start
        };
      }
    })
  );

  const times = results
    .map(r => r.ms)
    .sort((a, b) => a - b);

  const success = results.filter(
    r => r.status === 200
  ).length;

  console.log("\nARTICLE SERVICE LOAD SIMULATION");
  console.log("Concurrent requests:", COUNT);
  console.log("HTTP 200:", success);
  console.log("HTTP 401:", results.filter(r => r.status === 401).length);
  console.log("HTTP 429:", results.filter(r => r.status === 429).length);
  console.log("Other failures:", COUNT - success -
    results.filter(r => r.status === 401 || r.status === 429).length);
  console.log(
    "Average latency:",
    (times.reduce((a, b) => a + b, 0) / COUNT).toFixed(2),
    "ms"
  );
  console.log(
    "P95 latency:",
    times[Math.ceil(COUNT * 0.95) - 1].toFixed(2),
    "ms"
  );
}

main().catch(error => {
  console.error("SIMULATION ERROR:", error.message);
  process.exitCode = 1;
});

