
"use strict";

const {
  PutObjectCommand,
  GetObjectCommand
} = require("@aws-sdk/client-s3");

const s3 = require("./s3Client");
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

  const key = objectKey(articleId, versionId);

  const backup = {
    articleId,
    versionId,
    exportedAt: new Date().toISOString(),
    version: articleVersion
  };


try {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(backup),
    ContentType: "application/json"
  }));
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
    const result = await s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey(articleId, versionId)
    }));

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

module.exports = {
  exportVersion,
  retrieveVersion
};
