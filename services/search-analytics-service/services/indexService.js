const pool = require("../db/pool");
const { indexPublished } = require("./searchService");
const { id } = require("./http");
async function publish(data) { return indexPublished(data); }
async function removeUnpublished(articleId) {
  const result = await pool.query("DELETE FROM search_published_articles WHERE article_id=$1", [id(articleId)]);
  return { removed: result.rowCount > 0 };
}
module.exports = { publish, removeUnpublished };
