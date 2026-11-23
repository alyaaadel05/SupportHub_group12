"use strict";

// General API rate limit (requests per 15 minutes per client).
// The production default stays 300. RATE_LIMIT_MAX may raise it ONLY for
// isolated local load testing (see docs/development-load-testing.md).
// Invalid, zero, negative or non-integer values fall back to the default,
// so a typo can never disable or break rate limiting.
const DEFAULT_RATE_LIMIT_MAX = 300;

function resolveRateLimitMax(value = process.env.RATE_LIMIT_MAX) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return DEFAULT_RATE_LIMIT_MAX;
  }

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_RATE_LIMIT_MAX;
}

module.exports = { DEFAULT_RATE_LIMIT_MAX, resolveRateLimitMax };
