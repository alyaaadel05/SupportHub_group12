
const router = require("express").Router();

const articleController = require("../controllers/articleController");

const {
  requireRole,
  requireCsrf,
  assertOrigin
} = require("../middleware/security");
const { createLimiter } = require("../config/rateLimitProfiles");

// Production per-client budgets (15 min); relaxed only in the loadtest profile.
const createLimit = createLimiter("article-create", 30);
const updateLimit = createLimiter("article-update", 60);
const duplicateLimit = createLimiter("duplicate-check", 30);
const submitLimit = createLimiter("article-submit", 30);

// Security checks for requests that modify articles.
const secure = [
  assertOrigin(process.env.FRONTEND_ORIGIN),
  requireCsrf
];

// Only authors and administrators can manage articles.
const authorAccess = requireRole("author", "admin");

// Check whether an article is similar to existing articles.
router.post(
  "/articles/check-duplicates",
  authorAccess,
  duplicateLimit,
  ...secure,
  articleController.duplicates
);

// Retrieve articles belonging to the logged-in author.
router.get(
  "/articles/mine",
  authorAccess,
  articleController.mine
);

// Create a new article draft.
router.post(
  "/articles",
  authorAccess,
  createLimit,
  ...secure,
  articleController.create
);

// Retrieve one article.
router.get(
  "/articles/:id",
  authorAccess,
  articleController.get
);

// Update an existing article.
router.patch(
  "/articles/:id",
  authorAccess,
  updateLimit,
  ...secure,
  articleController.update
);

// Delete an article.
router.delete(
  "/articles/:id",
  authorAccess,
  ...secure,
  articleController.remove
);


 // Authors submit their drafts for review.
router.post(
  "/articles/:id/submit",
  authorAccess,
  submitLimit,
  ...secure,
  articleController.submit
);


module.exports = router;
