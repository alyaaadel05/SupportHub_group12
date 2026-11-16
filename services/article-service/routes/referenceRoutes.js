const router=require("express").Router();
const {requireRole}=require("../middleware/security");
const {relatedQuestions}=require("../services/stackExchangeService");
const {rateLimit}=require("express-rate-limit");
router.get("/articles/related-questions",requireRole("author","reviewer"),
 rateLimit({windowMs:15*60*1000,limit:25,standardHeaders:"draft-7",legacyHeaders:false}),
 async(req,res,next)=>{try{res.json({questions:await relatedQuestions(req.query.q)});}catch(e){next(e);}});
module.exports=router;
