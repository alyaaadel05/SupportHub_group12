
"use strict";

const {
  SecretsManagerClient,
  GetSecretValueCommand
} = require("@aws-sdk/client-secrets-manager");

const client = new SecretsManagerClient({
  region: process.env.AWS_REGION || "us-east-1",
  ...(process.env.AWS_ENDPOINT_URL
    ? { endpoint: process.env.AWS_ENDPOINT_URL }
    : {})
});

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
