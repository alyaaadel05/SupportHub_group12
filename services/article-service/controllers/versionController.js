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


const backupService = require("../services/articleBackupService");
const metrics = require("../services/metricsService");

// Export article version to S3.
exports.exportBackup = async (req, res, next) => {
  try {
    const result = await backupService.exportVersion(
      pool,
      validId(req.params.id),
      validId(req.params.versionId),
      req.user
    );

    await req.app.locals.audit(
      req,
      "article.version.export",
      req.params.id,
      { versionId: req.params.versionId }
    );

    metrics.record("BackupsExported");
    await metrics.flushOnServerless();

    res.json(result);
  } catch (error) {
    // Count real backup failures (S3 / Secrets Manager / configuration: 5xx),
    // not ownership (403), missing version (404) or validation errors.
    if (Number(error?.status) >= 500) {
      metrics.record("BackupFailures");
      await metrics.flushOnServerless();
    }
    next(error);
  }
};

// Retrieve article backup from S3.
exports.getBackup = async (req, res, next) => {
  try {
    const backup = await backupService.retrieveVersion(
      pool,
      validId(req.params.id),
      validId(req.params.versionId),
      req.user
    );

    res.json({ backup });
  } catch (error) {
    next(error);
  }
};

// Restore a draft from its S3 backup (author-only, owner only).
exports.restoreBackup = async (req, res, next) => {
  try {
    const id = validId(req.params.id);
    const versionId = validId(req.params.versionId);
    const result = await backupService.restoreFromBackup(pool, id, versionId, req.user);

    await req.app.locals.audit(req, "article.restore.backup", id, { versionId });

    res.json(result);
  } catch (error) {
    next(error);
  }
};
