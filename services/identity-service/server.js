
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");

const pool = require("./db/pool");

const {
  sessionMiddleware,
  checkOrigin
} = require("./middleware/security");

const authRoutes = require("./routes/authRoutes");

const app = express();
const PORT = process.env.PORT || 3003;

const allowedOrigin = process.env.FRONTEND_ORIGIN;

if (!allowedOrigin) {
  throw new Error("FRONTEND_ORIGIN is required");
}

app.disable("x-powered-by");

if (process.env.NODE_ENV === "production") {
  if (!process.env.TURNSTILE_SECRET_KEY) {
    throw new Error(
      "TURNSTILE_SECRET_KEY is required in production"
    );
  }

  app.set("trust proxy", 1);
}

app.use(helmet());

app.use(cors({
  origin: allowedOrigin,
  credentials: true
}));

app.use(express.json({ limit: "100kb" }));

app.use(sessionMiddleware());

app.use(checkOrigin);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

app.use("/api/auth", authLimiter, authRoutes);

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

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found"
  });
});

app.use((error, req, res, next) => {
  console.error(
    "Identity Service Error:",
    error.message
  );

  res.status(500).json({
    error: "Internal server error"
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(
      `SupportHub Identity Service running on port ${PORT}`
    );
  });
}

module.exports = app;
