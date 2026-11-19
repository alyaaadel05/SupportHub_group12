
CREATE TABLE IF NOT EXISTS article_event_outbox (
    id UUID PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    article_id BIGINT NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    last_error TEXT,

    CONSTRAINT valid_outbox_status
      CHECK (status IN ('pending', 'published'))
);

CREATE INDEX IF NOT EXISTS idx_article_outbox_pending
ON article_event_outbox (created_at)
WHERE status = 'pending';
