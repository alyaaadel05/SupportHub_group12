
const pool = require("../db/pool");
const { randomUUID } = require("node:crypto");

const {
  canAccess
} = require("../middleware/security");

// ==========================================
// 1. ERROR HELPERS
// ==========================================

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function validId(value) {
  const id = Number(value);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw httpError(400, "Invalid ID");
  }

  return id;
}

// ==========================================
// 2. VALIDATE ARTICLE
// ==========================================

function validateArticle(data) {
  if (
    !data ||
    typeof data.title !== "string" ||
    typeof data.content !== "string"
  ) {
    throw httpError(
      400,
      "Title and content are required strings"
    );
  }

  const title = data.title.trim();
  const content = data.content.trim();

  if (
    title.length < 3 ||
    title.length > 200 ||
    content.length < 10 ||
    content.length > 20000
  ) {
    throw httpError(
      400,
      "Title must be 3-200 and content 10-20000 characters"
    );
  }

  return {
    title,
    content,
    categoryId: validId(
      data.categoryId ?? data.category_id
    )
  };
}

// ==========================================
// 3. CHECK CATEGORY
// ==========================================

async function categoryExists(client, categoryId) {
  const result = await client.query(
    "SELECT 1 FROM categories WHERE id = $1",
    [categoryId]
  );

  if (!result.rowCount) {
    throw httpError(400, "Invalid category");
  }
}

// ==========================================
// 4. FIND ARTICLE
// ==========================================

async function findById(id) {
  const result = await pool.query(
    "SELECT * FROM articles WHERE id = $1",
    [validId(id)]
  );

  return result.rows[0] || null;
}

// ==========================================
// 5. CREATE ARTICLE
// ==========================================

async function create(input, user) {
  const data = validateArticle(input);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await categoryExists(
      client,
      data.categoryId
    );

    const result = await client.query(
      `INSERT INTO articles
        (title, content, category_id, author_id, status)
       VALUES
        ($1, $2, $3, $4, 'draft')
       RETURNING *`,
      [
        data.title,
        data.content,
        data.categoryId,
        user.id
      ]
    );

    const article = result.rows[0];

    // Record the first article version.
    await client.query(
      `INSERT INTO article_versions
        (
          article_id,
          version_number,
          title,
          content,
          category_id,
          edited_by
        )
       VALUES ($1, 1, $2, $3, $4, $5)`,
      [
        article.id,
        data.title,
        data.content,
        data.categoryId,
        user.id
      ]
    );

    await client.query("COMMIT");

    return article;

  } catch (error) {
    await client.query("ROLLBACK");
    throw error;

  } finally {
    client.release();
  }
}

// ==========================================
// 6. UPDATE ARTICLE
// ==========================================

async function update(id, input, user) {
  id = validId(id);

  const data = validateArticle(input);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT *
       FROM articles
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    const oldArticle = existing.rows[0];

    if (!oldArticle) {
      throw httpError(404, "Article not found");
    }

    if (!canAccess(oldArticle, user)) {
      throw httpError(403, "Forbidden");
    }

    if (oldArticle.status !== "draft") {
      throw httpError(
        409,
        "Only draft articles can be edited"
      );
    }

    await categoryExists(
      client,
      data.categoryId
    );

    const changed = await client.query(
      `UPDATE articles
       SET
         title = $1,
         content = $2,
         category_id = $3,
         updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [
        data.title,
        data.content,
        data.categoryId,
        id
      ]
    );

    // Find the latest version number.
    const versions = await client.query(
      `SELECT COALESCE(
         MAX(version_number), 0
       ) AS n
       FROM article_versions
       WHERE article_id = $1`,
      [id]
    );

    const nextVersion =
      Number(versions.rows[0].n) + 1;

    // Save the new version.
    await client.query(
      `INSERT INTO article_versions
        (
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
        data.title,
        data.content,
        data.categoryId,
        user.id
      ]
    );

    await client.query("COMMIT");

    return changed.rows[0];

  } catch (error) {
    await client.query("ROLLBACK");
    throw error;

  } finally {
    client.release();
  }
}

// ==========================================
// 7. DELETE ARTICLE
// ==========================================

async function remove(id, user) {
  id = validId(id);

  const article = await findById(id);

  if (!article) {
    throw httpError(404, "Article not found");
  }

  if (!canAccess(article, user)) {
    throw httpError(403, "Forbidden");
  }

  if (article.status !== "draft") {
    throw httpError(
      409,
      "Only drafts can be deleted"
    );
  }

  const result = await pool.query(
    `DELETE FROM articles
     WHERE id = $1
       AND status = 'draft'
     RETURNING id`,
    [id]
  );

  if (!result.rowCount) {
    throw httpError(
      409,
      "Article could not be deleted"
    );
  }
}

// ==========================================
// 8. GET MY ARTICLES
// ==========================================

async function mine(user) {
  const result = await pool.query(
    `SELECT
       id,
       title,
       content,
       category_id,
       status,
       review_comment,
       created_at,
       updated_at
     FROM articles
     WHERE author_id = $1
     ORDER BY updated_at DESC
     LIMIT 200`,
    [user.id]
  );

  return result.rows;
}

// ==========================================
// 9. CHANGE ARTICLE STATUS
// WITH TRANSACTIONAL SQS OUTBOX
// ==========================================

async function transitionStatus(id, from, to) {
  id = validId(id);

  const allowed = {
    draft: ["in_review"],
    in_review: ["draft", "approved"],
    approved: ["published", "draft"],
    published: ["draft"]
  };

  if (!allowed[from]?.includes(to)) {
    throw httpError(
      400,
      "Disallowed status transition"
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Update article only if its current status
    // matches the expected previous status.
    const result = await client.query(
      `UPDATE articles
       SET
         status = $1,
         updated_at = NOW(),
         published_at =
           CASE
             WHEN $1::varchar = 'published' THEN NOW()
             WHEN $1::varchar = 'draft' THEN NULL
             ELSE published_at
           END
       WHERE id = $2
         AND status = $3
       RETURNING *`,
      [to, id, from]
    );

    const article = result.rows[0];

    if (!article) {
      await client.query("ROLLBACK");
      return null;
    }

    // Store the submission event in the same
    // database transaction as the status update.
    if (from === "draft" && to === "in_review") {
      const event = {
        eventId: randomUUID(),
        eventType: "article.submitted",
        articleId: article.id,
        occurredAt: new Date().toISOString()
      };

      await client.query(
        `INSERT INTO article_event_outbox
         (
           id,
           event_type,
           article_id,
           payload
         )
         VALUES ($1, $2, $3, $4)`,
        [
          event.eventId,
          event.eventType,
          article.id,
          JSON.stringify(event)
        ]
      );
    }

    await client.query("COMMIT");

    return article;

  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error(
        "Transaction rollback failed:",
        rollbackError.message
      );
    }

    throw error;

  } finally {
    client.release();
  }
}

// ==========================================
// 10. EXPORT FUNCTIONS
// ==========================================

module.exports = {
  httpError,
  validId,
  validateArticle,
  findById,
  create,
  update,
  remove,
  mine,
  transitionStatus
};
