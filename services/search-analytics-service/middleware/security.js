const crypto = require("node:crypto");
function sessionUser(req) {
  const user = req.session?.user;
  const id = Number(user?.id ?? user?.user_id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { id, role: String(user.role || "reader").toLowerCase() };
}
function requireLogin(req, res, next) {
  req.user = sessionUser(req);
  if (!req.user) return res.status(401).json({ error: "Login required" });
  next();
}
function requireReviewer(req, res, next) {
  req.user = sessionUser(req);
  if (!req.user) return res.status(401).json({ error: "Login required" });
  if (req.user.role !== "reviewer") return res.status(403).json({ error: "Reviewer required" });
  next();
}
function requireBrowserWrite(req, res, next) {
  if (req.get("origin") !== process.env.FRONTEND_ORIGIN)
    return res.status(403).json({ error: "Origin not allowed" });
  const expected = req.session?.csrfToken;
  const actual = req.get("x-csrf-token");
  if (typeof expected !== "string" || typeof actual !== "string")
    return res.status(403).json({ error: "CSRF token required" });
  const x = Buffer.from(expected), y = Buffer.from(actual);
  if (x.length !== y.length || !crypto.timingSafeEqual(x, y))
    return res.status(403).json({ error: "Invalid CSRF token" });
  next();
}
function makeSignature(secret, sender, timestamp, method, path, body = "") {
  const hash = crypto.createHash("sha256").update(body).digest("hex");
  return crypto.createHmac("sha256", secret).update(
    `${sender}\n${timestamp}\n${method}\n${path}\n${hash}`).digest("hex");
}
function requireEditorialSignature(req, res, next) {
  const sender = req.get("x-service-name");
  const timestamp = req.get("x-service-timestamp");
  const signature = req.get("x-service-signature");
  const secret = process.env.SERVICE_SHARED_SECRET;
  if (!secret || secret.length < 32) return res.status(503).json({ error: "Internal service not configured" });
  if (sender !== "editorial-service" || !timestamp || !/^\d{13}$/.test(timestamp || "") ||
      Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000 ||
      !signature || !/^[0-9a-f]{64}$/i.test(signature))
    return res.status(401).json({ error: "Invalid service credentials" });
  const calculated = makeSignature(secret, sender, timestamp, req.method,
    req.originalUrl, req.rawBody || "");
  const a = Buffer.from(calculated, "hex"), b = Buffer.from(signature, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    return res.status(401).json({ error: "Invalid service signature" });
  next();
}
// Private responses (logged-in or reviewer data) must never be stored
// by browsers, proxies or the Vercel CDN.
function noStore(req, res, next) {
  res.set("Cache-Control", "no-store, private");
  res.set("Pragma", "no-cache");
  next();
}
module.exports = { sessionUser, requireLogin, requireReviewer, requireBrowserWrite,
  makeSignature, requireEditorialSignature, noStore };