
const router = require("express").Router();

const { requireRole } = require("../middleware/security");
const { relatedQuestions } = require("../services/stackExchangeService");
const { rateLimit } = require("express-rate-limit");

// Find related Stack Overflow questions.
// Only authors and administrators can access this endpoint.
router.get(
  "/articles/related-questions",
  requireRole("author", "admin"),
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 25,
    standardHeaders: "draft-7",
    legacyHeaders: false
  }),
  async (req, res, next) => {
    try {
      const questions = await relatedQuestions(req.query.q);
      res.json({ questions });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;