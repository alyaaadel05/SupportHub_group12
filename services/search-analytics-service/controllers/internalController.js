const service = require("../services/indexService");
exports.publication = async (req,res,next) => {
  try { res.json(await service.publish(req.body || {})); } catch(e) { next(e); }
};
exports.unpublish = async (req,res,next) => {
  try { res.json(await service.removeUnpublished(req.body?.articleId)); } catch(e) { next(e); }
};
