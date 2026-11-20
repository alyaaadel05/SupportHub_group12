
"use strict";

const router = require("express").Router();
const controller = require("../controllers/flagController");

const {
  requireReviewer,
  requireAuthor,
  requireBrowserWrite
} = require("../middleware/security");

// Editors and administrators can view open flags.
router.get(
  "/editorial/flags",
  requireReviewer,
  controller.listOpen
);

// Editors and administrators can flag published articles.
router.post(
  "/articles/:id/flags",
  requireReviewer,
  requireBrowserWrite,
  controller.create
);

// Editors and administrators can resolve flags.
router.patch(
  "/flags/:id",
  requireReviewer,
  requireBrowserWrite,
  controller.resolve
);

module.exports = router;
