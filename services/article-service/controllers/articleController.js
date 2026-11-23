
const articles = require("../services/articleService");
const duplicates = require("../services/duplicateService");
const pool = require("../db/pool");

const {
  canAccess
} = require("../middleware/security");

// ==========================================
// CREATE ARTICLE
// ==========================================

exports.create = async (req, res, next) => {
  try {
    const article = await articles.create(
      req.body,
      req.user
    );

    await req.app.locals.audit(
      req,
      "article.create",
      article.id
    );

    res.status(201).json({ article });

  } catch (error) {
    next(error);
  }
};

// ==========================================
// MY ARTICLES
// ==========================================

exports.mine = async (req, res, next) => {
  try {
    const result = await articles.mine(req.user);

    res.json({
      articles: result
    });

  } catch (error) {
    next(error);
  }
};

// ==========================================
// GET ONE ARTICLE
// ==========================================

exports.get = async (req, res, next) => {
  try {
    const id = articles.validId(req.params.id);

    const article = await articles.findById(id);

    if (!article) {
      throw articles.httpError(
        404,
        "Article not found"
      );
    }

    if (!canAccess(article, req.user)) {
      throw articles.httpError(
        403,
        "Forbidden"
      );
    }

    res.json({ article });

  } catch (error) {
    next(error);
  }
};

// ==========================================
// UPDATE ARTICLE
// ==========================================

exports.update = async (req, res, next) => {
  try {
    const id = articles.validId(req.params.id);

    const article = await articles.update(
      id,
      req.body,
      req.user
    );

    await req.app.locals.audit(
      req,
      "article.update",
      article.id
    );

    res.json({ article });

  } catch (error) {
    next(error);
  }
};

// ==========================================
// DELETE ARTICLE
// ==========================================

exports.remove = async (req, res, next) => {
  try {
    const id = articles.validId(req.params.id);

    await articles.remove(id, req.user);

    await req.app.locals.audit(
      req,
      "article.delete",
      id
    );

    res.status(204).end();

  } catch (error) {
    next(error);
  }
};

// ==========================================
// CHECK DUPLICATES
// ==========================================

exports.duplicates = async (req, res, next) => {
  try {
    const data = articles.validateArticle(req.body);

    const excludeId =
      req.body.excludeId == null
        ? null
        : articles.validId(req.body.excludeId);

    const matches = await duplicates.findDuplicates(
      pool,
      req.user,
      data,
      excludeId
    );

    res.json({
      matches,
      threshold: 25
    });

  } catch (error) {
    next(error);
  }
};

 // SUBMIT ARTICLE FOR REVIEW
exports.submit = async (req, res, next) => {
  try {
    const id = articles.validId(req.params.id);

    const article = await articles.transitionStatus(
      id,
      "draft",
      "in_review",
      req.user
    );

    if (!article) {
      return res.status(409).json({
        error: "Article is not a draft, does not exist, or access is denied"
      });
    }

    await req.app.locals.audit(
      req,
      "article.submit",
      article.id
    );

    return res.json({ article });
  } catch (error) {
    next(error);
  }
};
