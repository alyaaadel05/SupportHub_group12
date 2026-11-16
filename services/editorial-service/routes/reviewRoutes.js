const router = require("express").Router();
const c = require("../controllers/reviewController");
const { requireAuthor, requireReviewer, requireBrowserWrite } = require("../middleware/security");
router.post("/articles/:id/submissions", requireAuthor, requireBrowserWrite, c.submit);
router.get("/reviews", requireReviewer, c.queue);
router.post("/articles/:id/reviews", requireReviewer, requireBrowserWrite, c.decide);
module.exports = router;
