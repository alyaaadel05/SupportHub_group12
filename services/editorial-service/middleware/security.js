const crypto = require("node:crypto");
function userFromSession(req) {
  const raw = req.session?.user;
  if (!raw) return null;
  const id = Number(raw.id ?? raw.user_id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { id, role: String(raw.role || "reader").toLowerCase() };
}
function requireLogin(req, res, next) {
  req.user = userFromSession(req);
  if (!req.user) return res.status(401).json({ error: "Login required" });
  next();
}
function requireReviewer(req, res, next) {
  req.user = userFromSession(req);
  if (!req.user) return res.status(401).json({ error: "Login required" });
  if (req.user.role !== "reviewer") return res.status(403).json({ error: "Reviewer required" });
  next();
}
function requireAuthor(req, res, next) {
  req.user = userFromSession(req);
  if (!req.user) return res.status(401).json({ error: "Login required" });
  if (!["author", "reviewer"].includes(req.user.role)) return res.status(403).json({ error: "Author required" });
  next();
}
function requireBrowserWrite(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("origin") !== process.env.FRONTEND_ORIGIN) return res.status(403).json({ error: "Origin not allowed" });
  const expected = req.session?.csrfToken;
  const actual = req.get("x-csrf-token");
  if (typeof expected !== "string" || typeof actual !== "string")
    return res.status(403).json({ error: "Missing CSRF token" });
  const a = Buffer.from(expected), b = Buffer.from(actual);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    return res.status(403).json({ error: "Invalid CSRF token" });
  next();
}
function requireCronSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;
  const bearer = req.get("authorization") || "";
  if (!secret || secret.length < 32 || bearer !== `Bearer ${secret}`)
    return res.status(401).json({ error: "Unauthorized" });
  next();
}
module.exports = { requireLogin, requireReviewer, requireAuthor, requireBrowserWrite, requireCronSecret };
