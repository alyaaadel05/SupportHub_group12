-- ============================================================
-- SupportHub Group 12 - SYNTHETIC SEED DATA (DISPOSABLE DB ONLY)
-- ============================================================
-- Runs only inside the throwaway load-test PostgreSQL container.
-- All users, articles and reviews are fake and exist only in RAM
-- (tmpfs) for the lifetime of the container.
--
-- Synthetic login (load-test stack only):
--   loadtest-author@supporthub.test / LoadTest-Only-2026!
--   loadtest-editor@supporthub.test / LoadTest-Only-2026!
-- Hash: bcryptjs, cost 12 (same algorithm as the Identity Service).
--
-- Article IDs start at 1001 so they can never be confused with real
-- articles (for example Articles 7, 21 and 22 in the shared database).
-- ============================================================

-- Users ------------------------------------------------------
INSERT INTO users (id, name, email, password_hash, role) VALUES
  (1001, 'Load Test Author', 'loadtest-author@supporthub.test',
   '$2a$12$kMVU0zz1OxnxwwxjelJHauDlI1QglOJ3u6wV6WAvrs3aH8iojrCsi', 'author'),
  (1002, 'Load Test Editor', 'loadtest-editor@supporthub.test',
   '$2a$12$kMVU0zz1OxnxwwxjelJHauDlI1QglOJ3u6wV6WAvrs3aH8iojrCsi', 'editor');
SELECT setval('users_id_seq', 2000);

-- Categories -------------------------------------------------
INSERT INTO categories (id, name) VALUES
  (1001, 'Account Support'),
  (1002, 'Technical Support'),
  (1003, 'General Support'),
  (1004, 'Billing Support');
SELECT setval('categories_id_seq', 2000);

-- Articles ---------------------------------------------------
-- 60 published, 10 in review (with pending Editorial reviews), 5 drafts.
WITH topics AS (
  SELECT ARRAY[
    'Reset your password', 'Set up two-factor authentication',
    'Router keeps disconnecting', 'Configure the VPN client',
    'Update billing details', 'Download your invoice',
    'Email not syncing on mobile', 'Printer is offline',
    'Change your account email', 'Slow internet connection',
    'Install the desktop app', 'Recover a deleted file',
    'Cancel a subscription', 'Refund request process',
    'Wi-Fi password change', 'Browser cache problems',
    'Account locked after failed logins', 'Update payment card',
    'Connect to the office network', 'Backup your data'
  ] AS t
)
INSERT INTO articles (id, title, content, category_id, author_id, status,
                      created_at, updated_at, published_at)
SELECT
  1000 + n,
  t[1 + ((n - 1) % 20)] || ' (guide ' || n || ')',
  'Synthetic load-test article ' || n || '. Step-by-step instructions: ' ||
  t[1 + ((n - 1) % 20)] || '. Check your settings, restart the device, ' ||
  'sign in again and contact support if the problem continues.',
  1001 + ((n - 1) % 4),
  1001,
  CASE WHEN n <= 60 THEN 'published'
       WHEN n <= 70 THEN 'in_review'
       ELSE 'draft' END,
  NOW() - (n || ' hours')::interval,
  NOW() - (n || ' hours')::interval,
  CASE WHEN n <= 60 THEN NOW() - (n || ' hours')::interval END
FROM topics, generate_series(1, 75) AS n;
SELECT setval('articles_id_seq', 2000);

-- Version 1 for every article (as the Article Service does on create).
INSERT INTO article_versions (article_id, version_number, title, content,
                              category_id, edited_by, created_at)
SELECT id, 1, title, content, category_id, author_id, created_at
FROM articles;

-- Editorial: pending reviews for the 10 in-review articles ----------
INSERT INTO editorial_reviews (article_id, submitted_by, decision, created_at)
SELECT id, author_id, 'pending', updated_at
FROM articles
WHERE status = 'in_review';

-- Search: public projection of the 60 published articles -----------
INSERT INTO search_published_articles (article_id, title, content,
                                       category_id, published_at, updated_at)
SELECT id, title, content, category_id, published_at, updated_at
FROM articles
WHERE status = 'published';
