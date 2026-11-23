// Reconciliation job for the search index.
// Copies currently published articles into search_published_articles and
// removes articles that are no longer published (drafts, in review, rejected,
// unpublished). It only READS the Article Service "articles" table and only
// WRITES the Search service's own table. Safe to run more than once.
// Run: node scripts/sync-published.js
require("dotenv").config();
const pool = require("../db/pool");

async function syncPublished() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const indexed = await client.query(`
      INSERT INTO search_published_articles
        (article_id, title, content, category_id, published_at, updated_at)
      SELECT id, title, content, category_id,
             COALESCE(published_at, updated_at, NOW()), NOW()
      FROM articles
      WHERE status = 'published'
      ON CONFLICT (article_id) DO UPDATE SET
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        category_id = EXCLUDED.category_id,
        published_at = EXCLUDED.published_at,
        updated_at = NOW()`);
    const removed = await client.query(`
      DELETE FROM search_published_articles s
      WHERE NOT EXISTS (
        SELECT 1 FROM articles a
        WHERE a.id = s.article_id AND a.status = 'published'
      )`);
    await client.query("COMMIT");
    return { indexed: indexed.rowCount, removed: removed.rowCount };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  syncPublished()
    .then((result) => console.log("Search index synced:", result))
    .catch((error) => {
      console.error("Sync failed:", error.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { syncPublished };