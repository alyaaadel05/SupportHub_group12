
const express = require("express");
const pool = require("../db/pool");
const { allowRoles } = require("../middleware/security");

const router = express.Router();

router.get(
  "/analytics/summary",
  allowRoles("editor", "admin"),
  async (req, res) => {
    const summary = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (
           WHERE status = 'published'
         )::int AS published,
         COUNT(*) FILTER (
           WHERE status = 'pending'
         )::int AS pending,
         COALESCE(SUM(views), 0)::int AS views
       FROM articles`
    );

    const feedback = await pool.query(
      `SELECT
         COUNT(*) FILTER (
           WHERE helpful = TRUE
         )::int AS helpful,
         COUNT(*) FILTER (
           WHERE helpful = FALSE
         )::int AS not_helpful
       FROM feedback`
    );

    const performance = await pool.query(
      `SELECT a.id, a.title, a.views,
         COUNT(f.id) FILTER (
           WHERE f.helpful = TRUE
         )::int AS helpful,
         COUNT(f.id) FILTER (
           WHERE f.helpful = FALSE
         )::int AS "notHelpful"
       FROM articles a
       LEFT JOIN feedback f ON f.article_id = a.id
       GROUP BY a.id
       ORDER BY a.views DESC
       LIMIT 50`
    );

    const searches = await pool.query(
      `SELECT term, COUNT(*)::int AS count
       FROM search_logs
       GROUP BY term
       ORDER BY count DESC
       LIMIT 10`
    );

    res.json({
      totalArticles: summary.rows[0].total,
      publishedArticles: summary.rows[0].published,
      pendingArticles: summary.rows[0].pending,
      totalViews: summary.rows[0].views,
      helpfulVotes: feedback.rows[0].helpful,
      notHelpfulVotes: feedback.rows[0].not_helpful,
      articlePerformance: performance.rows,
      popularSearches: searches.rows
    });
  }
);

module.exports = router;
