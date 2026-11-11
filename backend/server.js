
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");
const rateLimit = require("express-rate-limit");

const pool = require("./db/pool");
const { csrfProtection } = require("./middleware/security");

// Create Express application
const app = express();

const PgSession = connectPgSimple(session);

const production = process.env.NODE_ENV === "production";

const port = Number(process.env.PORT || 3000);

const origin = process.env.FRONTEND_ORIGIN;

// Validate important environment variables
if (
  !origin ||
  !process.env.SESSION_SECRET ||
  process.env.SESSION_SECRET.length < 32
) {
  throw new Error(
    "FRONTEND_ORIGIN and SESSION_SECRET " +
    "(minimum 32 characters) are required."
  );
}

// Turnstile must be configured in production
if (production && !process.env.TURNSTILE_SECRET_KEY) {
  throw new Error(
    "TURNSTILE_SECRET_KEY is required in production."
  );
}

// Trust the hosting platform's reverse proxy
if (production) {
  app.set("trust proxy", 1);
}

// Basic security
app.disable("x-powered-by");

app.use(helmet());

// Parse JSON requests
app.use(express.json({
  limit: "100kb"
}));

// Configure frontend access
app.use(cors({
  origin: origin,
  credentials: true,
  methods: [
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "OPTIONS"
  ],
  allowedHeaders: [
    "Content-Type",
    "X-CSRF-Token"
  ]
}));

// Configure secure session cookies
const cookieSettings = {
  secure: production ||
    process.env.COOKIE_SECURE === "true",

  httpOnly: true,

  sameSite: production
    ? "none"
    : (process.env.COOKIE_SAMESITE || "lax")
};

// Store sessions in PostgreSQL
app.use(session({
  store: new PgSession({
    pool: pool,
    tableName: "user_sessions",
    createTableIfMissing: true
  }),

  name: "supporthub.sid",

  secret: process.env.SESSION_SECRET,

  resave: false,

  saveUninitialized: false,

  rolling: false,

  cookie: {
    ...cookieSettings,
    maxAge: 1000 * 60 * 60 * 8
  }
}));

// Rate limiting
app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false
}));

// CSRF protection
app.use("/api", csrfProtection);

// Make database connection available
app.locals.pool = pool;

// Store security and workflow audit events
app.locals.audit = async (
  req,
  action,
  targetId = null,
  details = {}
) => {
  try {
    await pool.query(
      `INSERT INTO audit_logs
       (user_id, action, target_id, details)
       VALUES ($1, $2, $3, $4)`,
      [
        req.session.user?.id || null,
        action,
        targetId,
        JSON.stringify(details)
      ]
    );
  } catch (error) {
    console.error(
      "Audit logging failed:",
      error.message
    );
  }
};

// Health check
app.get("/api/health", async (req, res) => {
  await pool.query("SELECT 1");

  res.json({
    status: "ok",
    service: "SupportHub API"
  });
});

// Authentication routes
app.use(
  "/api/auth",
  require("./routes/authRoutes")
);

// Article AND category routes
app.use(
  "/api",
  require("./routes/articleRoutes")
);

// Search and analytics routes
app.use(
  "/api",
  require("./routes/analyticsRoutes")
);

// Editorial review and publishing routes
app.use(
  "/api/editorial",
  require("./routes/editorialRoutes")
);

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found"
  });
});

// Central error handler
app.use((error, req, res, next) => {
  console.error(error);

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      error: "Request is too large"
    });
  }

  res.status(500).json({
    error: "Internal server error"
  });
});

// Start the server locally
if (require.main === module) {
  app.listen(port, () => {
    console.log(
      `SupportHub API running on port ${port}`
    );
  });
}

module.exports = app;
