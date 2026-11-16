const service = require("../services/searchService");
const { HttpError } = require("../services/http");
const handle = fn => async (req,res,next) => { try { await fn(req,res); } catch(e) { next(e); } };
exports.search = handle(async (req,res) => res.json(await service.search(req.query)));
exports.article = handle(async (req,res) => res.json({ article: await service.getPublicArticle(req.params.id) }));
exports.click = handle(async (req,res) => {
  if (!req.body || typeof req.body !== "object") throw new HttpError(400,"Invalid data");
  res.status(201).json(await service.logClick(req.body));
});
