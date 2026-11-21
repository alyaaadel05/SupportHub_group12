
-- SupportHub Group 12
-- Article Service: idempotent Editorial transitions
-- Owner: Alyaa

CREATE TABLE IF NOT EXISTS article_transition_operations (
    operation_id UUID PRIMARY KEY,

    article_id BIGINT NOT NULL,

    from_status VARCHAR(30) NOT NULL,

    to_status VARCHAR(30) NOT NULL,

    response JSONB NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_article_transition_operations_article
ON article_transition_operations (article_id);

