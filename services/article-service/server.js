
"use strict";

require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const rateLimit = require("express-rate-limit");
const crypto = require("node:crypto");

const pool = require("./db/pool");

const {
  requireLogin,
  requireCsrf,
  assertOrigin,
  requireServiceSignature
} = require("./middleware/security");

const articleService = require("./services/articleService");

// -----------------------------------------
// 1. ENVIRONMENT VALIDATION
// -----------------------------------------

if (
  !process.env.SESSION_SECRET ||
  process.env.SESSION_SECRET.length < 32 ||
  !process.env.FRONTEND_ORIGIN
) {
  throw new Error(
    "SESSION_SECRET (32+ characters) and FRONTEND_ORIGIN are required"
  );
}

const app = express();
const production = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
app.set("trust proxy", 1);

// -----------------------------------------
// 2. SECURITY MIDDLEWARE
// -----------------------------------------

app.use(helmet());

app.use(
  express.json({
    limit: "100kb",
    verify: (req, res, buf) => {
      req.rawBody = buf.toString("utf8");
    }
  })
);

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN,
    credentials: true,
    methods: [
      "GET",
      "POST",
      "PATCH",
      "DELETE",
      "OPTIONS"
    ],
    allowedHeaders: [
      "Content-Type",
      "X-CSRF-Token"
    ]
  })
);

// -----------------------------------------
// 3. SHARED POSTGRESQL SESSION STORAGE
// -----------------------------------------

app.use(
  session({
    store: new pgSession({
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
      secure:
        production ||
        process.env.COOKIE_SECURE === "true",
      sameSite: "lax",
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);

// -----------------------------------------
// 4. API RATE LIMITING
// -----------------------------------------

app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false
  })
);

// -----------------------------------------
// 5. DATABASE AND AUDIT LOGGING
// -----------------------------------------

app.locals.pool = pool;

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
        req.user?.id ?? null,
        action,
        targetId,
        details
      ]
    );
  } catch (error) {
    console.error(
      "Audit logging failed:",
      error.message
    );
  }
};

// -----------------------------------------
// 6. ARTICLE SERVICE HEALTH CHECK
// -----------------------------------------

app.get("/api/health", async (req, res, next) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      status: "ok",
      service: "article-service"
    });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------
// 7. AUTHENTICATED CSRF ENDPOINT
// -----------------------------------------

// Identity Service and Article Service share
// the same session store and SESSION_SECRET.

app.get(
  "/api/articles/csrf",
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

// -----------------------------------------
// 8. INTERNAL SERVICE COMMUNICATION
// -----------------------------------------

// Internal requests use HMAC signatures.
// They do not use browser sessions or CSRF.

app.get(
  "/internal/articles/:id",
  requireServiceSignature,
  async (req, res, next) => {
    try {
      const id = articleService.validId(
        req.params.id
      );

      const article = await articleService.findById(
        id
      );

      if (!article) {
        return res.status(404).json({
          error: "Article not found"
        });
      }

      // Search Service can only access
      // published articles.

      if (
        req.serviceName ===
          "search-analytics-service" &&
        article.status !== "published"
      ) {
        return res.status(404).json({
          error: "Article not found"
        });
      }

      res.json({ article });
    } catch (error) {
      next(error);
    }
  }
);

// -----------------------------------------
// 9. INTERNAL ARTICLE STATUS UPDATES
// -----------------------------------------

app.patch(
  "/internal/articles/:id/status",
  requireServiceSignature,
  async (req, res, next) => {
    try {
      if (
        req.serviceName !== "editorial-service"
      ) {
        return res.status(403).json({
          error: "Forbidden"
        });
      }

      const result =
        await articleService.transitionStatus(
          articleService.validId(
            req.params.id
          ),
          req.body?.from,
          req.body?.to
        );

      if (!result) {
        return res.status(409).json({
          error:
            "Invalid article status transition"
        });
      }

      res.json({
        article: result
      });
    } catch (error) {
      next(error);
    }
  }
);

// -----------------------------------------
// 10. ARTICLE API ROUTES
// -----------------------------------------

// Order matters: specific routes must
// appear before general article routes.

app.use(
  "/api",
  require("./routes/referenceRoutes")
);

app.use(
  "/api",
  require("./routes/versionRoutes"),
  require("./routes/categoryRoutes")
);

app.use(
  "/api",
  require("./routes/articleRoutes")
);

// Browser Origin and CSRF protection
// are applied inside each router to
// requests that modify data.

// -----------------------------------------
// 11. ROUTE NOT FOUND
// -----------------------------------------

app.use((req, res) => {
  return res.status(404).json({
    error: "Route not found"
  });
});

// -----------------------------------------
// 12. GLOBAL ERROR HANDLING
// -----------------------------------------

app.use((err, req, res, next) => {
  // Reject oversized request bodies.
  if (err.type === "entity.too.large") {
    return res.status(413).json({
      error: "Request too large"
    });
  }

  // Reject malformed JSON.
  if (
    err instanceof SyntaxError &&
    err.status === 400 &&
    "body" in err
  ) {
    return res.status(400).json({
      error: "Invalid JSON"
    });
  }

  // Graceful cloud service failure.
  // Example: Floci / AWS S3 unavailable.
  if (err.status === 503) {
    return res.status(503).json({
      error:
        "Required cloud service temporarily unavailable"
    });
  }

  // Preserve other client-side errors.
  if (
    Number.isInteger(err.status) &&
    err.status >= 400 &&
    err.status < 500
  ) {
    return res.status(err.status).json({
      error: err.message
    });
  }

  // Do not expose internal error details.
  console.error(err);

  return res.status(500).json({
    error: "Internal server error"
  });
});

// -----------------------------------------
// 13. START ARTICLE SERVICE
// -----------------------------------------

if (require.main === module) {
  const port = Number(
    process.env.PORT || 3001
  );

  app.listen(port, () => {
    console.log(
      `Article service listening on ${port}`
    );
  });
}

module.exports = app;
