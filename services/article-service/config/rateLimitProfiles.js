"use strict";

// Rate-limit profiles (same file in every SupportHub service).
//
//   RATE_LIMIT_PROFILE=production (default)  restrictive per-endpoint limits
//   RATE_LIMIT_PROFILE=loadtest              relaxed limits for the dedicated,
//                                            isolated k6 load-test stack only
//
// Safety rules:
//   - "loadtest" is IGNORED when NODE_ENV=production, so a deployed service
//     can never run with relaxed limits, whatever its environment says.
//   - Unknown profile names fall back to "production".
//   - Limits are never disabled; the loadtest values are high but finite.
//   - Authentication, authorization, CSRF and Origin checks are identical in
//     both profiles. Only the request budgets differ.
//   - The Identity login/registration limit (30 / 15 min) is NOT part of the
//     profiles and stays fixed everywhere (brute-force protection).

const { rateLimit } = require("express-rate-limit");
const { logSecurityEvent } = require("../middleware/securityEvents");

const WINDOW_MS = 15 * 60 * 1000;
const LOADTEST_LIMIT = 20000;

function resolveProfile(env = process.env) {
  const requested = String(env.RATE_LIMIT_PROFILE || "production")
    .trim()
    .toLowerCase();

  if (requested === "loadtest" && env.NODE_ENV !== "production") {
    return "loadtest";
  }

  return "production";
}

function limitFor(productionLimit, env = process.env) {
  return resolveProfile(env) === "loadtest" ? LOADTEST_LIMIT : productionLimit;
}

// name: short label used in logs and the 429 response
// productionLimit: requests per 15 minutes per client in production
function createLimiter(name, productionLimit, { env = process.env, windowMs = WINDOW_MS } = {}) {
  const limit = limitFor(productionLimit, env);

  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler(req, res, next, options) {
      logSecurityEvent(req, "rate_limited", { limiter: name, limit });
      res.status(options.statusCode).json({
        error: "Too many requests. Please try again later.",
        limiter: name
      });
    }
  });
}

module.exports = {
  WINDOW_MS,
  LOADTEST_LIMIT,
  resolveProfile,
  limitFor,
  createLimiter
};

// General /api limit: RATE_LIMIT_MAX when set (validated by rateLimit.js),
// otherwise 300 in production and 100000 in the loadtest profile.
function generalLimit(env = process.env) {
  const { resolveRateLimitMax } = require("./rateLimit");

  if (env.RATE_LIMIT_MAX !== undefined && String(env.RATE_LIMIT_MAX).trim() !== "") {
    return resolveRateLimitMax(env.RATE_LIMIT_MAX);
  }

  return resolveProfile(env) === "loadtest" ? 100000 : resolveRateLimitMax(undefined);
}

module.exports.generalLimit = generalLimit;
