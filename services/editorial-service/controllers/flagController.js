
"use strict";

const flags = require("../services/flagService");
const { id } = require("../services/http");

exports.create = async (req, res, next) => {
  try {
    const flag = await flags.flag(
      id(req.params.id),
      req.user,
      req.body
    );

    res.status(201).json({ flag });
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
