BEGIN;

ALTER TABLE editorial_outdated_flags
  ADD CONSTRAINT editorial_flags_article_id_positive
    CHECK (article_id > 0),
  ADD CONSTRAINT editorial_flags_flagged_by_positive
    CHECK (flagged_by > 0),
  ADD CONSTRAINT editorial_flags_resolved_by_positive
    CHECK (resolved_by IS NULL OR resolved_by > 0),
  ADD CONSTRAINT editorial_flags_reason_nonempty
    CHECK (BTRIM(reason) <> ''),
  ADD CONSTRAINT editorial_flags_resolution_state_consistent
    CHECK (
      (
        status = 'open'
        AND resolved_by IS NULL
        AND BTRIM(resolution) = ''
        AND resolved_at IS NULL
      )
      OR
      (
        status = 'resolved'
        AND resolved_by IS NOT NULL
        AND BTRIM(resolution) <> ''
        AND resolved_at IS NOT NULL
      )
    );

COMMIT;
