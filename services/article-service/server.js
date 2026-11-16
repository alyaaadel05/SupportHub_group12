require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const rateLimit = require("express-rate-limit");
const crypto = require("node:crypto");
const pool = require("./db/pool");
const { requireLogin, requireCsrf, assertOrigin, requireServiceSignature } = require("./middleware/security");
const articleService = require("./services/articleService");

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || !process.env.FRONTEND_ORIGIN) {
  throw new Error("SESSION_SECRET (32+ characters) and FRONTEND_ORIGIN are required");
}
const app = express();
const production = process.env.NODE_ENV === "production";
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({
  limit: "100kb",
  verify: (req, res, buf) => { req.rawBody = buf.toString("utf8"); }
}));
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN,
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-CSRF-Token"]
}));
app.use(session({
  store: new pgSession({ pool, tableName: "user_sessions", createTableIfMissing: true }),
  name: "supporthub.sid",
  secret: process.env.SESSION_SECRET,
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, secure: production || process.env.COOKIE_SECURE === "true", sameSite: "lax", maxAge: 8 * 60 * 60 * 1000 }
}));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false }));
app.locals.pool = pool;
app.locals.audit = async (req, action, targetId = null, details = {}) => {
  try {
    await pool.query("INSERT INTO audit_logs (user_id, action, target_id, details) VALUES ($1,$2,$3,$4)",
      [req.user?.id ?? null, action, targetId, details]);
  } catch (e) { console.error("Audit logging failed:", e.message); }
};
app.get("/api/health", async (req, res, next) => {
  try { await pool.query("SELECT 1"); res.json({ status: "ok", service: "article-service" }); }
  catch (e) { next(e); }
});
// Identity Service and this service must use the SAME session store, cookie name,
// SESSION_SECRET, and req.session.user shape. This endpoint issues a CSRF token
// from that shared session; don't expose it to unauthenticated visitors.
app.get("/api/articles/csrf", requireLogin, (req, res, next) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  req.session.save(err => err ? next(err) : res.json({ csrfToken: req.session.csrfToken }));
});
// Internal endpoints require HMAC, not cookies/CSRF. Services must never expose the shared secret.
app.get("/internal/articles/:id", requireServiceSignature, async (req, res, next) => {
  try {
    const id = articleService.validId(req.params.id);
    const article = await articleService.findById(id);
    if (!article) return res.status(404).json({ error: "Article not found" });
    // Search service may read ONLY already-published content.
    if (req.serviceName === "search-analytics-service" && article.status !== "published") {
      return res.status(404).json({ error: "Article not found" });
    }
    res.json({ article });
  } catch (e) { next(e); }
});
app.patch("/internal/articles/:id/status", requireServiceSignature, async (req, res, next) => {
  try {
    if (req.serviceName !== "editorial-service") return res.status(403).json({ error: "Forbidden" });
    const result = await articleService.transitionStatus(
      articleService.validId(req.params.id), req.body?.from, req.body?.to
    );
    if (!result) return res.status(409).json({ error: "Invalid article status transition" });
    res.json({ article: result });
  } catch (e) { next(e); }
});
const browserSecurity = [assertOrigin(process.env.FRONTEND_ORIGIN), requireCsrf];
// Order matters: specific routes before /articles/:id.
app.use("/api", require("./routes/referenceRoutes"));
app.use("/api", require("./routes/versionRoutes"), require("./routes/categoryRoutes"));
app.use("/api", require("./routes/articleRoutes"));
// Apply browser CSRF/Origin checks at the route level, so GET requests stay unaffected.
// Browser security middleware is mounted in each router on every state-changing route.
app.use((req, res) => res.status(404).json({ error: "Route not found" }));
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Request too large" });
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) return res.status(400).json({ error: "Invalid JSON" });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});
if (require.main === module) app.listen(Number(process.env.PORT || 3001), () => {
  console.log(`Article service listening on ${process.env.PORT || 3001}`);
});
module.exports = app;
