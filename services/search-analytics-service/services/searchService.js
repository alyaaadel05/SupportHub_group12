const pool = require("../db/pool");
const { HttpError, id } = require("./http");
const { getPublishedArticle } = require("./serviceClient");
const { words, scoreArticle, parseSearch } = require("./ranking");
async function search(input) {
  const { q, page, categoryId, terms } = parseSearch(input);
  // This is intentionally bounded: coursework-sized catalogue, not a full-text engine.
  // For production-scale search, use PostgreSQL full text indexes and ranked SQL.
  const { rows } = await pool.query(`SELECT article_id,title,content,category_id,published_at
    FROM search_published_articles WHERE ($1::bigint IS NULL OR category_id=$1)
    ORDER BY published_at DESC LIMIT 1000`, [categoryId]);
  const ranked = rows.map(row => ({ ...row, relevance: scoreArticle(row, terms) }))
    .filter(row => !terms.length || row.relevance > 0)
    .sort((a,b) => b.relevance - a.relevance ||
      new Date(b.published_at) - new Date(a.published_at) || Number(a.article_id) - Number(b.article_id));
  const total = ranked.length;
  const result = ranked.slice((page-1)*10,page*10).map(({ content, ...a }) => ({ ...a, excerpt: content.slice(0, 180) }));
  const logged = await pool.query(
    `INSERT INTO search_query_logs(query_text,result_count) VALUES($1,$2) RETURNING search_id`, [q,total]);
  return { results: result, total, page, pageSize: 10, searchId: logged.rows[0].search_id };
}
async function getPublicArticle(value) {
  const articleId = id(value);
  const { rows } = await pool.query(`SELECT article_id,title,content,category_id,published_at
    FROM search_published_articles WHERE article_id=$1`, [articleId]);
  if (!rows[0]) throw new HttpError(404, "Published article not found");
  await pool.query(`INSERT INTO article_views(article_id) VALUES($1)`, [articleId]);
  return rows[0];
}
async function logClick(input) {
  const articleId = id(input.articleId);
  const searchId = id(input.searchId);
  const { rows } = await pool.query(`SELECT 1 FROM search_query_logs WHERE search_id=$1`, [searchId]);
  if (!rows[0]) throw new HttpError(404, "Search not found");
  const { rowCount } = await pool.query(`SELECT 1 FROM search_published_articles WHERE article_id=$1`, [articleId]);
  if (!rowCount) throw new HttpError(404, "Article not found");
  await pool.query(`INSERT INTO search_result_clicks(search_id,article_id) VALUES($1,$2)`, [searchId,articleId]);
  return { saved: true };
}
async function indexPublished(input) {
  const articleId = id(input.articleId ?? input.article_id);
  // Authoritative Article Service verifies published status; never trust notification content.
  const article = await getPublishedArticle(articleId);
  await pool.query(`INSERT INTO search_published_articles(article_id,title,content,category_id,published_at,updated_at)
    VALUES($1,$2,$3,$4,$5,NOW()) ON CONFLICT(article_id) DO UPDATE SET
    title=EXCLUDED.title,content=EXCLUDED.content,category_id=EXCLUDED.category_id,
    published_at=EXCLUDED.published_at,updated_at=NOW()`,
    [articleId,article.title,article.content,article.category_id,article.published_at || new Date()]);
  return { articleId, indexed: true };
}
module.exports = { words, scoreArticle, parseSearch, search, getPublicArticle, logClick, indexPublished };
