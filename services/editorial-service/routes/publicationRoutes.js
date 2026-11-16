const router = require("express").Router();
const c = require("../controllers/publicationController");
const { requireReviewer, requireBrowserWrite } = require("../middleware/security");
router.patch("/articles/:id/publication", requireReviewer, requireBrowserWrite, c.publish);
router.post("/editorial/notifications/retry", requireReviewer, requireBrowserWrite, c.retry);
module.exports = router;
