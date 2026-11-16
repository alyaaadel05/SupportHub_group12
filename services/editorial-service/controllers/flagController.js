const flags = require("../services/flagService");
const { id } = require("../services/http");
exports.create = async (req,res,next) => {
  try { res.status(201).json({ flag: await flags.flag(id(req.params.id),req.user,req.body) }); }
  catch(e) { next(e); }
};
exports.resolve = async (req,res,next) => {
  try { res.json({ flag: await flags.resolve(id(req.params.id),req.user,req.body) }); }
  catch(e) { next(e); }
};
