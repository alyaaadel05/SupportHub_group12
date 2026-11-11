
const express = require("express");
const pool = require("../db/pool");
const { allowRoles } = require("../middleware/security");

const router = express.Router();

router.use(allowRoles("editor", "admin"));

router.get("/queue", async (req, res) => {
  const result = await pool.query(
    `SELECT a.*, u.name AS author_name,
            c.name AS category_name
     FROM articles a
     JOIN users u ON u.id = a.author_id
     JOIN categories c ON c.id = a.category_id
     WHERE a.status = 'pending'
     ORDER BY a.updated_at ASC`
  );

  res.json({ articles: result.rows });
});

router.get("/published", async (req, res) => {
  const result = await pool.query(
    `SELECT id, title, published_at
     FROM articles
     WHERE status = 'published'
     ORDER BY published_at DESC`
  );

  res.json({ articles: result.rows });
});

router.post("/:id/approve", async (req, res) => {
  const result = await pool.query(
    `UPDATE articles
     SET status = 'published',
         review_comment = NULL,
         published_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND status = 'pending'
       AND author_id <> $2
     RETURNING id`,
    [req.params.id, req.session.user.id]
  );

  if (!result.rowCount) {
    return res.status(409).json({
      error: "Article is not pending, or you are its author"
    });
  }

  await pool.query(
    `INSERT INTO reviews(article_id, reviewer_id, decision)
     VALUES($1, $2, 'approved')`,
    [req.params.id, req.session.user.id]
  );

  await req.app.locals.audit(
    req, "ARTICLE_APPROVED", req.params.id
  );

  res.json({ message: "Article published" });
});

router.post("/:id/reject", async (req, res) => {
  const comment = req.body.comment;

  if (
    typeof comment !== "string" ||
    !comment.trim() ||
    comment.length > 2000
  ) {
    return res.status(400).json({
      error: "A rejection reason is required"
    });
  }

  const result = await pool.query(
    `UPDATE articles
     SET status = 'rejected',
         review_comment = $1,
         updated_at = NOW()
     WHERE id = $2 AND status = 'pending'
       AND author_id <> $3
     RETURNING id`,
    [
      comment.trim(),
      req.params.id,
      req.session.user.id
    ]
  );

  if (!result.rowCount) {
    return res.status(409).json({
      error: "Article cannot be rejected"
    });
  }

  await pool.query(
    `INSERT INTO reviews
     (article_id, reviewer_id, decision, comment)
     VALUES($1, $2, 'rejected', $3)`,
    [
      req.params.id,
      req.session.user.id,
      comment.trim()
    ]
  );

  await req.app.locals.audit(
    req, "ARTICLE_REJECTED", req.params.id
  );

  res.json({ message: "Article rejected" });
});

router.post("/:id/flag", async (req, res) => {
  const comment = req.body.comment;

  if (
    typeof comment !== "string" ||
    !comment.trim() ||
    comment.length > 2000
  ) {
    return res.status(400).json({
      error: "A reason is required"
    });
  }

  const result = await pool.query(
    `UPDATE articles
     SET status = 'outdated',
         review_comment = $1,
         updated_at = NOW()
     WHERE id = $2 AND status = 'published'
     RETURNING id`,
    [comment.trim(), req.params.id]
  );

  if (!result.rowCount) {
    return res.status(409).json({
      error: "Only published articles can be flagged"
    });
  }

  await pool.query(
    `INSERT INTO reviews
     (article_id, reviewer_id, decision, comment)
     VALUES($1, $2, 'outdated', $3)`,
    [
      req.params.id,
      req.session.user.id,
      comment.trim()
    ]
  );

  await req.app.locals.audit(
    req, "ARTICLE_FLAGGED_OUTDATED", req.params.id
  );

  res.json({ message: "Article flagged as outdated" });
});

module.exports = router;
