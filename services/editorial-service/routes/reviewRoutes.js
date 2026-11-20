const router = require("express").Router();
const c = require("../controllers/reviewController");
const { requireAuthor, requireReviewer, requireBrowserWrite } = require("../middleware/security");
router.post("/articles/:id/submissions", requireAuthor, requireBrowserWrite, c.submit);
router.get("/reviews", requireReviewer, c.queue);
router.post("/articles/:id/reviews", requireReviewer, requireBrowserWrite, c.decide);
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
