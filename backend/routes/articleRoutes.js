
const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const pool = require("../db/pool");

const {
  requireAuth,
  allowRoles,
  verifyTurnstile
} = require("../middleware/security");

const router = express.Router();

const feedbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

function validId(value) {
  return /^\d+$/.test(String(value)) && Number(value) > 0;
}

function validArticle(body) {
  return (
    typeof body.title === "string" &&
    body.title.trim().length >= 3 &&
    body.title.trim().length <= 200 &&
    typeof body.content === "string" &&
    body.content.trim().length >= 10 &&
    body.content.trim().length <= 50000 &&
    validId(body.categoryId)
  );
}

router.get("/categories", async (req, res) => {
  const result = await pool.query(
    "SELECT id, name FROM categories ORDER BY name"
  );

  res.json({ categories: result.rows });
});

router.post("/categories",
  allowRoles("author", "admin"),
  async (req, res) => {
    const name = req.body.name;

    if (
      typeof name !== "string" ||
      name.trim().length < 2 ||
      name.trim().length > 80
    ) {
      return res.status(400).json({
        error: "Category must be 2–80 characters"
      });
    }

    try {
      const result = await pool.query(
        `INSERT INTO categories(name)
         VALUES($1)
         RETURNING id, name`,
        [name.trim()]
      );

      await req.app.locals.audit(
        req, "CATEGORY_CREATED", result.rows[0].id
      );

      res.status(201).json({
        category: result.rows[0]
      });
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          error: "Category already exists"
        });
      }
      throw error;
    }
  }
);

