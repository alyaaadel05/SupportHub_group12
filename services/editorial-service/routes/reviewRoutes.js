const router = require("express").Router();
const c = require("../controllers/reviewController");
const { requireAuthor, requireReviewer, requireBrowserWrite } = require("../middleware/security");
const { createLimiter } = require("../config/rateLimitProfiles");
const submitLimit = createLimiter("editorial-submission", 30);
const decisionLimit = createLimiter("editorial-decision", 60);
router.post("/articles/:id/submissions", requireAuthor, submitLimit, requireBrowserWrite, c.submit);
router.get("/reviews", requireReviewer, c.queue);
router.post("/articles/:id/reviews", requireReviewer, decisionLimit, requireBrowserWrite, c.decide);
router.get(
  "/articles/:id/history",
  requireReviewer,
  c.history
);
router.post(
  "/review-operations/:operationId/reconcile",
  requireReviewer,
  requireBrowserWrite,
  c.reconcile
);
module.exports = router;
