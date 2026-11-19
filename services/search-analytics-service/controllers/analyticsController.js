const service = require("../services/analyticsService");
const counters = require("../services/countersService");
exports.overview = async (req,res,next) => {
  try { res.json(await service.overview()); } catch(error) { next(error); }
};
exports.liveCounters = async (req,res,next) => {
  try { res.json(await counters.liveCounters()); } catch(error) { next(error); }
};