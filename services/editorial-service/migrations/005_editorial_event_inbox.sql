BEGIN;

CREATE TABLE IF NOT EXISTS editorial_event_inbox (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  article_id BIGINT NOT NULL,
  submitted_by BIGINT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS editorial_event_inbox_article_idx
  ON editorial_event_inbox(article_id, processed_at DESC);

COMMIT;
