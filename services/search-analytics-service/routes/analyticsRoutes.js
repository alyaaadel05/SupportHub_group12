const router = require("express").Router();
const controller = require("../controllers/analyticsController");
const { requireReviewer } = require("../middleware/security");
router.get("/analytics/overview",requireReviewer,controller.overview);
module.exports = router;
