"use strict";

const express = require("express");
const router = express.Router();

const { requireLogin } = require("../middleware/security");
const controller = require("../controllers/csrfController");

router.get("/csrf-token", requireLogin, controller.getCsrfToken);

module.exports = router;
