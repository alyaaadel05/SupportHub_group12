// SupportHub Group 12 - LIVE verification of the Cloudflare Worker gateway
// (Vercel -> https://supporthub-floci-gateway.<sub>.workers.dev -> Workers VPC -> tunnel -> Floci).
// Uses the REAL service modules (Search awsClients, Article s3Client) with the production
// component keys and gateway token from infra/floci/.generated/production (git-ignored);
// no value is printed. Writes only probe objects named *gateway-probe* and one GatewayProbe metric.
//
//   GATEWAY_URL=https://supporthub-floci-gateway.<sub>.workers.dev node tests/integration/floci-gateway-live-check.mjs

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GW = (process.env.GATEWAY_URL || "").replace(/\/$/, "");
if (!/^https:\/\/supporthub-floci-gateway\.[a-z0-9-]+\.workers\.dev$/.test(GW)) throw new Error("set GATEWAY_URL to the workers.dev gateway");
const GEN = path.join(ROOT, "infra/floci/.generated/production");
const kv = f => Object.fromEntries([...fs.readFileSync(path.join(GEN, f), "utf8").matchAll(/^([A-Z_]+)=(.+)$/gm)].map(m => [m[1], m[2].trim()]));
const token = kv("gateway.env");
const keys = f => { const k = kv(f); return { AWS_ACCESS_KEY_ID: k.AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY: k.AWS_SECRET_ACCESS_KEY }; };
let pass = 0, fail = 0; const lines = [];
const check = (n, ok, d = "") => { ok ? pass++ : fail++; const l = `${ok ? "PASS" : "FAIL"} | ${n}${d ? " | " + d : ""}`; lines.push(l); console.log(l); };

function load(service, mod, extraEnv) {
  const req = createRequire(path.join(ROOT, `services/${service}/package.json`));
  for (const k of Object.keys(req.cache)) if (k.includes(path.join("services", service)) && !k.includes("node_modules")) delete req.cache[k];
  const saved = { ...process.env };
  Object.assign(process.env, { AWS_REGION: "us-east-1", AWS_ENDPOINT_URL: GW }, extraEnv);
  try { return { m: req(path.join(ROOT, `services/${service}/${mod}`)), req }; } finally { process.env = saved; }
}
const withKeys = async (k, fn) => { const saved = { ...process.env }; Object.assign(process.env, k); try { return await fn(); } finally { process.env = saved; } };
const status = e => e?.$metadata?.httpStatusCode;
const tok = { FLOCI_ACCESS_CLIENT_ID: token.FLOCI_ACCESS_CLIENT_ID, FLOCI_ACCESS_CLIENT_SECRET: token.FLOCI_ACCESS_CLIENT_SECRET };
const H = { "cf-access-client-id": token.FLOCI_ACCESS_CLIENT_ID, "cf-access-client-secret": token.FLOCI_ACCESS_CLIENT_SECRET };
lines.push(`Live gateway check ${new Date().toISOString()} - ${GW.replace(/\.[a-z0-9-]+\.workers\.dev/, ".<subdomain>.workers.dev")}`);
console.log(lines[0]);

