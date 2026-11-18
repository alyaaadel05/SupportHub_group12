-- 002: Extra indexes for the Search & Analytics Service.
-- Additive only: creates indexes, does not change or delete any data.
-- Run only after team agreement, because the Neon database is shared.
-- See INDEXING-REVIEW.md for the reasons.

-- 1. Search results are sorted by newest first.
CREATE INDEX IF NOT EXISTS search_articles_published_idx
  ON search_published_articles (published_at DESC);

-- 2. Analytics: most searched keywords.
CREATE INDEX IF NOT EXISTS search_query_logs_term_idx
  ON search_query_logs (LOWER(query_text));

-- 3. Analytics: searches that returned no results (knowledge gaps).
CREATE INDEX IF NOT EXISTS search_query_logs_zero_result_idx
  ON search_query_logs (LOWER(query_text))
  WHERE result_count = 0;

-- 4. Analytics: sentiment breakdown of written feedback.
CREATE INDEX IF NOT EXISTS article_feedback_sentiment_idx
  ON article_feedback (sentiment_status, sentiment_label);