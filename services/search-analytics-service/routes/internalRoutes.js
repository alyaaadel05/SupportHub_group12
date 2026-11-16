const router = require("express").Router();
const controller = require("../controllers/internalController");
const { requireEditorialSignature } = require("../middleware/security");
router.post("/publications",requireEditorialSignature,controller.publication);
router.post("/unpublications",requireEditorialSignature,controller.unpublish);
module.exports = router;
