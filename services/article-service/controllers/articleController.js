const articles = require("../services/articleService");
const duplicates = require("../services/duplicateService");
const pool = require("../db/pool");
exports.create = async (req,res,next) => { try {
  const article = await articles.create(req.body,req.user);
  await req.app.locals.audit(req,"article.create",article.article_id);
  res.status(201).json({article});
} catch(e) { next(e); } };
exports.mine = async (req,res,next) => { try { res.json({articles: await articles.mine(req.user)}); } catch(e) {next(e);} };
exports.get = async (req,res,next) => { try {
  const article = await articles.findById(articles.validId(req.params.id));
  if (!article) throw articles.httpError(404,"Article not found");
  if (!require("../middleware/security").canAccess(article,req.user)) throw articles.httpError(403,"Forbidden");
  res.json({article});
} catch(e) { next(e); } };
exports.update = async (req,res,next) => { try {
  const article = await articles.update(articles.validId(req.params.id),req.body,req.user);
  await req.app.locals.audit(req,"article.update",article.article_id);
  res.json({article});
} catch(e) {next(e);} };
exports.remove = async (req,res,next) => { try {
  const id=articles.validId(req.params.id);
  await articles.remove(id,req.user);
  await req.app.locals.audit(req,"article.delete",id);
  res.status(204).end();
} catch(e) {next(e);} };
exports.duplicates = async (req,res,next) => { try {
  const data=articles.validateArticle(req.body);
  const excludeId = req.body.excludeId == null ? null : articles.validId(req.body.excludeId);
  const matches=await duplicates.findDuplicates(pool,req.user,data,excludeId);
  res.json({matches,threshold:25});
} catch(e) {next(e);} };
