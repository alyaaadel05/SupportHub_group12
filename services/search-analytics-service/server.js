require("dotenv").config();
const crypto = require("node:crypto");
const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const rateLimit = require("express-rate-limit");
const pool = require("./db/pool");
const { requireLogin } = require("./middleware/security");
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || !process.env.FRONTEND_ORIGIN)
  throw new Error("SESSION_SECRET (32+ characters) and FRONTEND_ORIGIN required");
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({limit:"100kb",verify:(req,res,buffer)=>{req.rawBody=buffer.toString("utf8");}}));
app.use(session({
  store:new PgSession({pool,tableName:"user_sessions",createTableIfMissing:true}),
  name:"supporthub.sid", secret:process.env.SESSION_SECRET,
  resave:false,saveUninitialized:false,
  cookie:{httpOnly:true,secure:process.env.NODE_ENV==="production" || process.env.COOKIE_SECURE==="true",
    sameSite:"lax",maxAge:8*60*60*1000}
}));
const limiter=rateLimit({windowMs:15*60*1000,limit:300,standardHeaders:"draft-7",legacyHeaders:false});
app.use("/api",limiter);
app.get("/api/health",async(req,res,next)=>{
  try { await pool.query("SELECT 1"); res.json({status:"ok",service:"search-analytics-service"}); }
  catch(e){next(e);}
});
app.get("/api/analytics/csrf",requireLogin,(req,res,next)=>{
  if(!req.session.csrfToken) req.session.csrfToken=crypto.randomBytes(32).toString("hex");
  req.session.save(error=>error?next(error):res.json({csrfToken:req.session.csrfToken}));
});
app.use("/api",require("./routes/searchRoutes"));
app.use("/api",require("./routes/feedbackRoutes"));
app.use("/api",require("./routes/analyticsRoutes"));
app.use("/internal",require("./routes/internalRoutes"));
app.use((req,res)=>res.status(404).json({error:"Route not found"}));
app.use((error,req,res,next)=>{
  if(error.type==="entity.too.large")return res.status(413).json({error:"Request too large"});
  if(error instanceof SyntaxError && error.status===400)return res.status(400).json({error:"Invalid JSON"});
  if(error.status && error.status>=400 && error.status<500)
    return res.status(error.status).json({error:error.message});
  console.error("Search API error",error);
  res.status(500).json({error:"Internal server error"});
});
if(require.main===module) app.listen(Number(process.env.PORT||3003),()=>
  console.log(`Search & Analytics Service listening on ${process.env.PORT||3003}`));
module.exports=app;
