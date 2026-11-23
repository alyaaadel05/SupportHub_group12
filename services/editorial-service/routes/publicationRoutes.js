
"use strict";

const router = require("express").Router();
const controller = require("../controllers/publicationController");

const {
  requireReviewer,
  requireBrowserWrite
} = require("../middleware/security");

// Editors and administrators can view published articles.
router.get(
  "/editorial/published",
  requireReviewer,
  controller.listPublished
);

// Editors and administrators can publish approved articles.
router.patch(
  "/articles/:id/publication",
  requireReviewer,
  requireBrowserWrite,
  controller.publish
);

// Protected internal notification retry endpoint.
router.post(
  "/editorial/notifications/retry",
  requireReviewer,
  requireBrowserWrite,
  controller.retry
);

// Manually reconcile a publication operation with an uncertain outcome.
router.post(
  "/editorial/publication-operations/:operationId/reconcile",
  requireReviewer,
  requireBrowserWrite,
  controller.reconcilePublication
);

module.exports = router;
