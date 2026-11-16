const pool = require("../db/pool");
async function overview() {
  const [searches, views, votes, clicks, popular, gaps, articles, sentiments] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE result_count > 0)::int AS successful,
      COUNT(*) FILTER (WHERE result_count=0)::int AS zero FROM search_logs`),
    pool.query(`SELECT COUNT(*)::int AS total FROM article_views`),
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE helpful)::int AS helpful FROM helpfulness_votes`),
    pool.query(`SELECT COUNT(DISTINCT search_id)::int AS clicked_searches FROM search_result_clicks`),
    pool.query(`SELECT LOWER(query_text) AS term,COUNT(*)::int AS count FROM search_logs
       WHERE query_text <> '' GROUP BY LOWER(query_text) ORDER BY count DESC LIMIT 10`),
    pool.query(`SELECT LOWER(query_text) AS term,COUNT(*)::int AS count FROM search_logs
       WHERE query_text <> '' AND result_count=0 GROUP BY LOWER(query_text) ORDER BY count DESC LIMIT 10`),
    pool.query(`SELECT a.article_id,a.title,COUNT(DISTINCT v.view_id)::int AS views,
       COUNT(DISTINCT h.vote_id) FILTER (WHERE h.helpful)::int AS helpful_votes,
       COUNT(DISTINCT h.vote_id) FILTER (WHERE NOT h.helpful)::int AS unhelpful_votes
       FROM search_published_articles a LEFT JOIN article_views v ON v.article_id=a.article_id
       LEFT JOIN helpfulness_votes h ON h.article_id=a.article_id GROUP BY a.article_id,a.title
       ORDER BY views DESC LIMIT 10`),
    pool.query(`SELECT sentiment_label AS label,COUNT(*)::int AS count FROM article_feedback
       WHERE sentiment_status='completed' AND sentiment_label IS NOT NULL
       GROUP BY sentiment_label ORDER BY count DESC LIMIT 10`)
  ]);
  const s=searches.rows[0],v=votes.rows[0];
  const percent=(n,d)=> d ? Math.round(10000*n/d)/100 : 0;
  return {
    totalSearches:s.total, successfulSearches:s.successful, zeroResultSearches:s.zero,
    searchSuccessRate:percent(s.successful,s.total), zeroResultRate:percent(s.zero,s.total),
    searchesWithClicks:clicks.rows[0].clicked_searches,
    clickThroughRate:percent(clicks.rows[0].clicked_searches,s.total),
    totalArticleViews:views.rows[0].total, totalVotes:v.total, helpfulnessRate:percent(v.helpful,v.total),
    popularSearchTerms:popular.rows, knowledgeGaps:gaps.rows,
    mostViewedArticles:articles.rows, sentimentBreakdown:sentiments.rows
  };
}
module.exports = { overview };
