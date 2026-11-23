
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

function requireBrowserWrite(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const allowedOrigin = process.env.FRONTEND_ORIGIN;
  const suppliedOrigin = req.get("Origin");

  if (!allowedOrigin || suppliedOrigin !== allowedOrigin) {
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
  requireLogin,
  requireReviewer,
  requireAuthor,
  requireBrowserWrite,
  requireCronSecret
};
