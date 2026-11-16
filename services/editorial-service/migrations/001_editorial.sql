-- Apply only after reviewing your existing schema. These tables are additive.
CREATE TABLE IF NOT EXISTS editorial_reviews (
  review_id BIGSERIAL PRIMARY KEY,
  article_id BIGINT NOT NULL,
  submitted_by BIGINT NOT NULL,
  reviewer_id BIGINT,
  decision TEXT NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending','approved','rejected')),
  comments VARCHAR(2000) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS editorial_one_pending_review
  ON editorial_reviews(article_id) WHERE decision='pending';
CREATE TABLE IF NOT EXISTS editorial_status_events (
  event_id BIGSERIAL PRIMARY KEY,
  article_id BIGINT NOT NULL,
  actor_id BIGINT NOT NULL,
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS editorial_outdated_flags (
  flag_id BIGSERIAL PRIMARY KEY,
  article_id BIGINT NOT NULL,
  flagged_by BIGINT NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  resolved_by BIGINT,
  resolution VARCHAR(1000) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS publication_outbox (
  outbox_id BIGSERIAL PRIMARY KEY,
  article_id BIGINT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','delivered')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS publication_outbox_pending_idx ON publication_outbox(next_attempt_at) WHERE state='pending';
