BEGIN;

ALTER TABLE publication_outbox
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claim_token UUID;

ALTER TABLE publication_outbox
  DROP CONSTRAINT IF EXISTS publication_outbox_state_check;

ALTER TABLE publication_outbox
  ADD CONSTRAINT publication_outbox_state_check
  CHECK (
    state IN (
      'pending',
      'processing',
      'delivered',
      'failed',
      'needs_reconciliation'
    )
  );

CREATE INDEX IF NOT EXISTS publication_outbox_processing_idx
  ON publication_outbox(locked_at)
  WHERE state = 'processing';

CREATE INDEX IF NOT EXISTS publication_outbox_reconciliation_idx
  ON publication_outbox(outbox_id)
  WHERE state = 'needs_reconciliation';

COMMIT;
