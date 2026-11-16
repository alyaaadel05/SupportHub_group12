const reviews = require("../services/reviewService");
const { id } = require("../services/http");
exports.submit = async (req, res, next) => {
  try { res.status(201).json({ submission: await reviews.submit(id(req.params.id), req.user) }); }
  catch(e) { next(e); }
};
exports.queue = async (req, res, next) => {
  try { res.json({ reviews: await reviews.queue(req.query.status || "pending") }); }
  catch(e) { next(e); }
};
exports.decide = async (req, res, next) => {
  try { res.status(201).json({ review: await reviews.decide(id(req.params.id), req.user, req.body) }); }
  catch(e) { next(e); }
};
