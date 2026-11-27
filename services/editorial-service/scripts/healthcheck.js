"use strict";

// Container health check for the Editorial API (Docker HEALTHCHECK / Compose).
// Healthy only when GET /api/health answers 200 with {"status":"ok"}, which
// means the API is running AND its database answered SELECT 1.
// Exit code 0 = healthy, 1 = unhealthy (the reason is printed for
// `docker inspect`). The workers share this image but run no HTTP server,
// so the check is set per service in Compose, not in the Dockerfile.

const DEFAULT_TIMEOUT_MS = 3000;

async function checkHealth({
  url = `http://127.0.0.1:${process.env.PORT || 3002}/api/health`,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch
} = {}) {
  let response;

  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    return { healthy: false, reason: `no response (${error.name})` };
  }

  if (response.status !== 200) {
    return { healthy: false, reason: `HTTP ${response.status}` };
  }

  const body = await response.json().catch(() => null);

  if (body?.status !== "ok") {
    return { healthy: false, reason: "unexpected health response" };
  }

  return { healthy: true, reason: "ok" };
}

if (require.main === module) {
  checkHealth().then(result => {
    console.log(`editorial health: ${result.reason}`);
    process.exit(result.healthy ? 0 : 1);
  });
}

module.exports = { checkHealth };
