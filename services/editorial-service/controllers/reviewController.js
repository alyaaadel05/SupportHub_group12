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
exports.history = async (req, res, next) => {
  try {
    const events = await reviews.history(id(req.params.id));

    res.json({
      articleId: Number(req.params.id),
      count: events.length,
      history: events
    });
  } catch (e) {
    next(e);
  }
};

exports.reconcile = async (req, res, next) => {
  try {
    const result = await reviews.reconcileReviewOperation(
      req.params.operationId
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
};