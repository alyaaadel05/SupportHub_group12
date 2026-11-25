
"use strict";

const BASE = "http://127.0.0.1:3006";
const ORIGIN = "http://127.0.0.1:8080";
const EMAIL = "alyaa.supporthub.test@example.com";
const COUNT = 10;

async function runLogin(password) {
  const start = performance.now();

  try {
    // Each simulated browser gets its own session.
    const csrfResponse = await fetch(`${BASE}/api/auth/csrf`, {
      signal: AbortSignal.timeout(15000)
    });

    if (!csrfResponse.ok) {
      return {
        status: csrfResponse.status,
        session: false,
        ms: performance.now() - start
      };
    }

    const { csrfToken } = await csrfResponse.json();
    const initialCookie =
      csrfResponse.headers.get("set-cookie")?.split(";")[0];

    if (!initialCookie || !csrfToken) {
      throw new Error("Missing initial session or CSRF token");
    }

    // Simulate a real login request.
    const response = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGIN,
        "X-CSRF-Token": csrfToken,
        Cookie: initialCookie
      },
      body: JSON.stringify({
        email: EMAIL,
        password
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (response.status !== 200) {
      return {
        status: response.status,
        session: false,
        ms: performance.now() - start
      };
    }

    // Login regenerates the session cookie.
    const newCookie =
      response.headers.get("set-cookie")?.split(";")[0];

    if (!newCookie) {
      throw new Error("Login session cookie missing");
    }

    // Check that the new session is authenticated.
    const meResponse = await fetch(`${BASE}/api/auth/me`, {
      headers: { Cookie: newCookie },
      signal: AbortSignal.timeout(15000)
    });

    return {
      status: response.status,
      session: meResponse.status === 200,
      ms: performance.now() - start
    };

  } catch (error) {
    return {
      status: "ERROR",
      session: false,
      ms: performance.now() - start
    };
  }
}

async function main() {
  const chunks = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  const password = Buffer.concat(chunks)
    .toString("utf8")
    .replace(/[\r\n]+$/, "");

  if (!password) {
    throw new Error("Test password required");
  }

  const results = await Promise.all(
    Array.from({ length: COUNT }, () => runLogin(password))
  );

  const times = results.map(r => r.ms).sort((a, b) => a - b);
  const count = status =>
    results.filter(r => r.status === status).length;

  console.log("\nSUPPORTHUB CONCURRENT LOGIN SIMULATION");
  console.log("Concurrent sessions:", COUNT);
  console.log("Successful logins:", count(200));
  console.log("Authenticated sessions:",
    results.filter(r => r.session).length);
  console.log("HTTP 401:", count(401));
  console.log("HTTP 403:", count(403));
  console.log("HTTP 429:", count(429));
  console.log("Other errors:",
    results.filter(r =>
      ![200, 401, 403, 429].includes(r.status)
    ).length);
  console.log("Average latency:",
    (times.reduce((a, b) => a + b, 0) / COUNT).toFixed(2), "ms");
  console.log("P95 latency:",
    times[Math.ceil(COUNT * 0.95) - 1].toFixed(2), "ms");
}

main().catch(error => {
  console.error("SIMULATION ERROR:", error.message);
  process.exitCode = 1;
});
