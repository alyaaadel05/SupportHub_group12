const router = require("express").Router();
const controller = require("../controllers/analyticsController");
const { requireReviewer, requireBrowserWrite } = require("../middleware/security");
router.get("/analytics/overview",requireReviewer,controller.overview);
router.get("/analytics/live-counters",requireReviewer,controller.liveCounters);
router.post("/analytics/exports",requireReviewer,requireBrowserWrite,controller.createExport);
router.get("/analytics/exports",requireReviewer,controller.listExports);
router.get("/analytics/exports/:name",requireReviewer,controller.downloadExport);
module.exports = router;