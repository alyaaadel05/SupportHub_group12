
"use strict";

const { canAccess } = require("../middleware/security");

const {
  httpError,
  validId
} = require("./articleService");

const { compareVersions } = require("./versionCompare");

// -----------------------------------------
// CHECK ARTICLE ACCESS
// -----------------------------------------

async function assertAuthorized(
  pool,
  id,
  user,
  { mustBeDraft = false } = {}
) {
  id = validId(id);

  const { rows } = await pool.query(
    `SELECT id, author_id, status
     FROM articles
     WHERE id = $1`,
    [id]
  );

  const article = rows[0];

  if (!article) {
    throw httpError(404, "Article not found");
  }

  if (!canAccess(article, user)) {
    throw httpError(403, "Forbidden");
  }

  if (mustBeDraft && article.status !== "draft") {
    throw httpError(
      409,
      "Only drafts can be restored"
    );
  }

  return article;
}

// -----------------------------------------
// LIST ARTICLE VERSIONS
// -----------------------------------------

async function list(pool, id, user) {
  id = validId(id);

  await assertAuthorized(pool, id, user);

  const { rows } = await pool.query(
    `SELECT
       version_id,
       article_id,
       version_number,
       title,
       category_id,
       edited_by,
       created_at
     FROM article_versions
     WHERE article_id = $1
     ORDER BY version_number DESC`,
    [id]
  );

  return rows;
}

// -----------------------------------------
// GET ONE ARTICLE VERSION
// -----------------------------------------

async function detail(pool, id, versionId, user) {
  id = validId(id);
  versionId = validId(versionId);

  await assertAuthorized(pool, id, user);

  const { rows } = await pool.query(
    `SELECT *
     FROM article_versions
     WHERE article_id = $1
       AND version_id = $2`,
    [id, versionId]
  );

  if (!rows[0]) {
    throw httpError(404, "Version not found");
  }

  return rows[0];
}

// -----------------------------------------
// RESTORE A PREVIOUS VERSION
// -----------------------------------------

async function restore(pool, id, versionId, user) {
  versionId = validId(versionId);

  return restoreFrom(pool, id, user, async (client, articleId) => {
    const { rows } = await client.query(
      `SELECT *
       FROM article_versions
       WHERE article_id = $1
         AND version_id = $2`,
      [articleId, versionId]
    );

    return rows[0];
  });
}

// Restore a draft from a snapshot that was already validated by the
// caller (for example an S3 backup). Same locking and rules as restore().
async function restoreFromSnapshot(pool, id, snapshot, user) {
  return restoreFrom(pool, id, user, async () => snapshot);
}

// Shared restore transaction: lock the article, check access and draft
// status, apply the source title/content/category and add a version entry.
async function restoreFrom(pool, id, user, loadSource) {
  id = validId(id);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows: currentRows } = await client.query(
      `SELECT *
       FROM articles
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    const current = currentRows[0];

    if (!current) {
      throw httpError(404, "Article not found");
    }

    if (!canAccess(current, user)) {
      throw httpError(403, "Forbidden");
    }

    if (current.status !== "draft") {
      throw httpError(
        409,
        "Only draft articles can be restored"
      );
    }

    const old = await loadSource(client, id);

    if (!old) {
      throw httpError(404, "Version not found");
    }

    const { rows: updated } = await client.query(
      `UPDATE articles
       SET
         title = $1,
         content = $2,
         category_id = $3,
         updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [
        old.title,
        old.content,
        old.category_id,
        id
      ]
    );

    const { rows: last } = await client.query(
      `SELECT COALESCE(MAX(version_number), 0) AS n
       FROM article_versions
       WHERE article_id = $1`,
      [id]
    );

    const nextVersion =
      Number(last[0].n) + 1;

    await client.query(
      `INSERT INTO article_versions (
         article_id,
         version_number,
         title,
         content,
         category_id,
         edited_by
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        nextVersion,
        old.title,
        old.content,
        old.category_id,
        user.id
      ]
    );

    await client.query("COMMIT");

    return updated[0];

  } catch (error) {
    await client.query("ROLLBACK");
    throw error;

  } finally {
    client.release();
  }
}

module.exports = {
  list,
  detail,
  restore,
  restoreFromSnapshot,
  compareVersions
};
