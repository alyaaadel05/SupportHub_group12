
"use strict";

const {
  SecretsManagerClient,
  GetSecretValueCommand
} = require("@aws-sdk/client-secrets-manager");
const { withFlociAccess } = require("../config/flociAccess");

const client = new SecretsManagerClient({
  region: process.env.AWS_REGION || "us-east-1",
  ...(process.env.AWS_ENDPOINT_URL
    ? { endpoint: process.env.AWS_ENDPOINT_URL }
    : {})
});

// Vercel -> Floci gateway: add the gateway token headers like the S3 client does (no-op without
// FLOCI_ACCESS_CLIENT_ID/SECRET). Without this the runtime-config read got 403 at the gateway
// and every backup export returned 503 (verified live 2026-11-26).
withFlociAccess(client);

const secretName =
  process.env.AWS_SECRET_NAME || "supporthub/article/runtime-config";

async function getArticleRuntimeConfig() {
  try {
    const result = await client.send(
      new GetSecretValueCommand({ SecretId: secretName })
    );

    const config = JSON.parse(result.SecretString);

    if (
      config.feature !== "article-backup" ||
      typeof config.enabled !== "boolean"
    ) {
      throw new Error("Invalid runtime configuration");
    }

    return config;
  } catch (error) {
    console.error("Secrets Manager retrieval failed:", error.name);
    throw new Error("Article runtime configuration unavailable");
  }
}

module.exports = { getArticleRuntimeConfig };
