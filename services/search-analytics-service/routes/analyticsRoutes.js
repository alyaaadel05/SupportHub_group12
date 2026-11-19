const router = require("express").Router();
const controller = require("../controllers/analyticsController");
const { requireReviewer } = require("../middleware/security");
router.get("/analytics/overview",requireReviewer,controller.overview);
router.get("/analytics/live-counters",requireReviewer,controller.liveCounters);
module.exports = router;