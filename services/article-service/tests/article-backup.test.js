
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AWS_S3_BUCKET = "supporthub-unit-test";

const {
  SecretsManagerClient
} = require("@aws-sdk/client-secrets-manager");

const s3 = require("../services/s3Client");
const versionService = require("../services/versionService");
const backupService = require("../services/articleBackupService");

const author = { id: 5, role: "author" };
const fakePool = {};

const articleVersion = {
  version_id: 14,
  article_id: 6,
  title: "Router Instructions",
  content: "How to reset the router.",
  category_id: 2
};

// Simulate Secrets Manager without accessing AWS or Floci.
function mockRuntimeConfig(t, enabled = true) {
  t.mock.method(
    SecretsManagerClient.prototype,
    "send",
    async () => ({
      SecretString: JSON.stringify({
        feature: "article-backup",
        enabled
      })
    })
  );
}

test("S3 export uses the correct article version key", async (t) => {
  mockRuntimeConfig(t, true);

  t.mock.method(
    versionService,
    "detail",
    async () => articleVersion
  );

  let recordedCommand;

  t.mock.method(s3, "send", async (command) => {
    recordedCommand = command;
    return {};
  });

  const result = await backupService.exportVersion(
    fakePool, 6, 14, author
  );

  assert.equal(result.key, "articles/6/versions/14.json");
  assert.equal(recordedCommand.constructor.name, "PutObjectCommand");
  assert.equal(recordedCommand.input.Bucket, "supporthub-unit-test");

  const uploaded = JSON.parse(recordedCommand.input.Body);
  assert.equal(uploaded.version.title, articleVersion.title);
});

test("Secrets Manager enabled allows S3 export", async (t) => {
  mockRuntimeConfig(t, true);

  t.mock.method(
    versionService,
    "detail",
    async () => articleVersion
  );

  let s3Called = false;

  t.mock.method(s3, "send", async () => {
    s3Called = true;
    return {};
  });

  const result = await backupService.exportVersion(
    fakePool, 6, 14, author
  );

  assert.equal(s3Called, true);
  assert.equal(
    result.message,
    "Article version exported successfully"
  );
});

test("Secrets Manager disabled blocks S3 export", async (t) => {
  mockRuntimeConfig(t, false);

  t.mock.method(
    versionService,
    "detail",
    async () => articleVersion
  );

  let s3Called = false;

  t.mock.method(s3, "send", async () => {
    s3Called = true;
    return {};
  });

  await assert.rejects(
    backupService.exportVersion(fakePool, 6, 14, author),
    { status: 503, message: "Article backups are disabled" }
  );

  assert.equal(s3Called, false);
});

test("Secrets Manager outage blocks S3 export safely", async (t) => {
  t.mock.method(
    versionService,
    "detail",
    async () => articleVersion
  );

  t.mock.method(
    SecretsManagerClient.prototype,
    "send",
    async () => {
      throw new Error("Simulated Secrets Manager outage");
    }
  );

  let s3Called = false;

  t.mock.method(s3, "send", async () => {
    s3Called = true;
    return {};
  });

  await assert.rejects(
    backupService.exportVersion(fakePool, 6, 14, author),
    {
      status: 503,
      message: "Article backup configuration unavailable"
    }
  );

  assert.equal(s3Called, false);
});

test("S3 retrieval returns the stored article version", async (t) => {
  t.mock.method(
    versionService,
    "detail",
    async () => articleVersion
  );

  t.mock.method(s3, "send", async () => ({
    Body: {
      async transformToString() {
        return JSON.stringify({
          articleId: 6,
          versionId: 14,
          version: articleVersion
        });
      }
    }
  }));

  const result = await backupService.retrieveVersion(
    fakePool, 6, 14, author
  );

  assert.equal(result.version.title, "Router Instructions");
});

test("Missing S3 backup returns HTTP 404", async (t) => {
  t.mock.method(
    versionService,
    "detail",
    async () => articleVersion
  );

  t.mock.method(s3, "send", async () => {
    const error = new Error("Object missing");
    error.name = "NoSuchKey";
    throw error;
  });

  await assert.rejects(
    backupService.retrieveVersion(fakePool, 6, 14, author),
    { status: 404 }
  );
});

test("S3 outage returns controlled HTTP 503", async (t) => {
  t.mock.method(
    versionService,
    "detail",
    async () => articleVersion
  );

  t.mock.method(s3, "send", async () => {
    throw new Error("Simulated S3 outage");
  });

  await assert.rejects(
    backupService.retrieveVersion(fakePool, 6, 14, author),
    { status: 503 }
  );
});

test("Unauthorized user cannot access S3 backup", async (t) => {
  t.mock.method(versionService, "detail", async () => {
    const error = new Error("Forbidden");
    error.status = 403;
    throw error;
  });

  let s3Called = false;

  t.mock.method(s3, "send", async () => {
    s3Called = true;
  });

  await assert.rejects(
    backupService.retrieveVersion(
      fakePool, 6, 14, { id: 99, role: "author" }
    ),
    { status: 403 }
  );

  assert.equal(s3Called, false);
});
