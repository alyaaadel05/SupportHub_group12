"use strict";

const defaultPool = require("../db/pool");
const { HttpError, id, text } = require("./http");
const { getArticle: defaultGetArticle } = require("./serviceClient");

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function paginationValue(value, fallback, minimum, maximum, label) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    (maximum !== undefined && parsed > maximum)
  ) {
    throw new HttpError(400, `Invalid ${label}`);
  }

  return parsed;
}

function createFlagService({ pool, getArticle }) {
  if (!pool || typeof pool.query !== "function") {
    throw new Error("A database pool is required");
  }

  if (typeof getArticle !== "function") {
    throw new Error("An article lookup function is required");
  }

  async function flag(articleId, user, body) {
    articleId = id(articleId);
    const userId = id(user?.id);
    const reason = text(body?.reason, 1000, "Reason");

    const article = await getArticle(articleId);

    if (!article) {
      throw new HttpError(404, "Article not found");
    }

    if (article.status !== "published") {
      throw new HttpError(
        409,
        "Only published articles can be flagged"
      );
    }

    const result = await pool.query(
      `INSERT INTO editorial_outdated_flags
         (article_id, flagged_by, reason)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [articleId, userId, reason]
    );

    return result.rows[0];
  }

  async function listOpen(options = {}) {
    const limit = paginationValue(
      options.limit,
      DEFAULT_LIMIT,
      1,
      MAX_LIMIT,
      "limit"
    );

    const offset = paginationValue(
      options.offset,
      0,
      0,
      Number.MAX_SAFE_INTEGER,
      "offset"
    );

    const [countResult, flagsResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::INTEGER AS total
         FROM editorial_outdated_flags
         WHERE status = 'open'`
      ),

      pool.query(
        `SELECT *
         FROM editorial_outdated_flags
         WHERE status = 'open'
         ORDER BY created_at DESC, flag_id DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      )
    ]);

    const flags = await Promise.all(
      flagsResult.rows.map(async item => {
        try {
          const article = await getArticle(item.article_id);

          return {
            ...item,
            article: article || null,
            articleUnavailable: !article
          };
        } catch {
          return {
            ...item,
            article: null,
            articleUnavailable: true
          };
        }
      })
    );

    return {
      flags,
      total: countResult.rows[0].total,
      limit,
      offset,
      hasMore: offset + flags.length < countResult.rows[0].total
    };
  }

  async function resolve(flagId, user, body) {
    flagId = id(flagId);
    const userId = id(user?.id);

    // A resolution explanation is required for an auditable outcome.
    const resolution = text(
      body?.resolution,
      1000,
      "Resolution"
    );

    const result = await pool.query(
      `UPDATE editorial_outdated_flags
       SET status = 'resolved',
           resolved_by = $2,
           resolution = $3,
           resolved_at = NOW()
       WHERE flag_id = $1
         AND status = 'open'
       RETURNING *`,
      [flagId, userId, resolution]
    );

    if (result.rows[0]) {
      return result.rows[0];
    }

    const existing = await pool.query(
      `SELECT flag_id, status
       FROM editorial_outdated_flags
       WHERE flag_id = $1`,
      [flagId]
    );

    if (!existing.rows[0]) {
      throw new HttpError(404, "Flag not found");
    }

    throw new HttpError(409, "Flag has already been resolved");
  }

  return { flag, listOpen, resolve };
}

const defaultService = createFlagService({
  pool: defaultPool,
  getArticle: defaultGetArticle
});

module.exports = {
  ...defaultService,
  createFlagService
};
