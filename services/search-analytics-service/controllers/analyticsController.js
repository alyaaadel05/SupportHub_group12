const service = require("../services/analyticsService");
exports.overview = async (req,res,next) => {
  try { res.json(await service.overview()); } catch(error) { next(error); }
};
