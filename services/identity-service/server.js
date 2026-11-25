
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { generalLimit } = require("./config/rateLimitProfiles");
const { securityEventLogger, logSecurityEvent } = require("./middleware/securityEvents");

const { securityAlertPublisher } = require("./services/securityAlerts");

const pool = require("./db/pool");

const {
  sessionMiddleware,
  checkOrigin
} = require("./middleware/security");

const authRoutes = require("./routes/authRoutes");

const app = express();

const PORT = Number(process.env.PORT || 3003);
const allowedOrigin = process.env.FRONTEND_ORIGIN;

const allowedOrigins = allowedOrigin
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);
const production = process.env.NODE_ENV === "production";

if (!allowedOrigin) {
  throw new Error("FRONTEND_ORIGIN is required");
}

app.disable("x-powered-by");

if (production) {
  if (!process.env.TURNSTILE_SECRET_KEY) {
    throw new Error(
      "TURNSTILE_SECRET_KEY is required in production"
    );
  }

  app.set("trust proxy", 1);
}

// ==========================================
// 1. SECURITY HEADERS
// ==========================================

app.use(helmet());
app.use(securityEventLogger);
app.use(securityAlertPublisher());

// ==========================================
// 2. CORS
// ==========================================

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "X-CSRF-Token"
  ]
}));

// ==========================================
// 3. JSON REQUEST HANDLING
// ==========================================

app.use(express.json({
  limit: "100kb"
}));

// ==========================================
// 4. SESSION MANAGEMENT
// ==========================================

app.use(sessionMiddleware());

app.use(checkOrigin);

// ==========================================
// 5. RATE LIMITING
// ==========================================

// Strict protection for login and registration.
const sensitiveAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too many authentication attempts. Please try again later."
  },
  handler(req, res, next, options) {
    logSecurityEvent(req, "rate_limited", { limiter: "login-register", max: 30 });
    res.status(options.statusCode).json(options.message);
  }
});

// A higher limit for ordinary session checks,
// CSRF retrieval, and logout.
const sessionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: generalLimit(),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too many requests. Please try again later."
  }
});

// Restrict sensitive authentication endpoints.
app.use(
  "/api/auth/login",
  sensitiveAuthLimiter
);

app.use(
  "/api/auth/register",
  sensitiveAuthLimiter
);

// Restrict other authentication requests separately.
app.use(
  "/api/auth",
  sessionLimiter
);

// ==========================================
// 6. AUTHENTICATION ROUTES
// ==========================================

app.use("/api/auth", authRoutes);

// ==========================================
// 7. HEALTH CHECK
// ==========================================

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      status: "ok",
      service: "identity-service",
      database: "connected"
    });

  } catch (error) {
    console.error(
      "Database health check failed:",
      error.message
    );

    res.status(503).json({
      status: "error",
      service: "identity-service",
      database: "disconnected"
    });
  }
});

// ==========================================
// 8. UNKNOWN ROUTES
// ==========================================

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found"
  });
});

// ==========================================
// 9. ERROR HANDLING
// ==========================================

app.use((error, req, res, next) => {
  if (
    error.status >= 400 &&
    error.status < 500
  ) {
    return res.status(error.status).json({
      error: error.message
    });
  }

  console.error(
    "Identity Service Error:",
    error.message
  );

  res.status(500).json({
    error: "Internal server error"
  });
});

// ==========================================
// 10. START SERVER
// ==========================================

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(
      `SupportHub Identity Service running on port ${PORT}`
    );
  });
}

module.exports = app;
