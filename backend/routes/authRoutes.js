
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");

const pool = require("../db/pool");
const {
  requireAuth,
  verifyTurnstile
} = require("../middleware/security");

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too many attempts. Please try again later."
  }
});

router.get("/csrf", (req, res) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken =
      crypto.randomBytes(32).toString("hex");
  }

  res.json({ csrfToken: req.session.csrfToken });
});

router.get("/me", (req, res) => {
  res.json({
    user: req.session.user || null
  });
});

router.post("/register", authLimiter, async (req, res) => {
  const { name, email, password, turnstileToken } = req.body;

  if (
    typeof name !== "string" ||
    typeof email !== "string" ||
    typeof password !== "string" ||
    !name.trim() ||
    name.trim().length > 100 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    password.length < 12 ||
    password.length > 128
  ) {
    return res.status(400).json({
      error: "Enter a valid name, email and password (12–128 characters)"
    });
  }

  const verified = await verifyTurnstile(
    turnstileToken,
    req.ip
  );

  if (!verified) {
    return res.status(400).json({
      error: "Human verification failed"
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'author')
       RETURNING id`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        passwordHash
      ]
    );

    await req.app.locals.audit(
      req, "USER_REGISTERED", result.rows[0].id
    );

    res.status(201).json({
      message: "Account created successfully"
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "An account with this email already exists"
      });
    }
    throw error;
  }
});

router.post("/login", authLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.length > 254 ||
    password.length > 128
  ) {
    return res.status(400).json({
      error: "Invalid login details"
    });
  }

  const result = await pool.query(
    `SELECT id, name, email, role, password_hash
     FROM users WHERE email = $1`,
    [email.trim().toLowerCase()]
  );

  const user = result.rows[0];

  if (!user ||
      !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({
      error: "Invalid email or password"
    });
  }

  await new Promise((resolve, reject) => {
    req.session.regenerate(error =>
      error ? reject(error) : resolve()
    );
  });

  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };

  req.session.csrfToken =
    crypto.randomBytes(32).toString("hex");

  await new Promise((resolve, reject) => {
    req.session.save(error =>
      error ? reject(error) : resolve()
    );
  });

  await req.app.locals.audit(req, "USER_LOGIN", user.id);

  res.json({
    message: "Login successful",
    user: req.session.user
  });
});

router.post("/logout", requireAuth, async (req, res) => {
  await req.app.locals.audit(
    req, "USER_LOGOUT", req.session.user.id
  );

  await new Promise((resolve, reject) => {
    req.session.destroy(error =>
      error ? reject(error) : resolve()
    );
  });

  res.clearCookie("supporthub.sid", {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production"
      ? "none"
      : "lax"
  });

  res.json({ message: "Logged out" });
});

module.exports = router;
