const pool = require("../db/pool");
const { HttpError, id } = require("./http");
const { getPublishedArticle } = require("./serviceClient");
const { words, scoreArticle, parseSearch } = require("./ranking");
const counters = require("./countersService");
const metrics = require("./metricsService");

// Short in-memory cache of the published-article list (public data only).
// Off unless SEARCH_CACHE_MS > 0. Cleared immediately on publish/unpublish (clearSearchCache).
// Concurrent searches while it reloads share ONE database query ("single flight").
const SEARCH_CACHE_MS = Math.max(0, Number(process.env.SEARCH_CACHE_MS) || 0);
let cachedRows = null, cachedAt = 0, loading = null;

function loadPublishedArticles() {
  return pool.query(`SELECT s.article_id, s.title, s.content, s.category_id,
      c.name AS category_name, s.published_at
    FROM search_published_articles s LEFT JOIN categories c ON c.id = s.category_id
    ORDER BY s.published_at DESC LIMIT 1000`).then(r => r.rows);
}

async function publishedArticles() {
  if (!SEARCH_CACHE_MS) return loadPublishedArticles();
  if (cachedRows && Date.now() - cachedAt < SEARCH_CACHE_MS) return cachedRows;
  if (!loading) {
    loading = loadPublishedArticles()
      .then(rows => { cachedRows = rows; cachedAt = Date.now(); return rows; })
      .finally(() => { loading = null; });
  }
  return loading;
}

function clearSearchCache() { cachedRows = null; cachedAt = 0; }

// Vercel freezes a function between invocations, so the interval timers that flush the
// DynamoDB counters and CloudWatch metrics only run when the NEXT request arrives (verified
// live: the last search stayed unwritten). On Vercel the buffers are flushed before the
// response, bounded to 1.5 s and never failing the request. Elsewhere (Docker) unchanged.
async function flushOnServerless(timeoutMs = 1500) {
  if (!process.env.VERCEL) return;
  const flushes = Promise.allSettled([counters.flush(), metrics.flush()]);
  await Promise.race([flushes, new Promise(resolve => setTimeout(resolve, timeoutMs))]);
}

async function search(input) {
  const { q, page, pageSize, categoryId, terms } = parseSearch(input);
  // Bounded on purpose (see PAGINATION-REVIEW.md): at most 1000 published articles are scored.
  const all = await publishedArticles();
  const rows = categoryId ? all.filter(r => Number(r.category_id) === Number(categoryId)) : all;
  const ranked = rows.map(row => ({ ...row, relevance: scoreArticle(row, terms) }))
    .filter(row => !terms.length || row.relevance > 0)
    .sort((a,b) => b.relevance - a.relevance ||
      new Date(b.published_at) - new Date(a.published_at) || Number(a.article_id) - Number(b.article_id));
  const total = ranked.length;
  // "articles", "id" and "content" match what frontend/js/articles.js expects;
  // "results", "article_id" and "excerpt" are kept for existing clients and tests.
  const result = ranked.slice((page - 1) * pageSize, page * pageSize)
    .map(({ content, ...a }) => ({ ...a, id: a.article_id, status: "published", excerpt: content.slice(0, 180), content }));
  const logged = await pool.query(
    `INSERT INTO search_query_logs(query_text,result_count) VALUES($1,$2) RETURNING search_id`, [q,total]);
  counters.recordSearch(q, total); // DynamoDB live counter (never blocks or breaks search)
  metrics.record("Searches", 1); // CloudWatch metric
  if (total === 0) metrics.record("ZeroResultSearches", 1);
  await flushOnServerless();
  return { results: result, articles: result, total, page, pageSize, searchId: logged.rows[0].search_id };
}

async function getPublicArticle(value) {
  const articleId = id(value);
  const { rows } = await pool.query(`SELECT s.article_id, s.title, s.content, s.category_id,
      c.name AS category_name, s.published_at
    FROM search_published_articles s LEFT JOIN categories c ON c.id = s.category_id
    WHERE s.article_id = $1`, [articleId]);
  if (!rows[0]) throw new HttpError(404, "Published article not found");
  await pool.query(`INSERT INTO article_views(article_id) VALUES($1)`, [articleId]);
  counters.recordView(articleId); // DynamoDB live counter
  await flushOnServerless();
  return { ...rows[0], status: "published" };
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
  clearSearchCache(); // newly published article is searchable immediately
  return { articleId, indexed: true };
}

module.exports = { words, scoreArticle, parseSearch, search, getPublicArticle, logClick, indexPublished, clearSearchCache, flushOnServerless };