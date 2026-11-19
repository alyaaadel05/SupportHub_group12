"use strict";

const assert = require("node:assert/strict");

const BASE = "http://127.0.0.1:3005";
const URL = `${BASE}/api/articles/6/versions/14/export`;

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  const cookie = Buffer.concat(chunks).toString("utf8").trim();

  assert.ok(
    cookie.startsWith("supporthub.sid="),
    "A test login session cookie is required"
  );

  const health = await fetch(`${BASE}/api/health`, {
    signal: AbortSignal.timeout(15000)
  });

  assert.equal(health.status, 200);
  console.log("1. DOCKER ARTICLE HEALTH: PASS");

  const unauthorized = await fetch(URL, {
    signal: AbortSignal.timeout(15000)
  });

  assert.equal(unauthorized.status, 401);
  console.log("2. UNAUTHENTICATED BACKUP ACCESS DENIED: PASS");

  const authorized = await fetch(URL, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(15000)
  });

  assert.equal(authorized.status, 200);
const responseBody = await authorized.json();
const backup = responseBody.backup;
console.log("Response keys:", Object.keys(backup));

for (const key of Object.keys(backup)) {
  if (backup[key] && typeof backup[key] === "object") {
    console.log(`${key} keys:`, Object.keys(backup[key]));
  }
}

  assert.equal(String(backup.articleId), "6");
  assert.equal(String(backup.versionId), "14");

  console.log("3. AUTHENTICATED FLOCI S3 RETRIEVAL: PASS");
  console.log("4. BACKUP ARTICLE/VERSION VALIDATION: PASS");
  console.log("LIVE FLOCI INTEGRATION: PASS");
}

main().catch(error => {
  console.error("LIVE FLOCI INTEGRATION: FAILED");
  console.error(error.message);
  process.exitCode = 1;
});
