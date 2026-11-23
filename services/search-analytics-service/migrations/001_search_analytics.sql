-- REVIEW AGAINST EXISTING NEON SCHEMA BEFORE EXECUTING. Additive example only.
-- The article service owns the source articles; this table is a public search projection.
CREATE TABLE IF NOT EXISTS search_published_articles (
 article_id BIGINT PRIMARY KEY,
 title VARCHAR(200) NOT NULL,
 content TEXT NOT NULL,
 category_id BIGINT NOT NULL,
 published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS search_articles_category_idx ON search_published_articles(category_id);
CREATE TABLE IF NOT EXISTS search_query_logs (
 search_id BIGSERIAL PRIMARY KEY,
 query_text VARCHAR(100) NOT NULL,
 result_count INTEGER NOT NULL CHECK(result_count >= 0),
 searched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS search_result_clicks (
 click_id BIGSERIAL PRIMARY KEY,
 search_id BIGINT NOT NULL REFERENCES search_query_logs(search_id) ON DELETE CASCADE,
 article_id BIGINT NOT NULL,
 clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS clicks_search_idx ON search_result_clicks(search_id);
CREATE TABLE IF NOT EXISTS article_views (
 view_id BIGSERIAL PRIMARY KEY,
 article_id BIGINT NOT NULL,
 viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS article_views_id_idx ON article_views(article_id);
CREATE TABLE IF NOT EXISTS helpfulness_votes (
 vote_id BIGSERIAL PRIMARY KEY,
 article_id BIGINT NOT NULL,
 user_id BIGINT NOT NULL,
 helpful BOOLEAN NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(article_id,user_id)
);
CREATE TABLE IF NOT EXISTS article_feedback (
 feedback_id BIGSERIAL PRIMARY KEY,
 article_id BIGINT NOT NULL,
 user_id BIGINT NOT NULL,
 comment_text VARCHAR(1000) NOT NULL,
 sentiment_status VARCHAR(32) NOT NULL DEFAULT 'pending',
 sentiment_label VARCHAR(32),
 sentiment_confidence DOUBLE PRECISION,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(sentiment_confidence IS NULL OR sentiment_confidence BETWEEN 0 AND 1)
);
-- Production note: add a durable reconciliation job for missed publication events.
