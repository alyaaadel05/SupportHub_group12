-- ============================================================
-- SupportHub Group 12 - DISPOSABLE LOAD-TEST DATABASE ONLY
-- ============================================================
-- Core tables reconstructed from the queries used by the current
-- Identity and Article services (the authoritative definitions live
-- only in the shared Neon database, which is NOT used or contacted).
--
-- Runs automatically only inside the throwaway PostgreSQL container
-- of tests/load/stack/docker-compose.loadtest.yml (tmpfs storage).
-- NEVER run this file against Neon or any shared/production database.
-- ============================================================

-- Identity Service: users (authService.js)
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'author',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Article Service: categories (categoryController.js)
CREATE TABLE IF NOT EXISTS categories (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Article Service: articles (articleService.js, versionService.js)
-- Statuses used by the code: draft, in_review, approved, published,
-- rejected, outdated.
CREATE TABLE IF NOT EXISTS articles (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  category_id BIGINT NOT NULL REFERENCES categories(id),
  author_id BIGINT NOT NULL REFERENCES users(id),
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  review_comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_author ON articles(author_id);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category_id);

-- Article Service: version history (articleService.js, versionService.js)
CREATE TABLE IF NOT EXISTS article_versions (
  version_id BIGSERIAL PRIMARY KEY,
  article_id BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  category_id BIGINT NOT NULL,
  edited_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (article_id, version_number)
);

-- Identity and Article Services: audit trail (authService.js, server.js)
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT,
  action VARCHAR(100) NOT NULL,
  target_id BIGINT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- user_sessions is created automatically by connect-pg-simple
-- (createTableIfMissing: true) in every service.
