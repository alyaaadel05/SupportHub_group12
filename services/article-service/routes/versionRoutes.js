
const router = require("express").Router();

const c = require("../controllers/versionController");

const {
  requireRole,
  requireCsrf,
  assertOrigin
} = require("../middleware/security");
const { createLimiter } = require("../config/rateLimitProfiles");

const restoreLimit = createLimiter("version-restore", 30);
const backupLimit = createLimiter("version-backup", 20);

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
  restoreLimit,
  ...secure,
  c.restore
);


 // Export an article version to S3
router.post(
  "/articles/:id/versions/:versionId/export",
  authorAccess,
  backupLimit,
  ...secure,
  c.exportBackup
);

// Restore a draft from its S3 backup (authors only; ownership checked in the service).
router.post(
  "/articles/:id/versions/:versionId/restore-backup",
  requireRole("author"),
  restoreLimit,
  ...secure,
  c.restoreBackup
);

// Retrieve an article version from S3
router.get(
  "/articles/:id/versions/:versionId/export",
  authorAccess,
  c.getBackup
);


module.exports = router;
