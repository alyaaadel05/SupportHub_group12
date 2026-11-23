const pool = require("../db/pool");
const { indexPublished, clearSearchCache } = require("./searchService");
const { id } = require("./http");
async function publish(data) { return indexPublished(data); }
async function removeUnpublished(articleId) {
  const result = await pool.query("DELETE FROM search_published_articles WHERE article_id=$1", [id(articleId)]);
  clearSearchCache(); // unpublished article disappears from search immediately
  return { removed: result.rowCount > 0 };
}
module.exports = { publish, removeUnpublished };