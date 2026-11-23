BEGIN;

CREATE TABLE IF NOT EXISTS editorial_publication_event_outbox (
  event_id UUID PRIMARY KEY,
  article_id BIGINT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type = 'editorial.publication.published'),
  payload JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN (
      'pending',
      'processing',
      'published',
      'failed',
      'needs_reconciliation'
    )),
  attempts INTEGER NOT NULL DEFAULT 0
    CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  claim_token UUID,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS editorial_publication_event_pending_idx
  ON editorial_publication_event_outbox(next_attempt_at, created_at)
  WHERE state = 'pending';

CREATE INDEX IF NOT EXISTS editorial_publication_event_processing_idx
  ON editorial_publication_event_outbox(locked_at)
  WHERE state = 'processing';

CREATE TABLE IF NOT EXISTS editorial_publication_event_receipts (
  event_id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  article_id BIGINT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS editorial_publication_receipts_article_idx
  ON editorial_publication_event_receipts(article_id, processed_at DESC);

COMMIT;
