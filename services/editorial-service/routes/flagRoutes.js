const router = require("express").Router();
const c = require("../controllers/flagController");
const { requireAuthor, requireReviewer, requireBrowserWrite } = require("../middleware/security");
router.post("/articles/:id/flags", requireAuthor, requireBrowserWrite, c.create);
router.patch("/flags/:id", requireReviewer, requireBrowserWrite, c.resolve);
module.exports = router;
