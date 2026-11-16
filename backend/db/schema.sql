
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'author'
    CHECK (role IN ('author', 'editor', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS articles (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  category_id BIGINT NOT NULL
    REFERENCES categories(id),
  author_id BIGINT NOT NULL
    REFERENCES users(id),
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (
      status IN (
        'draft',
        'pending',
        'published',
        'rejected',
        'outdated'
      )
    ),
  review_comment TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS reviews (
  id BIGSERIAL PRIMARY KEY,
  article_id BIGINT NOT NULL
    REFERENCES articles(id) ON DELETE CASCADE,
  reviewer_id BIGINT NOT NULL
    REFERENCES users(id),
  decision VARCHAR(20) NOT NULL
    CHECK (
      decision IN ('approved', 'rejected', 'outdated')
    ),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feedback (
  id BIGSERIAL PRIMARY KEY,
  article_id BIGINT NOT NULL
    REFERENCES articles(id) ON DELETE CASCADE,
  voter_id UUID NOT NULL,
  helpful BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (article_id, voter_id)
);

CREATE TABLE IF NOT EXISTS search_logs (
  id BIGSERIAL PRIMARY KEY,
  term VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT
    REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  target_id BIGINT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_articles_status
  ON articles(status);

CREATE INDEX IF NOT EXISTS idx_articles_author
  ON articles(author_id);

CREATE INDEX IF NOT EXISTS idx_articles_category
  ON articles(category_id);

CREATE INDEX IF NOT EXISTS idx_articles_updated
  ON articles(updated_at);

CREATE INDEX IF NOT EXISTS idx_search_logs_term
  ON search_logs(term);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON audit_logs(created_at);

INSERT INTO categories(name)
VALUES
  ('Account Support'),
  ('Technical Support'),
  ('General Support'),
  ('Billing Support')
ON CONFLICT (name) DO NOTHING;
