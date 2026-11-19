
require("dotenv").config();

const crypto = require("node:crypto");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const rateLimit = require("express-rate-limit");

const pool = require("./db/pool");
const { requireLogin, noStore } = require("./middleware/security");
const { requestMetrics } = require("./middleware/metrics");

const searchRoutes = require("./routes/searchRoutes");
const feedbackRoutes = require("./routes/feedbackRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const internalRoutes = require("./routes/internalRoutes");

const PORT = Number(process.env.PORT || 3004);
const production = process.env.NODE_ENV === "production";

if (
  !process.env.SESSION_SECRET ||
  process.env.SESSION_SECRET.length < 32
) {
  throw new Error(
    "SESSION_SECRET must contain at least 32 characters"
  );
}

if (!process.env.FRONTEND_ORIGIN) {
  throw new Error("FRONTEND_ORIGIN is required");
}

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

// CloudWatch request metrics (count, latency, errors) for every request.
app.use(requestMetrics);

// --------------------------------------
// 1. BASIC SECURITY
// --------------------------------------

app.use(helmet());

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN,
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "X-CSRF-Token"
  ]
}));

app.use(express.json({
  limit: "100kb",
  verify: (req, res, buffer) => {
    req.rawBody = buffer.toString("utf8");
  }
}));

// --------------------------------------
// 2. SHARED LOGIN SESSIONS
// --------------------------------------

app.use(session({
  store: new PgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true
  }),

  name: "supporthub.sid",

  secret: process.env.SESSION_SECRET,

  resave: false,
  saveUninitialized: false,

  cookie: {
    httpOnly: true,
    secure: production ||
      process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 60 * 60 * 1000
  }
}));

// --------------------------------------
// 3. RATE LIMITING
// --------------------------------------

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

app.use("/api", limiter);

// Never cache private responses (analytics, votes, feedback, CSRF, internal).
app.use("/api/analytics", noStore);
app.use("/api/articles", noStore);
app.use("/internal", noStore);

// --------------------------------------
// 4. HEALTH CHECK
// --------------------------------------

app.get("/api/health", async (req, res, next) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      status: "ok",
      service: "search-analytics-service",
      database: "connected"
    });

  } catch (error) {
    next(error);
  }
});

// --------------------------------------
// 5. CSRF TOKEN ENDPOINT
// --------------------------------------

app.get(
  "/api/analytics/csrf",
  requireLogin,
  (req, res, next) => {
    if (!req.session.csrfToken) {
      req.session.csrfToken = crypto
        .randomBytes(32)
        .toString("hex");
    }

    req.session.save((error) => {
      if (error) {
        return next(error);
      }

      res.json({
        csrfToken: req.session.csrfToken
      });
    });
  }
);

// --------------------------------------
// 6. PUBLIC AND AUTHENTICATED ROUTES
// --------------------------------------

app.use("/api", searchRoutes);

app.use("/api", feedbackRoutes);

app.use("/api", analyticsRoutes);

// Internal service-to-service requests.
app.use("/internal", internalRoutes);

// --------------------------------------
// 7. UNKNOWN ROUTES
// --------------------------------------

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found"
  });
});

// --------------------------------------
// 8. ERROR HANDLING
// --------------------------------------

app.use((error, req, res, next) => {
  if (error.type === "entity.too.large") {
    return res.status(413).json({
      error: "Request too large"
    });
  }

  if (
    error instanceof SyntaxError &&
    error.status === 400
  ) {
    return res.status(400).json({
      error: "Invalid JSON"
    });
  }

  if (
    error.status >= 400 &&
    error.status < 500
  ) {
    return res.status(error.status).json({
      error: error.message
    });
  }

  console.error(
    "Search & Analytics API error:",
    error.message
  );

  res.status(500).json({
    error: "Internal server error"
  });
});

// --------------------------------------
// 9. START SERVER
// --------------------------------------

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(
      `Search & Analytics Service listening on ${PORT}`
    );
  });
}

module.exports = app;

