"use strict";

const crypto = require("node:crypto");

function getCsrfToken(req, res, next) {
  if (!req.session || typeof req.session.save !== "function") {
    return next(new Error("Session unavailable"));
  }

  let token = req.session.csrfToken;

  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) {
    token = crypto.randomBytes(32).toString("hex");
  }

  req.session.csrfToken = token;

  req.session.save((error) => {
    if (error) return next(error);

    res.set("Cache-Control", "no-store");
    return res.status(200).json({ csrfToken: token });
  });
}

module.exports = { getCsrfToken };
