// Cloudflare Access headers for Vercel -> remote Floci (real SDK client, captured request).
const test = require("node:test");
const assert = require("node:assert/strict");
const { S3Client, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const { withFlociAccess } = require("../config/flociAccess");

function capturingClient() {
  const seen = [];
  const client = new S3Client({
    region: "us-east-1", endpoint: "https://floci.example.test", forcePathStyle: true,
    credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "example-secret-not-real" },
    requestHandler: { handle: async request => { seen.push(request); return { response: { statusCode: 200, headers: {}, body: Buffer.from("<ListBucketResult></ListBucketResult>") } }; } }
  });
  return { client, seen };
}

test("adds the Access service-token headers when configured", async () => {
  const { client, seen } = capturingClient();
  withFlociAccess(client, { FLOCI_ACCESS_CLIENT_ID: "id.access", FLOCI_ACCESS_CLIENT_SECRET: "s3cr3t-test" });
  await client.send(new ListObjectsV2Command({ Bucket: "b" })).catch(() => {});
  assert.equal(seen[0].headers["cf-access-client-id"], "id.access");
  assert.equal(seen[0].headers["cf-access-client-secret"], "s3cr3t-test");
});

test("headers are added after signing (not in SigV4 SignedHeaders)", async () => {
  const { client, seen } = capturingClient();
  withFlociAccess(client, { FLOCI_ACCESS_CLIENT_ID: "id.access", FLOCI_ACCESS_CLIENT_SECRET: "s3cr3t-test" });
  await client.send(new ListObjectsV2Command({ Bucket: "b" })).catch(() => {});
  const auth = seen[0].headers.authorization || seen[0].headers.Authorization;
  assert.match(auth, /SignedHeaders=/);
  assert.doesNotMatch(auth, /cf-access/i);
});

test("no-op without configuration (local Docker / ECS)", async () => {
  const { client, seen } = capturingClient();
  withFlociAccess(client, {});
  await client.send(new ListObjectsV2Command({ Bucket: "b" })).catch(() => {});
  assert.equal(seen[0].headers["cf-access-client-id"], undefined);
});
