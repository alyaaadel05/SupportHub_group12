
"use strict";

const publication = require("../services/publicationService");
const notifications = require("../services/notificationService");
const { id } = require("../services/http");

exports.publish = async (req, res, next) => {
  try {
    const result = await publication.publish(
      id(req.params.id),
      req.user
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
};

exports.listPublished = async (req, res, next) => {
  try {
    const articles = await publication.listPublished();

    res.json({ articles });
  } catch (error) {
    next(error);
  }
};

exports.retry = async (req, res, next) => {
  try {
    const results = await notifications.retryPending();

    res.json({ results });
  } catch (error) {
    next(error);
  }
};

exports.reconcilePublication = async (req, res, next) => {
  try {
    const result = await publication.reconcilePublication(
      req.params.operationId
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
};
