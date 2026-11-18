
const router = require("express").Router();

const c = require("../controllers/versionController");

const {
  requireRole,
  requireCsrf,
  assertOrigin
} = require("../middleware/security");

// Security for requests that modify data
const secure = [
  assertOrigin(process.env.FRONTEND_ORIGIN),
  requireCsrf
];

// Allow authors and administrators
const authorAccess = requireRole("author", "admin");

// List article versions
router.get(
  "/articles/:id/versions",
  authorAccess,
  c.list
);

// Compare two versions
router.get(
  "/articles/:id/versions/compare",
  authorAccess,
  c.compare
);

// View a specific version
router.get(
  "/articles/:id/versions/:versionId",
  authorAccess,
  c.get
);

// Restore a previous version
router.post(
  "/articles/:id/restore",
  authorAccess,
  ...secure,
  c.restore
);

module.exports = router;
