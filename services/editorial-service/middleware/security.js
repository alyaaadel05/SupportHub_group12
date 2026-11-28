
"use strict";

const crypto = require("node:crypto");

// Temporary compatibility: remove "editor" after Alyaa
// migrates the existing privileged account to "reviewer".
const REVIEWER_ROLES = ["reviewer", "editor", "admin"];
const AUTHOR_ROLES = ["author", "admin"];

function userFromSession(req) {
  const raw = req.session?.user;

  if (!raw) return null;

  const id = Number(raw.id ?? raw.user_id);

  if (!Number.isSafeInteger(id) || id <= 0) {
    return null;
  }

  return {
    id,
    role: String(raw.role || "reader").toLowerCase()
  };
}

function requireLogin(req, res, next) {
  req.user = userFromSession(req);

  if (!req.user) {
    return res.status(401).json({ error: "Login required" });
  }

  next();
}

function requireAuthor(req, res, next) {
  req.user = userFromSession(req);

  if (!req.user) {
    return res.status(401).json({ error: "Login required" });
  }

  if (!AUTHOR_ROLES.includes(req.user.role)) {
    return res.status(403).json({
      error: "Author permission required"
    });
  }

  next();
}

function requireReviewer(req, res, next) {
  req.user = userFromSession(req);

  if (!req.user) {
    return res.status(401).json({ error: "Login required" });
  }

  if (!REVIEWER_ROLES.includes(req.user.role)) {
    return res.status(403).json({
      error: "Reviewer permission required"
    });
  }

  next();
}

// FRONTEND_ORIGIN may list several exact origins separated by commas, for
// example "http://localhost:8080,http://127.0.0.1:8080,https://supporthub-group12.pages.dev".
// This matches how the Identity and Article services read the same variable.
// Every entry is an exact match: no wildcards, and a missing Origin is rejected.
function allowedOrigins(value = process.env.FRONTEND_ORIGIN) {
  return String(value || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin, value = process.env.FRONTEND_ORIGIN) {
  return typeof origin === "string" && allowedOrigins(value).includes(origin);
}

function requireBrowserWrite(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  if (!isAllowedOrigin(req.get("Origin"))) {
    return res.status(403).json({
      error: "Origin not allowed"
    });
  }

  const expected = req.session?.csrfToken;
  const supplied = req.get("X-CSRF-Token");

  if (
    typeof expected !== "string" ||
    typeof supplied !== "string" ||
    !/^[a-f0-9]{64}$/i.test(expected) ||
    !/^[a-f0-9]{64}$/i.test(supplied)
  ) {
    return res.status(403).json({
      error: "Invalid CSRF token"
    });
  }

  if (
    !crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(supplied, "hex")
    )
  ) {
    return res.status(403).json({
      error: "Invalid CSRF token"
    });
  }

  next();
}

// Verifies a signed internal request from another SupportHub service.
// Same format as serviceClient.signedHeaders():
//   HMAC-SHA256(secret, sender \n timestamp \n method \n path \n sha256(body))
// The timestamp must be within 5 minutes, which limits replay.
function serviceSignature(secret, sender, timestamp, method, path, body = "") {
  const hash = crypto.createHash("sha256").update(body).digest("hex");

  return crypto
    .createHmac("sha256", secret)
    .update(`${sender}\n${timestamp}\n${method}\n${path}\n${hash}`)
    .digest("hex");
}

function requireServiceSignature(expectedSender) {
  return function verifyServiceSignature(req, res, next) {
    const secret = process.env.SERVICE_SHARED_SECRET;
    const sender = req.get("x-service-name");
    const timestamp = req.get("x-service-timestamp") || "";
    const signature = req.get("x-service-signature") || "";

    if (!secret || secret.length < 32) {
      return res.status(503).json({ error: "Internal service not configured" });
    }

    if (
      sender !== expectedSender ||
      !/^\d{13}$/.test(timestamp) ||
      Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000 ||
      !/^[0-9a-f]{64}$/i.test(signature)
    ) {
      return res.status(401).json({ error: "Invalid service credentials" });
    }

    const expected = Buffer.from(
      serviceSignature(secret, sender, timestamp, req.method, req.originalUrl, req.rawBody || ""),
      "hex"
    );
    const supplied = Buffer.from(signature, "hex");

    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
      return res.status(401).json({ error: "Invalid service signature" });
    }

    next();
  };
}

function requireCronSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;
  const bearer = req.get("authorization") || "";
  const expected = secret ? `Bearer ${secret}` : "";

  if (
    !secret ||
    secret.length < 32 ||
    bearer.length !== expected.length ||
    !crypto.timingSafeEqual(
      Buffer.from(bearer),
      Buffer.from(expected)
    )
  ) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  next();
}

module.exports = {
  requireServiceSignature,
  serviceSignature,
  allowedOrigins,
  isAllowedOrigin,
  requireLogin,
  requireReviewer,
  requireAuthor,
  requireBrowserWrite,
  requireCronSecret
};
