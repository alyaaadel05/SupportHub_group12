require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const rateLimit = require("express-rate-limit");
const pool = require("./db/pool");
const { requireCronSecret } = require("./middleware/security");
const notifications = require("./services/notificationService");

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || !process.env.FRONTEND_ORIGIN)
  throw new Error("SESSION_SECRET (32+ chars) and FRONTEND_ORIGIN required");
const app = express();
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN,
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-CSRF-Token"]
}));
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "100kb" }));
// Browser calls are expected through the Cloudflare Pages same-origin /api proxy.
// Sessions must use the identical cookie name, secret and Postgres table as Identity and Article.
app.use(session({
  store: new PgSession({ pool, tableName: "user_sessions", createTableIfMissing: true }),
  name: "supporthub.sid", secret: process.env.SESSION_SECRET,
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true,
    secure: process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true",
    sameSite: "lax", maxAge: 8 * 60 * 60 * 1000 }
}));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false }));
app.get("/api/health", async (req,res,next) => {
  try { await pool.query("SELECT 1"); res.json({ status: "ok", service: "editorial-service" }); }
  catch (e) { next(e); }
});
app.use("/api", require("./routes/reviewRoutes"));
app.use("/api", require("./routes/csrfRoutes"));
app.use("/api", require("./routes/publicationRoutes"));
app.use("/api", require("./routes/flagRoutes"));
// Scheduled retry endpoint, secured with its own secret. Configure a scheduler separately.
app.post("/internal/retry-notifications", requireCronSecret, async (req,res,next) => {
  try { res.json({ results: await notifications.retryPending() }); }
  catch(e) { next(e); }
});
app.use((req,res) => res.status(404).json({ error: "Route not found" }));
app.use((error,req,res,next) => {
  if (error.type === "entity.too.large") return res.status(413).json({ error: "Request too large" });
  if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: "Invalid JSON" });
  if (error.status && error.status >= 400 && error.status < 500) return res.status(error.status).json({ error: error.message });
  console.error("Editorial API error:", error);
  res.status(500).json({ error: "Internal server error" });
});
if (require.main === module) app.listen(Number(process.env.PORT || 3002), () =>
  console.log(`Editorial Service running on port ${process.env.PORT || 3002}`));
module.exports = app;
