const publication = require("../services/publicationService");
const notifications = require("../services/notificationService");
const { id } = require("../services/http");
exports.publish = async (req, res, next) => {
  try { res.json(await publication.publish(id(req.params.id), req.user)); }
  catch(e) { next(e); }
};
exports.retry = async (req, res, next) => {
  try { res.json({ results: await notifications.retryPending() }); }
  catch(e) { next(e); }
};
