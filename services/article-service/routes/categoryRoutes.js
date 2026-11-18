
const router = require("express").Router();

const controller = require("../controllers/categoryController");

const {
  requireRole,
  requireCsrf,
  assertOrigin
} = require("../middleware/security");

// Security checks for requests that modify categories.
const secure = [
  assertOrigin(process.env.FRONTEND_ORIGIN),
  requireCsrf
];

// Only authors and administrators can manage categories.
const authorAccess = requireRole("author", "admin");

// List categories.
// Publicly accessible because this only returns category names.
router.get(
  "/categories",
  controller.list
);

// Create a category.
router.post(
  "/categories",
  authorAccess,
  ...secure,
  controller.create
);

// Update a category.
router.patch(
  "/categories/:id",
  authorAccess,
  ...secure,
  controller.update
);

// Delete a category.
router.delete(
  "/categories/:id",
  authorAccess,
  ...secure,
  controller.remove
);

module.exports = router;
