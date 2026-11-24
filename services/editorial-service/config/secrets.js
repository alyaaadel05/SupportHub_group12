"use strict";

// Shared AWS Secrets Manager loader (SupportHub Group 12).
//
// The same file is used by every SupportHub service so that all of them
// retrieve secrets in one consistent way. Each service only lists the secret
// IDs it needs in SECRET_IDS, and each service's IAM identity can only read
// those secret ARNs, so "shared infrastructure" never means "shared access".
//
// Behaviour
//   - Disabled unless AWS_SECRETS_ENABLED=true (plain .env still works for
//     local development and unit tests).
//   - Every secret must be a JSON object such as {"SESSION_SECRET":"..."}.
//     Only keys in ALLOWED_KEYS are copied into process.env, so a secret can
//     never overwrite NODE_OPTIONS, PATH or similar.
//   - Secrets Manager values win over .env values (this is what makes
//     rotation work: update the secret, restart the service).
//   - Retries transient failures; if retrieval still fails:
//       SECRETS_REQUIRED=true  -> throw (fail closed, the service will not start)
//       otherwise              -> keep existing environment values (fallback)
//   - Never logs a secret value, only secret names and key names.

const ALLOWED_KEYS = new Set([
  "DATABASE_URL",
  "DATABASE_URL_POOLED",
  "SESSION_SECRET",
  "SERVICE_SHARED_SECRET",
  "CRON_SECRET",
  "TURNSTILE_SECRET_KEY",
  "HF_TOKEN",
  "STACK_EXCHANGE_KEY"
]);

function parseSecretIds(value = process.env.SECRET_IDS) {
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function defaultClient() {
  const {
    SecretsManagerClient
  } = require("@aws-sdk/client-secrets-manager");

  return new SecretsManagerClient({
    region: process.env.AWS_REGION || "us-east-1",
    maxAttempts: 1,
    ...(process.env.AWS_ENDPOINT_URL
      ? { endpoint: process.env.AWS_ENDPOINT_URL }
      : {})
  });
}

async function fetchSecret(client, secretId) {
  const {
    GetSecretValueCommand
  } = require("@aws-sdk/client-secrets-manager");

  const result = await client.send(
    new GetSecretValueCommand({ SecretId: secretId })
  );

  let data;

  try {
    data = JSON.parse(result.SecretString || "");
  } catch {
    throw new Error(`Secret ${secretId} is not valid JSON`);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`Secret ${secretId} must be a JSON object`);
  }

  return data;
}

function applySecret(secretId, data, env, logger) {
  const applied = [];

  for (const [key, value] of Object.entries(data)) {
    if (!ALLOWED_KEYS.has(key)) {
      continue;
    }

    if (typeof value !== "string" || value.length === 0) {
      continue;
    }

    env[key] = value;
    applied.push(key);
  }

  logger.log(
    `[secrets] ${secretId}: loaded ${applied.length} key(s)` +
    (applied.length ? ` (${applied.join(", ")})` : "")
  );

  return applied;
}

async function loadSecrets({
  env = process.env,
  client,
  logger = console,
  attempts = Number(env.SECRETS_RETRY_ATTEMPTS || 3),
  delayMs = 500,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  if (env.AWS_SECRETS_ENABLED !== "true") {
    return { enabled: false, loaded: [] };
  }

  const secretIds = parseSecretIds(env.SECRET_IDS);

  if (secretIds.length === 0) {
    throw new Error("AWS_SECRETS_ENABLED=true but SECRET_IDS is empty");
  }

  const smClient = client || defaultClient();
  const required = env.SECRETS_REQUIRED === "true";
  const loaded = [];
  const failed = [];

  for (const secretId of secretIds) {
    let lastError = null;

    for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
      try {
        const data = await fetchSecret(smClient, secretId);
        loaded.push({ secretId, keys: applySecret(secretId, data, env, logger) });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;

        // Access denied and missing secrets will not fix themselves.
        if (
          ["AccessDeniedException", "ResourceNotFoundException"]
            .includes(error.name)
        ) {
          break;
        }

        if (attempt < attempts) {
          await sleep(delayMs * attempt);
        }
      }
    }

    if (lastError) {
      failed.push(secretId);
      logger.error(
        `[secrets] ${secretId}: retrieval failed (${lastError.name || "Error"})`
      );
    }
  }

  if (typeof smClient.destroy === "function" && !client) {
    smClient.destroy();
  }

  if (failed.length && required) {
    throw new Error(
      `Required secrets unavailable: ${failed.join(", ")}`
    );
  }

  if (failed.length) {
    logger.error(
      "[secrets] continuing with environment-variable fallback values"
    );
  }

  return { enabled: true, loaded, failed };
}

module.exports = {
  ALLOWED_KEYS,
  parseSecretIds,
  applySecret,
  loadSecrets
};
