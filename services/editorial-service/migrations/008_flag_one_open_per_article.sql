-- Phase 4: one open outdated-content re-review per article.
--
-- Before this migration every POST /api/articles/:id/flags inserted a new
-- open flag, so repeated or concurrent reports created several parallel
-- re-reviews for the same article. The partial unique index below lets the
-- service use INSERT ... ON CONFLICT DO NOTHING and return the existing open
-- re-review instead.
--
-- Existing duplicates are NOT deleted: every extra open flag for an article
-- is closed with an auditable resolution that points at the oldest open flag,
-- which stays open for the editor. resolved_by is set to the reporter of the
-- duplicate because the integrity constraint requires a resolver.

BEGIN;

UPDATE editorial_outdated_flags AS f
SET status = 'resolved',
    resolved_by = f.flagged_by,
    resolution = 'Duplicate of open flag #' || k.keep_id || ' (closed by migration 008)',
    resolved_at = NOW()
FROM (
  SELECT article_id, MIN(flag_id) AS keep_id
  FROM editorial_outdated_flags
  WHERE status = 'open'
  GROUP BY article_id
  HAVING COUNT(*) > 1
) AS k
WHERE f.article_id = k.article_id
  AND f.status = 'open'
  AND f.flag_id <> k.keep_id;

CREATE UNIQUE INDEX IF NOT EXISTS editorial_flags_one_open_per_article
  ON editorial_outdated_flags(article_id)
  WHERE status = 'open';

COMMIT;
