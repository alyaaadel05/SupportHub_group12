
const crypto = require("crypto");
const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");

const pool = require("../db/pool");

const PgSession = connectPgSimple(session);

function sessionMiddleware() {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be at least 32 characters"
    );
  }

  return session({
    name: "supporthub.sid",
    store: new PgSession({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: true
    }),
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 8 * 60 * 60 * 1000
    }
  });
}

function requireAuth(req, res, next) {
  if (!req.session?.user?.id) {
    return res.status(401).json({
      error: "Authentication required"
    });
  }

  req.user = req.session.user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session?.user?.id) {
      return res.status(401).json({
        error: "Authentication required"
      });
    }

    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({
        error: "Insufficient permissions"
      });
    }

    req.user = req.session.user;
    next();
  };
}

function generateCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }

  return req.session.csrfToken;
}

function requireCsrf(req, res, next) {
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

function checkOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const allowed = (process.env.FRONTEND_ORIGIN || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  const origin = req.get("Origin");

  if (allowed.length === 0) {
    return res.status(500).json({
      error: "FRONTEND_ORIGIN is not configured"
    });
  }

  if (!origin && process.env.NODE_ENV !== "production") {
    return next();
  }

  if (!allowed.includes(origin)) {
    return res.status(403).json({
      error: "Request origin not allowed"
    });
  }

  next();
}

module.exports = {
  sessionMiddleware,
  requireAuth,
  requireRole,
  generateCsrfToken,
  ensureCsrfToken,
  requireCsrf,
  checkOrigin
};
