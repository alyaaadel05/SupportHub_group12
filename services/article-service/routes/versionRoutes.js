const router=require("express").Router();
const c=require("../controllers/versionController");
const {requireRole,requireCsrf,assertOrigin}=require("../middleware/security");
const secure=[assertOrigin(process.env.FRONTEND_ORIGIN),requireCsrf];
router.get("/articles/:id/versions",requireRole("author","reviewer"),c.list);
router.get("/articles/:id/versions/compare",requireRole("author","reviewer"),c.compare);
router.get("/articles/:id/versions/:versionId",requireRole("author","reviewer"),c.get);
router.post("/articles/:id/restore",requireRole("author","reviewer"),...secure,c.restore);
module.exports=router;