router.get("/articles/mine", requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT a.*, c.name AS category_name
     FROM articles a
     JOIN categories c ON c.id = a.category_id
     WHERE a.author_id = $1
     ORDER BY a.updated_at DESC`,
    [req.session.user.id]
  );

  res.json({ articles: result.rows });
});

router.get("/articles", async (req, res) => {
  const q = typeof req.query.q === "string"
    ? req.query.q.trim().slice(0, 100)
    : "";

  const category = req.query.category || "";

  if (category && !validId(category)) {
    return res.status(400).json({
      error: "Invalid category"
    });
  }

  const params = [`%${q}%`];
  let categoryCondition = "";

  if (category) {
    params.push(Number(category));
    categoryCondition = "AND a.category_id = $2";
  }

  const result = await pool.query(
    `SELECT a.id, a.title, a.content, a.views,
            a.published_at, c.name AS category_name
     FROM articles a
     JOIN categories c ON c.id = a.category_id
     WHERE a.status = 'published'
       AND (a.title ILIKE $1 OR a.content ILIKE $1)
       ${categoryCondition}
     ORDER BY a.published_at DESC
     LIMIT 100`,
    params
  );

  if (q) {
    await pool.query(
      `INSERT INTO search_logs(term)
       VALUES($1)`,
      [q.toLowerCase()]
    );
  }

  res.json({ articles: result.rows });
});

router.post("/articles",
  allowRoles("author", "admin"),
  async (req, res) => {
    if (!validArticle(req.body)) {
      return res.status(400).json({
        error: "Invalid article title, content or category"
      });
    }

    const { title, content, categoryId } = req.body;

    const category = await pool.query(
      "SELECT id FROM categories WHERE id = $1",
      [categoryId]
    );

    if (!category.rowCount) {
      return res.status(400).json({
        error: "Category does not exist"
      });
    }

    const result = await pool.query(
      `INSERT INTO articles
       (title, content, category_id, author_id, status)
       VALUES($1, $2, $3, $4, 'draft')
       RETURNING *`,
      [
        title.trim(),
        content.trim(),
        categoryId,
        req.session.user.id
      ]
    );

    await req.app.locals.audit(
      req, "ARTICLE_CREATED", result.rows[0].id
    );

    res.status(201).json({
      article: result.rows[0]
    });
  }
);

router.put("/articles/:id",
  allowRoles("author", "admin"),
  async (req, res) => {
    if (!validId(req.params.id) || !validArticle(req.body)) {
      return res.status(400).json({
        error: "Invalid article data"
      });
    }

    const { title, content, categoryId } = req.body;

    const category = await pool.query(
      "SELECT id FROM categories WHERE id = $1",
      [categoryId]
    );

    if (!category.rowCount) {
      return res.status(400).json({
        error: "Category does not exist"
      });
    }

    const result = await pool.query(
      `UPDATE articles
       SET title = $1,
           content = $2,
           category_id = $3,
           status = 'draft',
           review_comment = NULL,
           updated_at = NOW()
       WHERE id = $4
         AND author_id = $5
         AND status IN ('draft', 'rejected', 'outdated')
       RETURNING *`,
      [
        title.trim(),
        content.trim(),
        categoryId,
        req.params.id,
        req.session.user.id
      ]
    );

    if (!result.rowCount) {
      return res.status(403).json({
        error: "Article cannot be edited"
      });
    }

    await req.app.locals.audit(
      req, "ARTICLE_UPDATED", req.params.id
    );

    res.json({ article: result.rows[0] });
  }
);

router.post("/articles/:id/submit",
  allowRoles("author", "admin"),
  async (req, res) => {
    if (!validId(req.params.id)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    const result = await pool.query(
      `UPDATE articles
       SET status = 'pending',
           updated_at = NOW()
       WHERE id = $1
         AND author_id = $2
         AND status IN ('draft', 'rejected', 'outdated')
       RETURNING id`,
      [req.params.id, req.session.user.id]
    );

    if (!result.rowCount) {
      return res.status(403).json({
        error: "Article cannot be submitted"
      });
    }

    await req.app.locals.audit(
      req, "ARTICLE_SUBMITTED", req.params.id
    );

    res.json({ message: "Submitted for review" });
  }
);

router.delete("/articles/:id",
  allowRoles("author", "admin"),
  async (req, res) => {
    if (!validId(req.params.id)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    const result = await pool.query(
      `DELETE FROM articles
       WHERE id = $1
         AND author_id = $2
         AND status IN ('draft', 'rejected')
       RETURNING id`,
      [req.params.id, req.session.user.id]
    );

    if (!result.rowCount) {
      return res.status(403).json({
        error: "Article cannot be deleted"
      });
    }

    await req.app.locals.audit(
      req, "ARTICLE_DELETED", req.params.id
    );

    res.json({ message: "Article deleted" });
  }
);

router.post("/articles/:id/view", async (req, res) => {
  if (!validId(req.params.id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }

  const result = await pool.query(
    `UPDATE articles
     SET views = views + 1
     WHERE id = $1 AND status = 'published'
     RETURNING views`,
    [req.params.id]
  );

  if (!result.rowCount) {
    return res.status(404).json({
      error: "Published article not found"
    });
  }

  res.json({ views: result.rows[0].views });
});

router.post("/articles/:id/feedback",
  feedbackLimiter,
  async (req, res) => {
    if (
      !validId(req.params.id) ||
      typeof req.body.helpful !== "boolean"
    ) {
      return res.status(400).json({
        error: "Invalid feedback"
      });
    }

    const verified = await verifyTurnstile(
      req.body.turnstileToken,
      req.ip
    );

    if (!verified) {
      return res.status(400).json({
        error: "Human verification failed"
      });
    }

    const article = await pool.query(
      `SELECT id FROM articles
       WHERE id = $1 AND status = 'published'`,
      [req.params.id]
    );

    if (!article.rowCount) {
      return res.status(404).json({
        error: "Published article not found"
      });
    }

    let voterId = req.session.voterId;

    if (!voterId) {
      voterId = crypto.randomUUID();
      req.session.voterId = voterId;
    }

    await pool.query(
      `INSERT INTO feedback(article_id, voter_id, helpful)
       VALUES($1, $2, $3)
       ON CONFLICT(article_id, voter_id)
       DO UPDATE SET helpful = EXCLUDED.helpful`,
      [req.params.id, voterId, req.body.helpful]
    );

    res.json({ message: "Feedback recorded" });
  }
);

module.exports = router;
