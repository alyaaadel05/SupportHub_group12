
const authService = require("../services/authService");

const {
  ensureCsrfToken,
  generateCsrfToken
} = require("../middleware/security");

// Handle errors without exposing sensitive information.
function handleError(error, res, next) {
  if (error.status) {
    return res.status(error.status).json({
      error: error.message
    });
  }

  if (
    error.message === "Name must be between 2 and 100 characters" ||
    error.message === "Invalid email address" ||
    error.message.startsWith("Password must be")
  ) {
    return res.status(400).json({
      error: error.message
    });
  }

  next(error);
}

// Verify Cloudflare Turnstile when configured.
async function verifyTurnstile(token, ipAddress) {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }

  if (typeof token !== "string" || !token) {
    return false;
  }

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          secret,
          response: token,
          remoteip: ipAddress
        }),
        signal: AbortSignal.timeout(10000)
      }
    );

    if (!response.ok) {
      return false;
    }

    const result = await response.json();
    return result.success === true;
  } catch (error) {
    console.error(
      "Turnstile verification failed:",
      error.message
    );
    return false;
  }
}

// GET /api/auth/csrf
async function csrf(req, res, next) {
  try {
    const csrfToken = ensureCsrfToken(req);

    req.session.save((error) => {
      if (error) {
        return next(error);
      }

      res.json({ csrfToken });
    });
  } catch (error) {
    next(error);
  }
}

// POST /api/auth/register
async function register(req, res, next) {
  try {
    const {
      fullName,
      email,
      password,
      turnstileToken
    } = req.body || {};

    const verified = await verifyTurnstile(
      turnstileToken,
      req.ip
    );

    if (!verified) {
      return res.status(400).json({
        error: "Turnstile verification failed"
      });
    }

    // IMPORTANT:
    // authService.registerUser expects 3 arguments,
    // not one object.
    const user = await authService.registerUser(
      fullName,
      email,
      password
    );

    await authService.auditLog(
      user.id,
      "USER_REGISTERED",
      { email: user.email }
    );

    return res.status(201).json({
      message: "Registration successful",
      user
    });
  } catch (error) {
    handleError(error, res, next);
  }
}

// POST /api/auth/login
async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};

    let user;

    try {
      user = await authService.loginUser(email, password);
    } catch (loginError) {
      if (loginError.status === 401) {
        // Security event: failed login. Only a truncated SHA-256 of the
        // email is stored, never the password or the email itself.
        const emailHash = require("node:crypto")
          .createHash("sha256")
          .update(String(email || "").trim().toLowerCase())
          .digest("hex")
          .slice(0, 16);

        await authService.auditLog(null, "LOGIN_FAILED", {
          emailHash,
          ip: req.ip
        });
      }

      throw loginError;
    }

    // Prevent session fixation.
    req.session.regenerate((error) => {
      if (error) {
        return next(error);
      }

      req.session.user = {
        id: user.id,
        email: user.email,
        role: user.role
      };

      req.session.csrfToken = generateCsrfToken();

      req.session.save(async (saveError) => {
        if (saveError) {
          return next(saveError);
        }

        await authService.auditLog(
          user.id,
          "USER_LOGIN",
          {}
        );

        res.json({
          message: "Login successful",
          user,
          csrfToken: req.session.csrfToken
        });
      });
    });
  } catch (error) {
    handleError(error, res, next);
  }
}

// GET /api/auth/me
async function me(req, res, next) {
  try {
    if (!req.session?.user?.id) {
      return res.status(401).json({
        error: "Authentication required"
      });
    }

    const user = await authService.findUserById(
      req.session.user.id
    );

    if (!user) {
      return res.status(401).json({
        error: "User not found"
      });
    }

    res.json({ user });
  } catch (error) {
    next(error);
  }
}

// POST /api/auth/logout
async function logout(req, res, next) {
  try {
    if (!req.session?.user?.id) {
      return res.status(401).json({
        error: "Authentication required"
      });
    }

    const userId = req.session.user.id;

    req.session.destroy(async (error) => {
      if (error) {
        return next(error);
      }

      res.clearCookie("supporthub.sid", {
        path: "/",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax"
      });

      await authService.auditLog(
        userId,
        "USER_LOGOUT",
        {}
      );

      res.json({
        message: "Logout successful"
      });
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  csrf,
  csrfToken: csrf,
  getCsrfToken: csrf,
  register,
  login,
  me,
  logout
};
