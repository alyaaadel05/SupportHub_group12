
const router = require("express").Router();

const controller = require("../controllers/categoryController");

const {
  requireRole,
  requireCsrf,
  assertOrigin
} = require("../middleware/security");

const secure = [
  assertOrigin(process.env.FRONTEND_ORIGIN),
  requireCsrf
];

const authorAccess = requireRole("author", "admin");

// List categories
router.get(
  "/categories",
  controller.list
);

// Create category
router.post(
  "/categories",
  authorAccess,
  ...secure,
  controller.create
);

// Update category
router.patch(
  "/categories/:id",
  authorAccess,
  ...secure,
  controller.update
);

// Delete category
router.delete(
  "/categories/:id",
  authorAccess,
  ...secure,
  controller.remove
);

module.exports = router;

