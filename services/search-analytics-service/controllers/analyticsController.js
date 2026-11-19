const service = require("../services/analyticsService");
const counters = require("../services/countersService");
const exportsService = require("../services/exportService");
exports.overview = async (req,res,next) => {
  try { res.json(await service.overview()); } catch(error) { next(error); }
};
exports.liveCounters = async (req,res,next) => {
  try { res.json(await counters.liveCounters()); } catch(error) { next(error); }
};
exports.createExport = async (req,res,next) => {
  try { res.status(201).json(await exportsService.exportAnalytics()); } catch(error) { next(error); }
};
exports.listExports = async (req,res,next) => {
  try { res.json({ exports: await exportsService.listExports() }); } catch(error) { next(error); }
};
exports.downloadExport = async (req,res,next) => {
  try {
    const csv = await exportsService.getExport(req.params.name);
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${req.params.name}"`);
    res.send(csv);
  } catch(error) { next(error); }
};