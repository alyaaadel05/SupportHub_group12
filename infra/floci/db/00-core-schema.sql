-- ============================================================
-- SupportHub Group 12 - LOCAL INTEGRATED STACK: core tables
-- ============================================================
-- Used only by infra/floci/docker-compose.supporthub.yml (local Postgres
-- standing in for Neon during Floci testing). Based on
-- tests/load/stack/db/00-core-schema.sql (reconstructed from the services'
-- queries) with the role/status CHECK constraints of backend/db/schema.sql,
-- extended with the statuses the Editorial workflow actually uses.
-- Service-owned tables come from each service's migrations/ folder.
-- NEVER run this file against the shared Neon database.
-- ============================================================

-- Identity Service: users (authService.js)
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'author'
    CHECK (role IN ('author', 'editor', 'admin')),
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
  status VARCHAR(30) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_review', 'approved', 'published', 'rejected', 'outdated')),
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

CREATE INDEX IF NOT EXISTS idx_audit_logs_action_time ON audit_logs (action, created_at);
