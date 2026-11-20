const pool = require("../db/pool");

// An article needs at least this many votes before it can be called "poorly rated",
// so one or two unhappy readers cannot flag an article on their own.
const MIN_VOTES = Math.max(1, Number(process.env.POORLY_RATED_MIN_VOTES) || 3);

async function overview() {
  const [searches, views, votes, clicks, popular, gaps, articles, sentiments, poorlyRated, daily, trending] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE result_count > 0)::int AS successful,
      COUNT(*) FILTER (WHERE result_count=0)::int AS zero FROM search_query_logs`),
    pool.query(`SELECT COUNT(*)::int AS total FROM article_views`),
    pool.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE helpful)::int AS helpful,
      COUNT(*) FILTER (WHERE NOT helpful)::int AS unhelpful FROM helpfulness_votes`),
    pool.query(`SELECT COUNT(DISTINCT search_id)::int AS clicked_searches FROM search_result_clicks`),
    pool.query(`SELECT LOWER(query_text) AS term,COUNT(*)::int AS count FROM search_query_logs
       WHERE query_text <> '' GROUP BY LOWER(query_text) ORDER BY count DESC LIMIT 10`),
    pool.query(`SELECT LOWER(query_text) AS term,COUNT(*)::int AS count FROM search_query_logs
       WHERE query_text <> '' AND result_count=0 GROUP BY LOWER(query_text) ORDER BY count DESC LIMIT 10`),
    pool.query(`SELECT a.article_id,a.title,COUNT(DISTINCT v.view_id)::int AS views,
       COUNT(DISTINCT h.vote_id) FILTER (WHERE h.helpful)::int AS helpful_votes,
       COUNT(DISTINCT h.vote_id) FILTER (WHERE NOT h.helpful)::int AS unhelpful_votes
       FROM search_published_articles a LEFT JOIN article_views v ON v.article_id=a.article_id
       LEFT JOIN helpfulness_votes h ON h.article_id=a.article_id GROUP BY a.article_id,a.title
       ORDER BY views DESC LIMIT 10`),
    pool.query(`SELECT sentiment_label AS label,COUNT(*)::int AS count FROM article_feedback
       WHERE sentiment_status='completed' AND sentiment_label IS NOT NULL
       GROUP BY sentiment_label ORDER BY count DESC LIMIT 10`),
    // Poorly rated = at least MIN_VOTES votes AND more unhelpful than helpful. Worst first.
    pool.query(`SELECT a.article_id,a.title,COUNT(*)::int AS total_votes,
       COUNT(*) FILTER (WHERE h.helpful)::int AS helpful_votes,
       COUNT(*) FILTER (WHERE NOT h.helpful)::int AS unhelpful_votes,
       ROUND(100.0*COUNT(*) FILTER (WHERE h.helpful)/COUNT(*),2)::float AS helpfulness_rate
       FROM helpfulness_votes h JOIN search_published_articles a ON a.article_id=h.article_id
       GROUP BY a.article_id,a.title
       HAVING COUNT(*) >= $1
          AND COUNT(*) FILTER (WHERE NOT h.helpful) > COUNT(*) FILTER (WHERE h.helpful)
       ORDER BY helpfulness_rate ASC, unhelpful_votes DESC LIMIT 10`, [MIN_VOTES]),
    // Activity trend: searches, views and votes for each of the last 7 days (UTC).
    // generate_series makes sure days with no activity still appear with 0.
    pool.query(`SELECT to_char(d,'YYYY-MM-DD') AS day,
       (SELECT COUNT(*)::int FROM search_query_logs WHERE searched_at >= d AND searched_at < d + INTERVAL '1 day') AS searches,
       (SELECT COUNT(*)::int FROM article_views WHERE viewed_at >= d AND viewed_at < d + INTERVAL '1 day') AS views,
       (SELECT COUNT(*)::int FROM helpfulness_votes WHERE created_at >= d AND created_at < d + INTERVAL '1 day') AS votes
       FROM generate_series(date_trunc('day', NOW()) - INTERVAL '6 days', date_trunc('day', NOW()), INTERVAL '1 day') AS d
       ORDER BY d`),
    // Trending = most viewed in the last 7 days (all-time "most viewed" can hide what is popular now).
    pool.query(`SELECT a.article_id,a.title,COUNT(*)::int AS views_last_7_days
       FROM article_views v JOIN search_published_articles a ON a.article_id=v.article_id
       WHERE v.viewed_at >= NOW() - INTERVAL '7 days'
       GROUP BY a.article_id,a.title ORDER BY views_last_7_days DESC LIMIT 5`)
  ]);
  const s=searches.rows[0],v=votes.rows[0];
  const percent=(n,d)=> d ? Math.round(10000*n/d)/100 : 0;
  return {
    totalSearches:s.total, successfulSearches:s.successful, zeroResultSearches:s.zero,
    searchSuccessRate:percent(s.successful,s.total), zeroResultRate:percent(s.zero,s.total),
    searchesWithClicks:clicks.rows[0].clicked_searches,
    clickThroughRate:percent(clicks.rows[0].clicked_searches,s.total),
    totalArticleViews:views.rows[0].total, totalVotes:v.total,
    helpfulVotes:v.helpful, unhelpfulVotes:v.unhelpful,
    helpfulnessRate:percent(v.helpful,v.total),
    popularSearchTerms:popular.rows, knowledgeGaps:gaps.rows,
    mostViewedArticles:articles.rows, sentimentBreakdown:sentiments.rows,
    poorlyRatedArticles:poorlyRated.rows, poorlyRatedMinVotes:MIN_VOTES,
    dailyActivity:daily.rows, trendingArticles:trending.rows
  };
}

module.exports = { overview, MIN_VOTES };