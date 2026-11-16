const crypto = require("node:crypto");

function currentUser(req) {
  const user = req.session?.user;
  if (!user) return null;
  const id = Number(user.id ?? user.user_id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { id, role: String(user.role || "reader").toLowerCase() };
}
function requireLogin(req, res, next) {
  req.user = currentUser(req);
  if (!req.user) return res.status(401).json({ error: "Login required" });
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    req.user = currentUser(req);
    if (!req.user) return res.status(401).json({ error: "Login required" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}
function canAccess(article, user) {
  return Boolean(user && (user.role === "reviewer" || Number(article.author_id) === user.id));
}
function requireCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const expected = req.session?.csrfToken;
  const actual = req.get("x-csrf-token");
  if (!expected || !actual || expected.length !== actual.length ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) {
    return res.status(403).json({ error: "Invalid or missing CSRF token" });
  }
  next();
}
function assertOrigin(origin) {
  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const incoming = req.get("origin");
    // Same-origin browser changes send Origin. Missing Origin is rejected for browser-facing state changes.
    if (incoming !== origin) return res.status(403).json({ error: "Origin not allowed" });
    next();
  };
}
function requireServiceSignature(req, res, next) {
  const secret = process.env.SERVICE_SHARED_SECRET;
  if (!secret || secret.length < 32) return res.status(503).json({ error: "Internal API not configured" });
  const sender = req.get("x-service-name");
  const timestamp = req.get("x-service-timestamp");
  const signature = req.get("x-service-signature");
  if (!sender || !["editorial-service", "search-analytics-service"].includes(sender) ||
      !timestamp || !signature || !/^\d+$/.test(timestamp)) {
    return res.status(401).json({ error: "Invalid service credentials" });
  }
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) {
    return res.status(401).json({ error: "Expired service request" });
  }
  const body = req.rawBody || "";
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  const payload = `${sender}\n${timestamp}\n${req.method}\n${req.originalUrl}\n${bodyHash}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  if (signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return res.status(401).json({ error: "Invalid service signature" });
  }
  req.serviceName = sender;
  next();
}
module.exports = { currentUser, requireLogin, requireRole, canAccess, requireCsrf, assertOrigin, requireServiceSignature };
