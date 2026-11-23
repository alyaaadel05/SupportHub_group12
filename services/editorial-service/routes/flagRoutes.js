"use strict";

const router = require("express").Router();
const controller = require("../controllers/flagController");

const {
  requireReviewer,
  requireBrowserWrite
} = require("../middleware/security");

router.get(
  "/editorial/flags",
  requireReviewer,
  controller.listOpen
);

router.post(
  "/articles/:id/flags",
  requireReviewer,
  requireBrowserWrite,
  controller.create
);

router.patch(
  "/flags/:id",
  requireReviewer,
  requireBrowserWrite,
  controller.resolve
);

module.exports = router;
