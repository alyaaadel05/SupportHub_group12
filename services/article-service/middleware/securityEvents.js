"use strict";

// Structured security-event logging (same file in every SupportHub service).
//
// Writes one JSON line per security-relevant response to stdout, where
// Docker / Vercel collect it:
//   401 authentication required / invalid session or service signature
//   403 role denied, ownership denied, CSRF or Origin rejected
//   429 rate limit reached
//
// Never logged: passwords, cookies, session IDs, CSRF tokens, request bodies,
// query strings (they may contain search text) or secrets.

const SERVICE = process.env.SERVICE_NAME || require("../package.json").name;

function safeUserId(req) {
  const id = Number(req.session?.user?.id ?? req.session?.user?.user_id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function logSecurityEvent(req, event, extra = {}) {
  const record = {
    ts: new Date().toISOString(),
    type: "security_event",
    service: SERVICE,
    event,
    method: req.method,
    path: String(req.originalUrl || req.url || "").split("?")[0].slice(0, 200),
    ip: req.ip,
    userId: safeUserId(req),
    role: req.session?.user?.role ?? null,
    ...extra
  };

  console.warn(JSON.stringify(record));
  return record;
}

const EVENTS = {
  401: "authentication_failed",
  403: "access_denied",
  429: "rate_limited"
};

// Express middleware: logs 401/403 responses after they are sent.
// 429 is logged by the rate-limit handler itself (with the limiter name).
function securityEventLogger(req, res, next) {
  res.on("finish", () => {
    if (res.statusCode === 401 || res.statusCode === 403) {
      logSecurityEvent(req, EVENTS[res.statusCode], { status: res.statusCode });
    }
  });

  next();
}

module.exports = { logSecurityEvent, securityEventLogger };
