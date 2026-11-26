"use strict";

const ALERT_EVENTS = new Set([
  "authentication_failed",
  "rate_limited",
  "access_denied"
]);

async function publishSecurityAlert(event, options = {}) {
  if (process.env.IDENTITY_SNS_ENABLED !== "true") {
    return { skipped: true };
  }

  if (!ALERT_EVENTS.has(event)) {
    return { skipped: true };
  }

  const topicArn = process.env.IDENTITY_SNS_TOPIC_ARN;

  if (!topicArn) {
    console.warn("[identity-sns] Topic ARN not configured");
    return { skipped: true };
  }

  try {
    const { SNSClient, PublishCommand } =
      require("@aws-sdk/client-sns");

    const { withFlociAccess } = require("../config/flociAccess");
    const client = options.client || withFlociAccess(new SNSClient({
      region: process.env.AWS_REGION || "us-east-1",
      maxAttempts: 1,
      ...(process.env.AWS_ENDPOINT_URL
        ? { endpoint: process.env.AWS_ENDPOINT_URL }
        : {})
    }));

    try {
      const response = await client.send(new PublishCommand({
        TopicArn: topicArn,
        Message: JSON.stringify({
          service: "identity-service",
          event,
          timestamp: new Date().toISOString()
        })
      }));

      return { published: Boolean(response.MessageId) };
    } finally {
      if (!options.client) client.destroy();
    }
  } catch (error) {
    console.warn(
      "[identity-sns] Alert publishing unavailable:",
      error.name || "Error"
    );
    return { published: false };
  }
}

// Limits alerts to one per event type per window, so a burst of failed
// requests (for example a brute-force attempt) cannot flood the topic.
function createAlertThrottle(windowMs = 60 * 1000, now = Date.now) {
  const lastSent = new Map();

  return event => {
    const current = now();
    const previous = lastSent.get(event);

    if (previous !== undefined && current - previous < windowMs) {
      return false;
    }

    lastSent.set(event, current);
    return true;
  };
}

// 401 from /api/auth/me or /logout is only a browser without a session, so
// authentication_failed means a rejected login. Any 403 or 429 also counts.
function alertEventFor(statusCode, path) {
  if (statusCode === 401) {
    return /\/login$/.test(path) ? "authentication_failed" : null;
  }

  if (statusCode === 403) return "access_denied";
  if (statusCode === 429) return "rate_limited";

  return null;
}

// Express middleware. Publishes after the response is sent, so SNS latency or
// failure never affects the user. Off unless IDENTITY_SNS_ENABLED=true.
function securityAlertPublisher({
  publish = publishSecurityAlert,
  shouldSend = createAlertThrottle()
} = {}) {
  return (req, res, next) => {
    const path = String(req.originalUrl || req.url || "").split("?")[0];

    // Vercel freezes the function after the response, so an after-response publish only runs
    // when the NEXT request arrives (verified live: alert reached SNS 41 s late). On Vercel the
    // alert is published just BEFORE the response is finished, bounded to 1.5 s and never
    // failing the request. Elsewhere (Docker) the original after-response publish is kept.
    if (process.env.VERCEL) {
      const end = res.end.bind(res);
      res.end = (...args) => {
        const event = process.env.IDENTITY_SNS_ENABLED === "true" ? alertEventFor(res.statusCode, path) : null;
        if (!event || !shouldSend(event)) return end(...args);
        Promise.race([
          Promise.resolve().then(() => publish(event)).catch(() => {}),
          new Promise(resolve => setTimeout(resolve, 1500))
        ]).finally(() => end(...args));
        return res;
      };
      return next();
    }

    res.on("finish", () => {
      if (process.env.IDENTITY_SNS_ENABLED !== "true") return;

      const event = alertEventFor(res.statusCode, path);

      if (event && shouldSend(event)) {
        Promise.resolve()
          .then(() => publish(event))
          .catch(() => {});
      }
    });

    next();
  };
}

module.exports = {
  ALERT_EVENTS,
  publishSecurityAlert,
  createAlertThrottle,
  alertEventFor,
  securityAlertPublisher
};
