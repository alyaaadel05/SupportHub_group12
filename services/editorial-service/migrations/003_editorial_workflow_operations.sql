BEGIN;

CREATE TABLE IF NOT EXISTS editorial_workflow_operations (
  operation_id UUID PRIMARY KEY,
  article_id BIGINT NOT NULL,
  operation_type TEXT NOT NULL
    CHECK (operation_type IN ('submit', 'decide')),
  actor_id BIGINT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  decision TEXT,
  comments VARCHAR(2000) NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN (
      'pending',
      'processing',
      'completed',
      'failed',
      'needs_reconciliation'
    )),
  attempts INTEGER NOT NULL DEFAULT 0
    CHECK (attempts >= 0),
  locked_at TIMESTAMPTZ,
  claim_token UUID,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  result_review_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  CONSTRAINT editorial_workflow_operation_shape_check
    CHECK (
      (operation_type = 'submit'
        AND from_status = 'draft'
        AND to_status = 'in_review'
        AND decision IS NULL)
      OR
      (operation_type = 'decide'
        AND from_status = 'in_review'
        AND decision IS NOT NULL
        AND (
          (decision = 'approved' AND to_status = 'approved')
          OR
          (decision = 'rejected' AND to_status = 'draft')
        ))
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS editorial_workflow_one_active_article
  ON editorial_workflow_operations(article_id)
  WHERE state IN ('pending', 'processing', 'needs_reconciliation');

CREATE INDEX IF NOT EXISTS editorial_workflow_pending_idx
  ON editorial_workflow_operations(next_attempt_at, created_at)
  WHERE state = 'pending';

CREATE INDEX IF NOT EXISTS editorial_workflow_processing_idx
  ON editorial_workflow_operations(locked_at)
  WHERE state = 'processing';

COMMIT;
