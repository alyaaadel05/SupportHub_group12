-- Automatic re-review flags requested by Search Service.
--
-- When readers mark a published article unhelpful (rule in flagService.js),
-- Search calls POST /internal/auto-flags. No editor created these flags, so
-- flagged_by is NULL and source = 'search'. Editor flags keep source = 'editor'
-- and must still name the editor.

BEGIN;

ALTER TABLE editorial_outdated_flags
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'editor';

ALTER TABLE editorial_outdated_flags
  ALTER COLUMN flagged_by DROP NOT NULL;

ALTER TABLE editorial_outdated_flags
  DROP CONSTRAINT IF EXISTS editorial_flags_source_valid;

ALTER TABLE editorial_outdated_flags
  ADD CONSTRAINT editorial_flags_source_valid
    CHECK (
      (source = 'editor' AND flagged_by IS NOT NULL)
      OR
      (source = 'search' AND flagged_by IS NULL)
    );

COMMIT;
