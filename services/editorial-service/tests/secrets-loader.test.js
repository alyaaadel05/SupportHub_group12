"use strict";

// Unit tests for the shared Secrets Manager loader (config/secrets.js).
// No AWS call is made: a fake client returns or rejects GetSecretValue.

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadSecrets, parseSecretIds } = require("../config/secrets");

const quiet = { log() {}, error() {} };

function fakeClient(values) {
  return {
    calls: [],
    async send(command) {
      const id = command.input.SecretId;
      this.calls.push(id);
      const value = values[id];
      if (value instanceof Error) throw value;
      if (value === undefined) {
        const error = new Error("missing");
        error.name = "ResourceNotFoundException";
        throw error;
      }
      return { SecretString: JSON.stringify(value) };
    }
  };
}

test("disabled by default: nothing is fetched", async () => {
  const env = {};
  const result = await loadSecrets({ env, client: fakeClient({}), logger: quiet });
  assert.equal(result.enabled, false);
});

test("parses comma separated secret IDs", () => {
  assert.deepEqual(parseSecretIds(" a/b , c ,, "), ["a/b", "c"]);
});

test("loads only allow-listed keys and overrides .env values", async () => {
  const env = {
    AWS_SECRETS_ENABLED: "true",
    SECRET_IDS: "supporthub/shared/session",
    SESSION_SECRET: "old-env-value"
  };
  await loadSecrets({
    env,
    logger: quiet,
    client: fakeClient({
      "supporthub/shared/session": {
        SESSION_SECRET: "from-secrets-manager",
        NODE_OPTIONS: "--require evil.js",
        feature: "ignored"
      }
    })
  });
  assert.equal(env.SESSION_SECRET, "from-secrets-manager");
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.feature, undefined);
});

test("never logs secret values", async () => {
  const lines = [];
  const logger = { log: l => lines.push(l), error: l => lines.push(l) };
  await loadSecrets({
    env: { AWS_SECRETS_ENABLED: "true", SECRET_IDS: "s" },
    logger,
    client: fakeClient({ s: { SESSION_SECRET: "super-secret-value-123" } })
  });
  assert.ok(lines.every(line => !line.includes("super-secret-value-123")));
});

test("access denied: falls back to environment when not required", async () => {
  const denied = new Error("denied");
  denied.name = "AccessDeniedException";
  const env = {
    AWS_SECRETS_ENABLED: "true",
    SECRET_IDS: "supporthub/other/runtime",
    SESSION_SECRET: "env-fallback"
  };
  const client = fakeClient({ "supporthub/other/runtime": denied });
  const result = await loadSecrets({ env, client, logger: quiet });
  assert.deepEqual(result.failed, ["supporthub/other/runtime"]);
  assert.equal(env.SESSION_SECRET, "env-fallback");
  assert.equal(client.calls.length, 1, "access denied is not retried");
});

test("fails closed when SECRETS_REQUIRED=true", async () => {
  const denied = new Error("denied");
  denied.name = "AccessDeniedException";
  await assert.rejects(
    loadSecrets({
      env: { AWS_SECRETS_ENABLED: "true", SECRETS_REQUIRED: "true", SECRET_IDS: "x" },
      client: fakeClient({ x: denied }),
      logger: quiet
    }),
    /Required secrets unavailable: x/
  );
});

test("retries transient errors before succeeding", async () => {
  let calls = 0;
  const client = {
    async send() {
      calls += 1;
      if (calls < 3) {
        const error = new Error("timeout");
        error.name = "TimeoutError";
        throw error;
      }
      return { SecretString: JSON.stringify({ CRON_SECRET: "c".repeat(40) }) };
    }
  };
  const env = { AWS_SECRETS_ENABLED: "true", SECRET_IDS: "x" };
  await loadSecrets({ env, client, logger: quiet, sleep: async () => {} });
  assert.equal(calls, 3);
  assert.equal(env.CRON_SECRET, "c".repeat(40));
});

test("rejects a secret that is not a JSON object", async () => {
  const client = { async send() { return { SecretString: "plain-text" }; } };
  await assert.rejects(
    loadSecrets({
      env: { AWS_SECRETS_ENABLED: "true", SECRETS_REQUIRED: "true", SECRET_IDS: "x" },
      client,
      logger: quiet,
      sleep: async () => {}
    }),
    /Required secrets unavailable/
  );
});
