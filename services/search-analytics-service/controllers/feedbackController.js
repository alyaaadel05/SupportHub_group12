const service = require("../services/feedbackService");
const { verifyTurnstile } = require("../middleware/turnstile");
const handle = fn => async (req,res,next) => { try { await fn(req,res); } catch(e) { next(e); } };
exports.vote = handle(async (req,res) => {
  if (process.env.REQUIRE_TURNSTILE_FOR_VOTES !== "false")
    await verifyTurnstile(req.body?.turnstileToken, req.ip);
  res.json(await service.vote(req.params.id,req.user.id,req.body?.helpful));
});
exports.comment = handle(async (req,res) => {
  await verifyTurnstile(req.body?.turnstileToken,req.ip);
  res.status(201).json(await service.comment(req.params.id,req.user.id,req.body?.comment));
});
