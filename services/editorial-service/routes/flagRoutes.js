"use strict";

const router = require("express").Router();
const controller = require("../controllers/flagController");

const {
  requireReviewer,
  requireBrowserWrite
} = require("../middleware/security");
const { createLimiter } = require("../config/rateLimitProfiles");

const flagLimit = createLimiter("editorial-flags", 60);

router.get(
  "/editorial/flags",
  requireReviewer,
  controller.listOpen
);

router.post(
  "/articles/:id/flags",
  requireReviewer,
  flagLimit,
  requireBrowserWrite,
  controller.create
);

router.patch(
  "/flags/:id",
  requireReviewer,
  flagLimit,
  requireBrowserWrite,
  controller.resolve
);

module.exports = router;
