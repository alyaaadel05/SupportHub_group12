"use strict";

const defaultPool = require("../db/pool");
const { HttpError, id, text } = require("./http");
const { getArticle: defaultGetArticle } = require("./serviceClient");

const DEFAULT_LIMIT = 50;

// Automatic re-review rule (also checked by Search before it calls).
const AUTO_FLAG_MIN_UNHELPFUL = 5;
const AUTO_FLAG_MIN_RATIO = 0.6;
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

    // One open re-review per article (migration 008). A repeated or
    // concurrent report returns the existing open flag instead of opening
    // a parallel re-review. Two attempts cover the case where the open
    // flag is resolved between the INSERT and the SELECT.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await pool.query(
        `INSERT INTO editorial_outdated_flags
           (article_id, flagged_by, reason)
         VALUES ($1, $2, $3)
         ON CONFLICT (article_id) WHERE status = 'open' DO NOTHING
         RETURNING *`,
        [articleId, userId, reason]
      );

      if (result.rows[0]) {
        return { ...result.rows[0], duplicate: false };
      }

      const existing = await pool.query(
        `SELECT *
         FROM editorial_outdated_flags
         WHERE article_id = $1
           AND status = 'open'
         ORDER BY flag_id
         LIMIT 1`,
        [articleId]
      );

      if (existing.rows[0]) {
        return { ...existing.rows[0], duplicate: true };
      }
    }

    throw new HttpError(409, "Flag could not be recorded; please retry");
  }

  // Opens a re-review requested by Search Service because readers marked
  // the article unhelpful. There is no editor user, so flagged_by is NULL
  // and source = 'search' (migration 009). Editorial checks the rule again
  // so a faulty or compromised caller cannot flag arbitrary articles.
  async function autoFlag(body) {
    const articleId = id(body?.articleId);
    const unhelpful = body?.unhelpfulVotes;
    const total = body?.totalVotes;

    if (
      !Number.isSafeInteger(unhelpful) ||
      !Number.isSafeInteger(total) ||
      unhelpful < 0 ||
      total <= 0 ||
      unhelpful > total
    ) {
      throw new HttpError(400, "Invalid vote counts");
    }

    if (unhelpful < AUTO_FLAG_MIN_UNHELPFUL || unhelpful / total <= AUTO_FLAG_MIN_RATIO) {
      throw new HttpError(
        422,
        `Rule not met: needs at least ${AUTO_FLAG_MIN_UNHELPFUL} unhelpful votes and more than ${AUTO_FLAG_MIN_RATIO * 100}% unhelpful`
      );
    }

    const article = await getArticle(articleId);

    if (!article) {
      throw new HttpError(404, "Article not found");
    }

    if (article.status !== "published") {
      throw new HttpError(409, "Only published articles can be flagged");
    }

    const reason =
      `Automatic: readers marked this article unhelpful (${unhelpful} of ${total} votes)`;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await pool.query(
        `INSERT INTO editorial_outdated_flags
           (article_id, flagged_by, reason, source)
         VALUES ($1, NULL, $2, 'search')
         ON CONFLICT (article_id) WHERE status = 'open' DO NOTHING
         RETURNING *`,
        [articleId, reason]
      );

      if (result.rows[0]) {
        return { ...result.rows[0], duplicate: false };
      }

      const existing = await pool.query(
        `SELECT *
         FROM editorial_outdated_flags
         WHERE article_id = $1
           AND status = 'open'
         ORDER BY flag_id
         LIMIT 1`,
        [articleId]
      );

      if (existing.rows[0]) {
        return { ...existing.rows[0], duplicate: true };
      }
    }

    throw new HttpError(409, "Flag could not be recorded; please retry");
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

    const existing = await pool.query(
      `SELECT flag_id, article_id, status
       FROM editorial_outdated_flags
       WHERE flag_id = $1`,
      [flagId]
    );

    const current = existing.rows[0];

    if (!current) {
      throw new HttpError(404, "Flag not found");
    }

    if (current.status !== "open") {
      throw new HttpError(409, "Flag has already been resolved");
    }

    // Same rule as publication: nobody re-reviews their own article.
    // Fails closed if Article Service cannot answer (error propagates);
    // a deleted article (404) has no author left to protect.
    let article = null;

    try {
      article = await getArticle(current.article_id);
    } catch (error) {
      if (Number(error?.status) !== 404) {
        throw error;
      }
    }

    if (article && Number(article.author_id) === userId) {
      throw new HttpError(
        403,
        "Cannot resolve the re-review of your own article"
      );
    }

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

    // Resolved concurrently by another editor.
    throw new HttpError(409, "Flag has already been resolved");
  }

  return { flag, autoFlag, listOpen, resolve };
}

const defaultService = createFlagService({
  pool: defaultPool,
  getArticle: defaultGetArticle
});

module.exports = {
  ...defaultService,
  createFlagService,
  AUTO_FLAG_MIN_UNHELPFUL,
  AUTO_FLAG_MIN_RATIO
};
