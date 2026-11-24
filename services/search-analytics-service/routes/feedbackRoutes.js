const router = require("express").Router();
const controller = require("../controllers/feedbackController");
const { requireLogin, requireBrowserWrite } = require("../middleware/security");
const { createLimiter } = require("../config/rateLimitProfiles");
const feedbackLimit = createLimiter("feedback", 20);
router.post("/articles/:id/votes",requireLogin,feedbackLimit,requireBrowserWrite,controller.vote);
router.post("/articles/:id/feedback",requireLogin,feedbackLimit,requireBrowserWrite,controller.comment);
module.exports = router;
