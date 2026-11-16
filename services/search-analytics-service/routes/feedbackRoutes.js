const router = require("express").Router();
const controller = require("../controllers/feedbackController");
const { requireLogin, requireBrowserWrite } = require("../middleware/security");
router.post("/articles/:id/votes",requireLogin,requireBrowserWrite,controller.vote);
router.post("/articles/:id/feedback",requireLogin,requireBrowserWrite,controller.comment);
module.exports = router;
