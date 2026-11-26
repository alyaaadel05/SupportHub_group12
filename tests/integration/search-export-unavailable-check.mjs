// SupportHub Group 12 - Search & Analytics: CSV export behaviour when the S3
// endpoint is unreachable (the situation of a Vercel deployment pointed at a
// local-only Floci). ISOLATED stack only: briefly stops supporthub-iso-floci.
//
//   node tests/integration/search-export-unavailable-check.mjs
//
// Bounded: every child process and HTTP call has a timeout. No secrets printed.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = "http://localhost:8188";
const FLOCI = "http://localhost:4567";
const PASSWORD = fs.readFileSync(path.join(ROOT, "infra/floci/.generated/isolated/demo-accounts.txt"), "utf8").match(/^password=(.+)$/m)[1].trim();
let pass = 0, fail = 0; const lines = [];
const log = t => { lines.push(t); console.log(t); };
const check = (n, ok, d = "") => { ok ? pass++ : fail++; log(`${ok ? "PASS" : "FAIL"} | ${n}${d ? " | " + d : ""}`); };
const docker = (...a) => { try { return execFileSync("docker", a, { encoding: "utf8", timeout: 60000 }).trim(); } catch (e) { return `ERR ${e.message.split("\n")[0]}`; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (!docker("port", "supporthub-iso-floci", "4566").includes("4567")) throw new Error("isolated Floci not on 4567");

let cookie = "", csrf = "";
async function req(method, url, body) {
  const h = { Accept: "application/json", Origin: BASE };
  if (cookie) h.Cookie = cookie;
  if (csrf && method !== "GET") h["X-CSRF-Token"] = csrf;
  if (body !== undefined) h["Content-Type"] = "application/json";
  const r = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  for (const c of r.headers.getSetCookie?.() || []) if (c.startsWith("supporthub.sid=")) cookie = c.split(";")[0];
  let data = {}; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
log(`Search CSV export with unreachable S3 - ${new Date().toISOString()}`);
csrf = (await req("GET", "/api/auth/csrf")).data.csrfToken;
const login = await req("POST", "/api/auth/login", { email: "editor@supporthub.test", password: PASSWORD });
if (login.data.csrfToken) csrf = login.data.csrfToken;
check("editor login (isolated)", login.status === 200, `HTTP ${login.status}`);

let r = await req("POST", "/api/analytics/exports");
check("control: export works while Floci S3 is reachable", r.status === 201, `HTTP ${r.status} ${r.data.name || r.data.error || ""}`);

log(`     ${new Date().toISOString()} docker stop supporthub-iso-floci -> ${docker("stop", "-t", "5", "supporthub-iso-floci")}`);
try {
  await sleep(2000);
  r = await req("POST", "/api/analytics/exports");
  check("export with S3 unreachable -> 503 with a clear, safe message (not a generic 500)", r.status === 503 && /export storage/i.test(r.data.error || ""), `HTTP ${r.status} ${JSON.stringify(r.data)}`);
  check("no internal details (hostname / SDK error) leaked", !/floci|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|getaddrinfo/i.test(JSON.stringify(r.data)));
  r = await req("GET", "/api/analytics/exports");
  check("list exports with S3 unreachable -> 503 safe message", r.status === 503 && /export storage/i.test(r.data.error || ""), `HTTP ${r.status} ${JSON.stringify(r.data)}`);
  r = await req("GET", "/api/analytics/overview");
  check("analytics overview (PostgreSQL) still works during the S3 outage", r.status === 200, `HTTP ${r.status}`);
} finally {
  log(`     ${new Date().toISOString()} docker start supporthub-iso-floci -> ${docker("start", "supporthub-iso-floci")}`);
  for (let i = 0; i < 30; i++) { try { if ((await fetch(`${FLOCI}/_floci/health`, { signal: AbortSignal.timeout(3000) })).ok) break; } catch {} await sleep(2000); }
}
await sleep(3000);
r = await req("POST", "/api/analytics/exports");
check("recovery: export works again after S3 is back", r.status === 201, `HTTP ${r.status} ${r.data.name || r.data.error || ""}`);
log(`Total: ${pass} passed, ${fail} failed`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, lines.join("\n") + "\n");
process.exitCode = fail ? 1 : 0;
