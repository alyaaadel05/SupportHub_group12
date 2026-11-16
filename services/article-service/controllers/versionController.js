const pool=require("../db/pool");
const version=require("../services/versionService");
const {validId}=require("../services/articleService");
exports.list=async(req,res,next)=>{try{
 res.json({versions:await version.list(pool,validId(req.params.id),req.user)});
}catch(e){next(e);}};
exports.get=async(req,res,next)=>{try{
 res.json({version:await version.detail(pool,validId(req.params.id),validId(req.params.versionId),req.user)});
}catch(e){next(e);}};
exports.restore=async(req,res,next)=>{try{
 const id=validId(req.params.id),versionId=validId(req.body?.versionId);
 const article=await version.restore(pool,id,versionId,req.user);
 await req.app.locals.audit(req,"article.restore",id,{versionId});
 res.json({article});
}catch(e){next(e);}};
exports.compare=async(req,res,next)=>{try{
 const id=validId(req.params.id);
 const first=await version.detail(pool,id,validId(req.query.from),req.user);
 const second=await version.detail(pool,id,validId(req.query.to),req.user);
 res.json({comparison:version.compareVersions(first,second)});
}catch(e){next(e);}};
