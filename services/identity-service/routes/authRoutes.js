
const express = require("express");

const controller = require("../controllers/authController");

const {
  requireAuth,
  requireCsrf
} = require("../middleware/security");

const router = express.Router();

// Generate a CSRF token for browser requests.
router.get("/csrf", controller.csrf);

// Create a reader account.
router.post(
  "/register",
  requireCsrf,
  controller.register
);

// Log in.
router.post(
  "/login",
  requireCsrf,
  controller.login
);

// Log out.
router.post(
  "/logout",
  requireAuth,
  requireCsrf,
  controller.logout
);

// Retrieve current authenticated user.
router.get(
  "/me",
  requireAuth,
  controller.me
);

module.exports = router;

