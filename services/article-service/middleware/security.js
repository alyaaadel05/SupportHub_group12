
const crypto = require("node:crypto");

// ========================================
// 1. GET THE CURRENT LOGGED-IN USER
// ========================================

function currentUser(req) {
  const user = req.session?.user;

  if (!user) {
    return null;
  }

  const id = Number(user.id ?? user.user_id);

  if (!Number.isSafeInteger(id) || id <= 0) {
    return null;
  }

  const role = String(user.role || "").toLowerCase();

  if (!["author", "editor", "admin"].includes(role)) {
    return null;
  }

  return {
    id,
    role
  };
}

// ========================================
// 2. REQUIRE USER LOGIN
// ========================================

function requireLogin(req, res, next) {
  req.user = currentUser(req);

  if (!req.user) {
    return res.status(401).json({
      error: "Login required"
    });
  }

  next();
}

// ========================================
// 3. ROLE-BASED AUTHORIZATION
// ========================================

function requireRole(...roles) {
  return (req, res, next) => {
    req.user = currentUser(req);

    if (!req.user) {
      return res.status(401).json({
        error: "Login required"
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: "Forbidden"
      });
    }

    next();
  };
}

// ========================================
// 4. ARTICLE OWNERSHIP CHECK
// ========================================

function canAccess(article, user) {
  if (!article || !user) {
    return false;
  }

  // Admins can manage articles.
  if (user.role === "admin") {
    return true;
  }

  // Authors can manage their own articles.
  return (
    user.role === "author" &&
    Number(article.author_id) === user.id
  );
}

// ========================================
// 5. CSRF PROTECTION
// ========================================

function requireCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const expected = req.session?.csrfToken;
  const actual = req.get("X-CSRF-Token");

  const validFormat = (token) =>
    typeof token === "string" &&
    /^[a-f0-9]{64}$/i.test(token);

  if (!validFormat(expected) || !validFormat(actual)) {
    return res.status(403).json({
      error: "Invalid or missing CSRF token"
    });
  }

  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");

  if (
    !crypto.timingSafeEqual(
      expectedBuffer,
      actualBuffer
    )
  ) {
    return res.status(403).json({
      error: "Invalid or missing CSRF token"
    });
  }

  next();
}

// ========================================
// 6. ORIGIN VALIDATION
// ========================================

function assertOrigin(allowedOrigin) {
  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return next();
    }

    const incomingOrigin = req.get("Origin");

    if (!allowedOrigin || !String(allowedOrigin || "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean)
      .includes(incomingOrigin)) {
      return res.status(403).json({
        error: "Origin not allowed"
      });
    }

    next();
  };
}

// ========================================
// 7. INTERNAL SERVICE AUTHENTICATION
// ========================================

function requireServiceSignature(req, res, next) {
  const secret = process.env.SERVICE_SHARED_SECRET;

  if (!secret || secret.length < 32) {
    return res.status(503).json({
      error: "Internal API not configured"
    });
  }

  const sender = req.get("X-Service-Name");
  const timestamp = req.get("X-Service-Timestamp");
  const signature = req.get("X-Service-Signature");

  const allowedServices = [
    "editorial-service",
    "search-analytics-service"
  ];

  if (
    !sender ||
    !allowedServices.includes(sender) ||
    !timestamp ||
    !/^\d{13}$/.test(timestamp) ||
    !signature ||
    !/^[a-f0-9]{64}$/i.test(signature)
  ) {
    return res.status(401).json({
      error: "Invalid service credentials"
    });
  }

  // Reject timestamps older or newer than 5 minutes.
  const timestampNumber = Number(timestamp);

  if (
    !Number.isSafeInteger(timestampNumber) ||
    Math.abs(Date.now() - timestampNumber) > 300000
  ) {
    return res.status(401).json({
      error: "Expired service request"
    });
  }

  // Hash the original request body.
  const body = req.rawBody || "";

  const bodyHash = crypto
    .createHash("sha256")
    .update(body)
    .digest("hex");

  // Construct the signed payload.
  const payload = [
    sender,
    timestamp,
    req.method,
    req.originalUrl,
    bodyHash
  ].join("\n");

  // Calculate expected signature.
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  // Securely compare signatures.
  const receivedBuffer = Buffer.from(
    signature,
    "hex"
  );

  const expectedBuffer = Buffer.from(
    expectedSignature,
    "hex"
  );

  if (
    !crypto.timingSafeEqual(
      receivedBuffer,
      expectedBuffer
    )
  ) {
    return res.status(401).json({
      error: "Invalid service signature"
    });
  }

  req.serviceName = sender;

  next();
}

// ========================================
// 8. EXPORT SECURITY FUNCTIONS
// ========================================

module.exports = {
  currentUser,
  requireLogin,
  requireRole,
  canAccess,
  requireCsrf,
  assertOrigin,
  requireServiceSignature
};