// ---- gateway authentication and policy
let r = await fetch(`${GW}/__gateway/health`); let t = await r.text();
check("health endpoint 200 and reveals nothing about Floci", r.status === 200 && !/floci:|4566|tunnel/i.test(t.replace("supporthub-floci-gateway", "")), t);
r = await fetch(`${GW}/supporthub-search-analytics-exports/`); check("no token -> 403", r.status === 403, `HTTP ${r.status}`);
r = await fetch(`${GW}/supporthub-search-analytics-exports/`, { headers: { ...H, "cf-access-client-secret": "f".repeat(64) } }); check("wrong token secret -> 403", r.status === 403, `HTTP ${r.status}`);
r = await fetch(`${GW}/supporthub-article-backups/articles/x.json`, { headers: H }); check("UNSIGNED S3 read with a valid token -> 403 at the gateway", r.status === 403, `HTTP ${r.status} ${await r.text()}`);
const sk = keys("vercel-search.aws.env").AWS_ACCESS_KEY_ID;
for (const svc of ["iam", "sts", "secretsmanager", "sqs", "lambda", "ecs"]) {
  r = await fetch(`${GW}/?Action=ListUsers`, { headers: { ...H, authorization: `AWS4-HMAC-SHA256 Credential=${sk}/20261126/us-east-1/${svc}/aws4_request, SignedHeaders=host, Signature=00` } });
  check(`service '${svc}' refused for an allowed key -> 403`, r.status === 403, `${r.status} ${await r.text()}`);
}
{ const { m, req } = load("search-analytics-service", "services/awsClients.js", { AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test", ...tok });
  try { await withKeys({ AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test" }, () => m.dynamo.send(new (req("@aws-sdk/lib-dynamodb").ScanCommand)({ TableName: "supporthub-search-counters", Limit: 1 }))); check("Floci default ADMIN key refused", false); }
  catch (e) { check("Floci default ADMIN key refused at the gateway -> 403", status(e) === 403); } }

// ---- Search (Nermeen) with the real awsClients module
{ const k = keys("vercel-search.aws.env");
  const { m: c, req } = load("search-analytics-service", "services/awsClients.js", { ...k, ...tok });
  await withKeys(k, async () => {
    const { ScanCommand } = req("@aws-sdk/lib-dynamodb"); const { PutObjectCommand, GetObjectCommand } = req("@aws-sdk/client-s3"); const { PutMetricDataCommand } = req("@aws-sdk/client-cloudwatch");
    let x = await c.dynamo.send(new ScanCommand({ TableName: "supporthub-search-counters", Limit: 2 })); check("Search -> DynamoDB Scan via live gateway", x.$metadata.httpStatusCode === 200);
    const bin = crypto.randomBytes(70000), key = `exports/gateway-probe-${Date.now()}.bin`;
    x = await c.s3.send(new PutObjectCommand({ Bucket: "supporthub-search-analytics-exports", Key: key, Body: bin, ContentType: "application/octet-stream" })); check("Search -> S3 PutObject 70 KB binary via live gateway", x.$metadata.httpStatusCode === 200);
    const g = await c.s3.send(new GetObjectCommand({ Bucket: "supporthub-search-analytics-exports", Key: key })); const back = Buffer.from(await g.Body.transformToByteArray());
    check("binary body byte-identical after the live round trip (sha256)", crypto.createHash("sha256").update(back).digest("hex") === crypto.createHash("sha256").update(bin).digest("hex"), `${back.length} bytes`);
    x = await c.cloudwatch.send(new PutMetricDataCommand({ Namespace: "SupportHub/Search", MetricData: [{ MetricName: "GatewayProbe", Value: 1 }] })); check("Search -> CloudWatch PutMetricData via live gateway", x.$metadata.httpStatusCode === 200);
    try { await c.s3.send(new PutObjectCommand({ Bucket: "supporthub-article-backups", Key: "articles/gateway-probe-denied.json", Body: "x" })); check("Search key denied the Article bucket", false); }
    catch (e) { check("Search key DENIED the Article bucket (Floci IAM behind the gateway)", status(e) === 403, e.name); }
  }); }
// ---- Article (Alyaa) with the real s3Client module
{ const k = keys("vercel-article.aws.env");
  const { m: s3, req } = load("article-service", "services/s3Client.js", { ...k, ...tok });
  await withKeys(k, async () => {
    const { PutObjectCommand, GetObjectCommand } = req("@aws-sdk/client-s3");
    const key = `articles/gateway-probe/${Date.now()}.json`, doc = JSON.stringify({ probe: true, at: new Date().toISOString() });
    const p = await s3.send(new PutObjectCommand({ Bucket: "supporthub-article-backups", Key: key, Body: doc, ContentType: "application/json" }));
    const g = await s3.send(new GetObjectCommand({ Bucket: "supporthub-article-backups", Key: key }));
    check("Article -> S3 backup Put/Get via live gateway", p.$metadata.httpStatusCode === 200 && (await g.Body.transformToString()) === doc);
    try { await s3.send(new GetObjectCommand({ Bucket: "supporthub-search-analytics-exports", Key: "exports/x.csv" })); check("Article key denied the Search bucket", false); }
    catch (e) { check("Article key DENIED the Search exports bucket", status(e) === 403, e.name); }
  });
  // Secrets Manager: Article may read ONLY its runtime config (used by the backup export).
  const { SecretsManagerClient, GetSecretValueCommand } = createRequire(path.join(ROOT, "services/article-service/package.json"))("@aws-sdk/client-secrets-manager");
  const { withFlociAccess } = createRequire(path.join(ROOT, "services/article-service/package.json"))(path.join(ROOT, "services/article-service/config/flociAccess.js"));
  const sm = withFlociAccess(new SecretsManagerClient({ region: "us-east-1", endpoint: GW, credentials: { accessKeyId: k.AWS_ACCESS_KEY_ID, secretAccessKey: k.AWS_SECRET_ACCESS_KEY } }), tok);
  const rc = await sm.send(new GetSecretValueCommand({ SecretId: "supporthub/article/runtime-config" }));
  let enabledType = "?"; try { enabledType = typeof JSON.parse(rc.SecretString).enabled; } catch {}
  check("Article key reads ITS runtime config via live gateway (value not printed)", rc.Name === "supporthub/article/runtime-config" && enabledType === "boolean", `name ok, 'enabled' is ${enabledType}`);
  try { await sm.send(new GetSecretValueCommand({ SecretId: "supporthub/shared/session" })); check("Article key denied other secrets", false); }
  catch (e) { check("Article key DENIED other secrets (supporthub/shared/session)", status(e) === 400 || status(e) === 403, `${e.name}`); }
}
{ // per-key service rules at the gateway
  for (const [label, file, svc] of [["Search", "vercel-search.aws.env", "secretsmanager"], ["Identity", "vercel-identity.aws.env", "s3"], ["Identity", "vercel-identity.aws.env", "secretsmanager"]]) {
    const id = keys(file).AWS_ACCESS_KEY_ID;
    const rr = await fetch(`${GW}/`, { method: "POST", headers: { ...H, authorization: `AWS4-HMAC-SHA256 Credential=${id}/20261126/us-east-1/${svc}/aws4_request, SignedHeaders=host, Signature=00` } });
    check(`${label} key refused '${svc}' at the gateway (per-key rule)`, rr.status === 403, `${rr.status} ${await rr.text()}`);
  }
}
// ---- Identity: may publish only to its alerts topic (publication topic denied - no event injection)
{ const k = keys("vercel-identity.aws.env");
  const req = createRequire(path.join(ROOT, "services/identity-service/package.json"));
  const { SNSClient, PublishCommand } = req("@aws-sdk/client-sns");
  const { withFlociAccess } = req(path.join(ROOT, "services/identity-service/config/flociAccess.js"));
  const sns = withFlociAccess(new SNSClient({ region: "us-east-1", endpoint: GW, credentials: { accessKeyId: k.AWS_ACCESS_KEY_ID, secretAccessKey: k.AWS_SECRET_ACCESS_KEY } }), tok);
  try { await sns.send(new PublishCommand({ TopicArn: "arn:aws:sns:us-east-1:000000000000:supporthub-editorial-publication-events", Message: "{}" })); check("Identity key denied the publication topic", false); }
  catch (e) { check("Identity key DENIED publishing to the publication topic (no event injection)", status(e) === 403, e.name); } }

console.log(`Total: ${pass} passed, ${fail} failed`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, lines.join("\n") + `\nTotal: ${pass} passed, ${fail} failed\n`);
process.exitCode = fail ? 1 : 0;
