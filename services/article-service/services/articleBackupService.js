
"use strict";

const {
  PutObjectCommand,
  GetObjectCommand
} = require("@aws-sdk/client-s3");

const s3 = require("./s3Client");
const { getArticleRuntimeConfig } = require("./secretsManagerService");
const versionService = require("./versionService");
const { httpError } = require("./articleService");

const bucket = process.env.AWS_S3_BUCKET;

function objectKey(articleId, versionId) {
  return `articles/${articleId}/versions/${versionId}.json`;
}

// Export an article version to S3.
async function exportVersion(pool, articleId, versionId, user) {
  // Check article ownership before accessing S3.
  const articleVersion = await versionService.detail(
    pool,
    articleId,
    versionId,
    user
  );

  if (!bucket) {
    throw httpError(503, "S3 bucket is not configured");
  }

  // Retrieve backup settings from AWS Secrets Manager.
  let runtimeConfig;

  try {
    runtimeConfig = await getArticleRuntimeConfig();
  } catch {
    throw httpError(
      503,
      "Article backup configuration unavailable"
    );
  }

  // Do not export if backups are disabled.
  if (!runtimeConfig.enabled) {
    throw httpError(503, "Article backups are disabled");
  }

  const key = objectKey(articleId, versionId);

  const backup = {
    articleId,
    versionId,
    exportedAt: new Date().toISOString(),
    version: articleVersion
  };

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(backup),
        ContentType: "application/json"
      })
    );
  } catch (error) {
    console.error("S3 export failed:", error.name);
    throw httpError(503, "S3 temporarily unavailable");
  }

  return {
    message: "Article version exported successfully",
    bucket,
    key
  };
}

// Retrieve an article version backup from S3.
async function retrieveVersion(pool, articleId, versionId, user) {
  // Never return private backups without authorization.
  await versionService.detail(
    pool,
    articleId,
    versionId,
    user
  );

  if (!bucket) {
    throw httpError(503, "S3 bucket is not configured");
  }

  try {
    const result = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: objectKey(articleId, versionId)
      })
    );

    const content = await result.Body.transformToString();

    return JSON.parse(content);
  } catch (error) {
    if (
      error.name === "NoSuchKey" ||
      error.name === "NotFound" ||
      error.$metadata?.httpStatusCode === 404
    ) {
      throw httpError(404, "Article backup not found");
    }

    if (error instanceof SyntaxError) {
      throw httpError(502, "Stored article backup is invalid");
    }

    console.error("S3 retrieval failed:", error.name);
    throw httpError(503, "S3 temporarily unavailable");
  }
}

// Restore a draft from its S3 backup (not from the database copy).
// retrieveVersion() already enforces ownership (403) and returns 404 when
// no backup exists; the stored document is validated before it is used.
async function restoreFromBackup(pool, articleId, versionId, user) {
  const backup = await retrieveVersion(pool, articleId, versionId, user);
  const v = backup && backup.version;

  const valid =
    Number(backup?.articleId) === Number(articleId) &&
    Number(backup?.versionId) === Number(versionId) &&
    v &&
    typeof v.title === "string" && v.title.trim() &&
    typeof v.content === "string" && v.content.trim() &&
    v.category_id !== undefined;

  if (!valid) {
    throw httpError(502, "Stored article backup is invalid");
  }

  const article = await versionService.restoreFromSnapshot(
    pool,
    articleId,
    {
      title: v.title,
      content: v.content,
      category_id: v.category_id
    },
    user
  );

  return { article, restoredFrom: objectKey(articleId, versionId) };
}

module.exports = {
  exportVersion,
  retrieveVersion,
  restoreFromBackup
};
