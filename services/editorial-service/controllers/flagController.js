
"use strict";

const flags = require("../services/flagService");
const { id } = require("../services/http");

exports.create = async (req, res, next) => {
  try {
    const { duplicate, ...flag } = await flags.flag(
      id(req.params.id),
      req.user,
      req.body
    );

    // 201 = new re-review opened; 200 = an open re-review already exists.
    res.status(duplicate ? 200 : 201).json({ flag, duplicate });
  } catch (error) {
    next(error);
  }
};

exports.listOpen = async (req, res, next) => {
  try {
    const result = await flags.listOpen({
      limit: req.query.limit,
      offset: req.query.offset
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
};

exports.resolve = async (req, res, next) => {
  try {
    const flag = await flags.resolve(
      id(req.params.id),
      req.user,
      req.body
    );

    res.json({ flag });
  } catch (error) {
    next(error);
  }
};

// POST /internal/auto-flags (signed, from Search Service)
exports.autoFlag = async (req, res, next) => {
  try {
    const { duplicate, ...flag } = await flags.autoFlag(req.body);

    console.log(
      `Automatic re-review ${duplicate ? "already open" : "opened"}: article ${flag.article_id}, flag ${flag.flag_id}`
    );

    res.status(duplicate ? 200 : 201).json({ flag, duplicate });
  } catch (error) {
    next(error);
  }
};
