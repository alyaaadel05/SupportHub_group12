
const { performance } = require("node:perf_hooks");

const URL = "http://127.0.0.1:3006/api/health";
const TOTAL = 100;
const CONCURRENCY = 10;

async function run() {
  let next = 0;
  const results = [];
  const started = performance.now();

  async function worker() {
    while (next < TOTAL) {
      next++;
      const begin = performance.now();

      try {
        const response = await fetch(URL, {
          signal: AbortSignal.timeout(10000)
        });

        results.push({
          ok: response.ok,
          ms: performance.now() - begin
        });
      } catch (error) {
        results.push({
          ok: false,
          ms: performance.now() - begin,
          error: error.message
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: CONCURRENCY }, () => worker())
  );

  const elapsed = (performance.now() - started) / 1000;
  const durations = results
    .map(r => r.ms)
    .sort((a, b) => a - b);

  const percentile = p =>
    durations[Math.ceil(p * durations.length) - 1].toFixed(2);

  const passed = results.filter(r => r.ok).length;

  console.log("\n=== IDENTITY LOAD TEST ===");
  console.log("Total requests:", TOTAL);
  console.log("Concurrency:", CONCURRENCY);
  console.log("Successful:", passed);
  console.log("Failed:", TOTAL - passed);
  console.log("Average latency (ms):",
    (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2));
  console.log("P95 latency (ms):", percentile(0.95));
  console.log("Throughput (req/s):", (TOTAL / elapsed).toFixed(2));
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

