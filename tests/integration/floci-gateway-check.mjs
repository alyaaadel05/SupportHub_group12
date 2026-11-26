// SupportHub Group 12 - runs the REAL Cloudflare Worker code
// (infra/cloudflare/floci-gateway/src/index.js) locally in Node, with the Workers
// VPC binding replaced by a fetch to the ISOLATED Floci (127.0.0.1:4567), and drives
// it with the REAL Search and Article AWS SDK clients (their own IAM keys).
//
//   node tests/integration/floci-gateway-check.mjs
//
// Throwaway random gateway secret per run; nothing secret is printed.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { handle } = await import(pathToFileURL(path.join(ROOT, "infra/cloudflare/floci-gateway/src/index.js")).href);
const FLOCI = "http://127.0.0.1:4567";
const keyId = f => (fs.readFileSync(path.join(ROOT, "infra/floci/.generated/isolated", f), "utf8").match(/^AWS_ACCESS_KEY_ID=(.+)$/m) || [])[1].trim();
const env = {
  ALLOWED_ACCESS_KEY_IDS: [keyId("search.aws.env"), keyId("article.aws.env")].join(","),
  GATEWAY_CLIENT_ID: crypto.randomBytes(16).toString("hex") + ".gw",
  GATEWAY_CLIENT_SECRET: crypto.randomBytes(32).toString("hex"),
  FLOCI: { fetch: req => { const u = new URL(req.url); return fetch(FLOCI + u.pathname + u.search, { method: req.method, headers: req.headers, body: req.body, duplex: "half", redirect: "manual" }); } }
};
let pass = 0, fail = 0, forwarded = 0, denied = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${n}${d ? " | " + d : ""}`); };

const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const request = new Request(`http://gateway.local${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
  const r = await handle(request, env);
  r.status === 403 ? denied++ : forwarded++;
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const GW = `http://127.0.0.1:${server.address().port}`;
console.log(`Worker code under test: infra/cloudflare/floci-gateway/src/index.js ; local gateway ${GW} -> isolated Floci ${FLOCI}`);

const keys = f => Object.fromEntries([...fs.readFileSync(path.join(ROOT, "infra/floci/.generated/isolated", f), "utf8").matchAll(/^(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)=(.+)$/gm)].map(m => [m[1], m[2].trim()]));
function load(service, mod, extraEnv) {
  // Fresh module instance with the given environment (clients read env at load time).
  const req = createRequire(path.join(ROOT, `services/${service}/package.json`));
  for (const k of Object.keys(req.cache)) if (k.includes(path.join("services", service)) && !k.includes("node_modules")) delete req.cache[k];
  const saved = { ...process.env };
  Object.assign(process.env, { AWS_REGION: "us-east-1", AWS_ENDPOINT_URL: GW }, extraEnv);
  try { return { m: req(path.join(ROOT, `services/${service}/${mod}`)), req }; } finally { process.env = saved; }
}
const token = { FLOCI_ACCESS_CLIENT_ID: env.GATEWAY_CLIENT_ID, FLOCI_ACCESS_CLIENT_SECRET: env.GATEWAY_CLIENT_SECRET };

