
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

// ==========================================
// SUBMISSION QUALITY RULES (before review)
// ==========================================

const SUBMIT_MIN_CONTENT_LENGTH = 100;

// Returns a list of clear, user-facing problems (empty = ready for review).
function submissionIssues(draft, duplicateTitle) {
  const issues = [];
  const length = String(draft?.content || "").trim().length;

  if (length < SUBMIT_MIN_CONTENT_LENGTH) {
    issues.push(
      `Content must be at least ${SUBMIT_MIN_CONTENT_LENGTH} characters ` +
      `before it can be submitted for review (currently ${length}).`
    );
  }

  if (draft?.category_id == null || draft?.category_found == null) {
    issues.push("A valid category is required before submitting for review.");
  }

  if (duplicateTitle) {
    issues.push(
      "Another article already uses this title. " +
      "Choose a different title before submitting for review."
    );
  }

  return issues;
}

async function transitionStatus(id, from, to, user) {
  id = validId(id);

  // This function is for authenticated
  // Article Service callers.
  if (
    !user ||
    !Number.isSafeInteger(Number(user.id)) ||
    Number(user.id) <= 0 ||
    !["author", "admin"].includes(user.role)
  ) {
    throw httpError(403, "Forbidden");
  }

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

  // Authors may submit their own drafts.
  // Other transitions require a separate
  // authorized Editorial workflow.
  if (
    user.role !== "admin" &&
    (from !== "draft" || to !== "in_review")
  ) {
    throw httpError(
      403,
      "Authors can only submit drafts for review"
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Submission quality rules (draft -> in_review only). The row is locked
    // first so the checked title/content are exactly what gets submitted.
    if (from === "draft" && to === "in_review") {
      const locked = await client.query(
        `SELECT a.id, a.title, a.content, a.category_id,
                c.id AS category_found
         FROM articles a
         LEFT JOIN categories c ON c.id = a.category_id
         WHERE a.id = $1
           AND a.status = $2
           AND ($3::varchar = 'admin' OR a.author_id = $4)
         FOR UPDATE OF a`,
        [id, from, user.role, Number(user.id)]
      );

      const draft = locked.rows[0];

      if (!draft) {
        // Not found, not owned or not a draft: same 409 path as before.
        await client.query("ROLLBACK");
        return null;
      }

      const duplicate = await client.query(
        `SELECT 1
         FROM articles
         WHERE id <> $1
           AND lower(regexp_replace(btrim(title), '\\s+', ' ', 'g'))
             = lower(regexp_replace(btrim($2), '\\s+', ' ', 'g'))
         LIMIT 1`,
        [id, draft.title]
      );

      const issues = submissionIssues(draft, duplicate.rows.length > 0);

      if (issues.length) {
        await client.query("ROLLBACK");
        const error = httpError(422, issues.join(" "));
        error.issues = issues;
        throw error;
      }
    }

    // Check status and ownership atomically.
    const result = await client.query(
      `UPDATE articles
       SET
         status = $1,
         updated_at = NOW(),
         published_at =
           CASE
             WHEN $1::varchar = 'published'
               THEN NOW()
             WHEN $1::varchar = 'draft'
               THEN NULL
             ELSE published_at
           END
       WHERE id = $2
         AND status = $3
         AND (
           $4::varchar = 'admin'
           OR author_id = $5
         )
       RETURNING *`,
      [
        to,
        id,
        from,
        user.role,
        Number(user.id)
      ]
    );

    const article = result.rows[0];

    if (!article) {
      await client.query("ROLLBACK");
      return null;
    }

    // Store the event in the SAME transaction.
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


async function transitionEditorialStatus(
  id,
  from,
  to,
  operationId
) {
  id = validId(id);

  if (
    typeof operationId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)
  ) {
    throw httpError(400, "Valid operationId UUID required");
  }

  operationId = operationId.toLowerCase();

  const allowed = {
    draft: ["in_review"],
    in_review: ["draft", "approved"],
    approved: ["published", "draft"],
    published: ["draft"]
  };

  if (!allowed[from]?.includes(to)) {
    throw httpError(400, "Disallowed status transition");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Serialize requests using the same operation ID.
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtextextended($1::text, 0)
       )`,
      [operationId]
    );

    const previous = await client.query(
      `SELECT article_id, from_status, to_status, response
       FROM article_transition_operations
       WHERE operation_id = $1`,
      [operationId]
    );

    if (previous.rows.length > 0) {
      const saved = previous.rows[0];

      if (
        Number(saved.article_id) !== Number(id) ||
        saved.from_status !== from ||
        saved.to_status !== to
      ) {
        throw httpError(
          409,
          "operationId already used for a different transition"
        );
      }

      await client.query("COMMIT");
      return saved.response;
    }

    // Only update when the current status matches from.
    const updated = await client.query(
      `UPDATE articles
       SET status = $1,
           updated_at = NOW(),
           published_at = CASE
             WHEN $1::varchar = 'published' THEN NOW()
             WHEN $1::varchar = 'draft' THEN NULL
             ELSE published_at
           END
       WHERE id = $2 AND status = $3
       RETURNING *`,
      [to, id, from]
    );

    const article = updated.rows[0];

    if (!article) {
      throw httpError(409, "Invalid article status transition");
    }

    // Preserve SQS delivery for draft submissions.
    if (from === "draft" && to === "in_review") {
      const event = {
        eventId: randomUUID(),
        eventType: "article.submitted",
        articleId: article.id,
        occurredAt: new Date().toISOString()
      };

      await client.query(
        `INSERT INTO article_event_outbox
         (id, event_type, article_id, payload)
         VALUES ($1, $2, $3, $4)`,
        [
          event.eventId,
          event.eventType,
          article.id,
          JSON.stringify(event)
        ]
      );
    }

    const response = { article };

    // Save the original response in the same transaction.
    await client.query(
      `INSERT INTO article_transition_operations
       (operation_id, article_id, from_status, to_status, response)
       VALUES ($1, $2, $3, $4, $5)`,
      [operationId, id, from, to, JSON.stringify(response)]
    );

    await client.query("COMMIT");
    return response;

  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}

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
  transitionStatus,
  transitionEditorialStatus,
  submissionIssues,
  SUBMIT_MIN_CONTENT_LENGTH
};
