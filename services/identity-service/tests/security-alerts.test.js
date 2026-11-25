"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  publishSecurityAlert,
  createAlertThrottle,
  alertEventFor,
  securityAlertPublisher
} = require("../services/securityAlerts");

const TOPIC = "arn:aws:sns:us-east-1:000000000000:supporthub-identity-security-alerts";
const ON = { IDENTITY_SNS_ENABLED: "true", IDENTITY_SNS_TOPIC_ARN: TOPIC };

async function withEnv(values, run) {
  const saved = {};
  const set = (key, value) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  for (const [key, value] of Object.entries(values)) {
    saved[key] = process.env[key];
    set(key, value);
  }

  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(saved)) set(key, value);
  }
}

const mustNotSend = { send() { throw new Error("must not be called"); } };

test("alerts are skipped unless explicitly enabled", () =>
  withEnv({ ...ON, IDENTITY_SNS_ENABLED: undefined }, async () => {
    assert.deepEqual(
      await publishSecurityAlert("access_denied", { client: mustNotSend }),
      { skipped: true }
    );
  }));

test("unknown events and a missing topic are skipped", async () => {
  await withEnv(ON, async () =>
    assert.deepEqual(
      await publishSecurityAlert("login_ok", { client: mustNotSend }),
      { skipped: true }
    ));

  await withEnv({ ...ON, IDENTITY_SNS_TOPIC_ARN: undefined }, async () =>
    assert.deepEqual(
      await publishSecurityAlert("access_denied", { client: mustNotSend }),
      { skipped: true }
    ));
});

test("the message holds only service, event and timestamp", () =>
  withEnv(ON, async () => {
    let input;
    const client = {
      async send(command) { input = command.input; return { MessageId: "m1" }; }
    };

    assert.deepEqual(
      await publishSecurityAlert("access_denied", { client }),
      { published: true }
    );
    assert.equal(input.TopicArn, TOPIC);
    assert.deepEqual(
      Object.keys(JSON.parse(input.Message)).sort(),
      ["event", "service", "timestamp"]
    );
  }));

test("an SNS failure is contained", () =>
  withEnv(ON, async () => {
    const client = { async send() { throw new Error("SNS down"); } };
    assert.deepEqual(
      await publishSecurityAlert("rate_limited", { client }),
      { published: false }
    );
  }));

test("the throttle allows one alert per event per window", () => {
  let time = 0;
  const allow = createAlertThrottle(1000, () => time);

  assert.equal(allow("access_denied"), true);
  assert.equal(allow("access_denied"), false);
  assert.equal(allow("rate_limited"), true);
  time = 1000;
  assert.equal(allow("access_denied"), true);
});

test("a missing session is not reported as a failed login", () => {
  assert.equal(alertEventFor(401, "/api/auth/login"), "authentication_failed");
  assert.equal(alertEventFor(401, "/api/auth/me"), null);
  assert.equal(alertEventFor(403, "/api/auth/login"), "access_denied");
  assert.equal(alertEventFor(429, "/api/auth/register"), "rate_limited");
  assert.equal(alertEventFor(200, "/api/auth/login"), null);
});

test("the middleware publishes after the response and never throws", () =>
  withEnv(ON, async () => {
    const sent = [];
    const middleware = securityAlertPublisher({
      publish: async event => { sent.push(event); throw new Error("SNS down"); }
    });

    for (const status of [401, 401, 200]) {
      const res = new EventEmitter();
      let nextCalled = false;

      res.statusCode = status;
      middleware(
        { originalUrl: "/api/auth/login?x=1" }, res, () => { nextCalled = true; }
      );
      assert.equal(nextCalled, true);
      res.emit("finish");
    }

    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(sent, ["authentication_failed"]);
  }));