// --- Search (Nermeen): DynamoDB, S3 binary round-trip, CloudWatch
{
  const { m: c, req } = load("search-analytics-service", "services/awsClients.js", { ...keys("search.aws.env"), ...token });
  Object.assign(process.env, keys("search.aws.env"));
  const { ScanCommand } = req("@aws-sdk/lib-dynamodb");
  const { PutObjectCommand, GetObjectCommand } = req("@aws-sdk/client-s3");
  const { PutMetricDataCommand } = req("@aws-sdk/client-cloudwatch");
  let r = await c.dynamo.send(new ScanCommand({ TableName: "supporthub-search-counters", Limit: 2 }));
  check("Search -> DynamoDB Scan through the Worker", r.$metadata.httpStatusCode === 200, `items=${r.Items?.length}`);
  const bin = crypto.randomBytes(70000); const key = `exports/gateway-probe-${Date.now()}.bin`;
  r = await c.s3.send(new PutObjectCommand({ Bucket: "supporthub-search-analytics-exports", Key: key, Body: bin, ContentType: "application/octet-stream" }));
  check("Search -> S3 PutObject 70 KB binary body through the Worker", r.$metadata.httpStatusCode === 200);
  const g = await c.s3.send(new GetObjectCommand({ Bucket: "supporthub-search-analytics-exports", Key: key }));
  const back = Buffer.from(await g.Body.transformToByteArray());
  check("binary body byte-identical after round-trip (sha256)", crypto.createHash("sha256").update(back).digest("hex") === crypto.createHash("sha256").update(bin).digest("hex"), `${back.length} bytes`);
  r = await c.cloudwatch.send(new PutMetricDataCommand({ Namespace: "SupportHub/Search", MetricData: [{ MetricName: "GatewayProbe", Value: 1 }] }));
  check("Search -> CloudWatch PutMetricData through the Worker", r.$metadata.httpStatusCode === 200);
  try { await c.s3.send(new PutObjectCommand({ Bucket: "supporthub-article-backups", Key: "articles/x.json", Body: "x" })); check("IAM still enforced behind the Worker (Search key -> Article bucket denied)", false); }
  catch (e) { check("IAM still enforced behind the Worker (Search key -> Article bucket denied)", e.$metadata?.httpStatusCode === 403, e.name); }
  for (const k of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]) delete process.env[k];
}
// --- Article (Alyaa): S3 backup object
{
  const { m: s3, req } = load("article-service", "services/s3Client.js", { ...keys("article.aws.env"), ...token });
  Object.assign(process.env, keys("article.aws.env"));
  const { PutObjectCommand, GetObjectCommand } = req("@aws-sdk/client-s3");
  const key = `articles/gateway-probe/${Date.now()}.json`; const doc = JSON.stringify({ probe: true, at: new Date().toISOString() });
  const r = await s3.send(new PutObjectCommand({ Bucket: "supporthub-article-backups", Key: key, Body: doc, ContentType: "application/json" }));
  const g = await s3.send(new GetObjectCommand({ Bucket: "supporthub-article-backups", Key: key }));
  check("Article -> S3 backup Put/Get through the Worker", r.$metadata.httpStatusCode === 200 && (await g.Body.transformToString()) === doc);
  for (const k of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]) delete process.env[k];
}
// --- negative cases
{
  const { m: c, req } = load("search-analytics-service", "services/awsClients.js", keys("search.aws.env"));
  Object.assign(process.env, keys("search.aws.env"));
  const { ScanCommand } = req("@aws-sdk/lib-dynamodb");
  try { await c.dynamo.send(new ScanCommand({ TableName: "supporthub-search-counters", Limit: 1 })); check("request WITHOUT gateway token rejected", false); }
  catch (e) { check("request WITHOUT gateway token rejected (403 at the Worker)", e.$metadata?.httpStatusCode === 403); }
  const { m: c2 } = load("search-analytics-service", "services/awsClients.js", { ...keys("search.aws.env"), FLOCI_ACCESS_CLIENT_ID: env.GATEWAY_CLIENT_ID, FLOCI_ACCESS_CLIENT_SECRET: "f".repeat(64) });
  try { await c2.dynamo.send(new ScanCommand({ TableName: "supporthub-search-counters", Limit: 1 })); check("wrong gateway secret rejected", false); }
  catch (e) { check("wrong gateway secret rejected (403 at the Worker)", e.$metadata?.httpStatusCode === 403); }
  const h = await fetch(`${GW}/__gateway/health`); check("unauthenticated health endpoint reveals nothing about Floci", h.status === 200 && !(await h.text()).includes("floci:"));
  // Hardening: admin key, unsigned reads and non-allow-listed services are refused at the gateway.
  const { m: adm, req: areq } = load("search-analytics-service", "services/awsClients.js", { AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test", ...token });
  Object.assign(process.env, { AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test" });
  try { await adm.dynamo.send(new (areq("@aws-sdk/lib-dynamodb").ScanCommand)({ TableName: "supporthub-search-counters", Limit: 1 })); check("Floci default ADMIN key refused at the gateway", false); }
  catch (e) { check("Floci default ADMIN key refused at the gateway (403)", e.$metadata?.httpStatusCode === 403); }
  const u = await fetch(`${GW}/supporthub-search-analytics-exports/exports/x.csv`, { headers: { "cf-access-client-id": env.GATEWAY_CLIENT_ID, "cf-access-client-secret": env.GATEWAY_CLIENT_SECRET } });
  check("UNSIGNED S3 read refused at the gateway even with the token (403)", u.status === 403, `HTTP ${u.status} ${await u.text()}`);
  const iam = await fetch(`${GW}/?Action=ListUsers&Version=2010-05-08`, { headers: { "cf-access-client-id": env.GATEWAY_CLIENT_ID, "cf-access-client-secret": env.GATEWAY_CLIENT_SECRET,
    authorization: `AWS4-HMAC-SHA256 Credential=${keyId("search.aws.env")}/20261126/us-east-1/iam/aws4_request, SignedHeaders=host, Signature=00` } });
  check("IAM service refused at the gateway for an allowed key (403)", iam.status === 403, `HTTP ${iam.status} ${await iam.text()}`);
  for (const k of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]) delete process.env[k];
}
console.log(`gateway decisions: forwarded=${forwarded} denied=${denied}`);
console.log(`Total: ${pass} passed, ${fail} failed`);
server.close();
process.exitCode = fail ? 1 : 0;
