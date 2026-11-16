const router=require("express").Router();
const c=require("../controllers/categoryController");
const {requireRole,requireCsrf,assertOrigin}=require("../middleware/security");
const secure=[assertOrigin(process.env.FRONTEND_ORIGIN),requireCsrf];
router.get("/categories",c.list);
router.post("/categories",requireRole("reviewer"),...secure,c.create);
router.patch("/categories/:id",requireRole("reviewer"),...secure,c.update);
router.delete("/categories/:id",requireRole("reviewer"),...secure,c.remove);
module.exports=router;
