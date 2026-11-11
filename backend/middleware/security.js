
const crypto = require("crypto");

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      error: "Please log in first"
    });
  }
  next();
}

function allowRoles(...roles) {
  return (req, res, next) => {
    const user = req.session.user;

    if (!user) {
      return res.status(401).json({
        error: "Please log in first"
      });
    }

    if (!roles.includes(user.role)) {
      return res.status(403).json({
        error: "You do not have permission"
      });
    }

    next();
  };
}

function csrfProtection(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const expected = req.session.csrfToken;
  const received = req.get("X-CSRF-Token");

  if (
    !expected ||
    !received ||
    typeof received !== "string" ||
    expected.length !== received.length ||
    !crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(received)
    )
  ) {
    return res.status(403).json({
      error: "Invalid security token"
    });
  }

  next();
}

async function verifyTurnstile(token, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Turnstile must be configured");
    }
    return true;
  }

  if (!token || typeof token !== "string") {
    return false;
  }

  const body = new URLSearchParams({
    secret,
    response: token
  });

  if (remoteIp) body.set("remoteip", remoteIp);

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body,
      signal: AbortSignal.timeout(8000)
    }
  );

  if (!response.ok) return false;

  const result = await response.json();
  return result.success === true;
}

module.exports = {
  requireAuth,
  allowRoles,
  csrfProtection,
  verifyTurnstile
};
