# 8. API List and Data Model

> Draft for the group report.
> - Source: the route files `services/*/routes/*.js` and the `server.js` files.
> - Every public path starts with `/api`, which the Pages Function proxy routes
>   (`frontend/functions/api/[[path]].js`).
> - Role terms: **public** = no login, **login** = any logged-in user, **author** = author or admin,
>   **reviewer** = editor, reviewer or admin. Every write also needs CSRF and Origin checks (see `07`).
> - More detail: `docs/final/02-technical-evidence-pack.md` §9–10, `services/article-service/API_DOCUMENTATION.md`,
>   `services/search-analytics-service/SEARCH-API.md`.

## 8.1 Identity Service (Alyaa): `services/identity-service/routes/authRoutes.js`

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/auth/csrf` | public | Issue a CSRF token for the session |
| POST | `/api/auth/register` | public + Turnstile | Create an account (always `author`). Limit 30 per 15 min. |
| POST | `/api/auth/login` | public | Log in. The session is regenerated. Limit 30 per 15 min. |
| POST | `/api/auth/logout` | login | End the session and clear the cookie |
| GET | `/api/auth/me` | login | Current user |
| GET | `/api/health` | public | Health and database check |

## 8.2 Article & Category Service (Alyaa): `services/article-service/routes/*.js`, `server.js`

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/categories` | public | List categories |
| POST, PATCH, DELETE | `/api/categories[/:id]` | author | Manage categories. Categories in use are protected. |
| GET | `/api/articles/mine` | author | The user's own articles |
| POST | `/api/articles` | author | Create a draft |
| GET | `/api/articles/:id` | author (own) | Read an article |
| PATCH, DELETE | `/api/articles/:id` | author (own, draft only) | Edit (creates a version) or delete |
| POST | `/api/articles/check-duplicates` | author | Jaccard duplicate detection |
| GET | `/api/articles/related-questions?q=` | author | Stack Exchange related questions |
| POST | `/api/articles/:id/submit` | author (own) | Submit: status change plus an outbox event, then SQS |
| GET | `/api/articles/:id/versions` | author (own) | Version history |
| GET | `/api/articles/:id/versions/compare` | author (own) | Compare two versions |
| GET | `/api/articles/:id/versions/:versionId` | author (own) | One version |
| POST | `/api/articles/:id/restore` | author (own) | Restore a version |
| POST, GET | `/api/articles/:id/versions/:versionId/export` | author (own) | Back up a version to S3, or retrieve it |
| GET | `/api/articles/csrf` | login | CSRF token for Article writes |
| GET | `/internal/articles/:id` | HMAC | Authoritative article for Editorial and Search |
| PATCH | `/internal/articles/:id/status` | HMAC (Editorial only) | Status transition with an idempotent `operationId` |
| GET | `/api/health` | public | Health |

## 8.3 Editorial Service (Salma): `services/editorial-service/routes/*.js`, `server.js`

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/api/articles/:id/submissions` | author | Submission through Editorial |
| GET | `/api/reviews?status=` | reviewer | Review queue |
| POST | `/api/articles/:id/reviews` | reviewer (not own) | Approve or reject, with a comment |
| GET | `/api/articles/:id/history` | reviewer | Editorial status timeline |
| POST | `/api/review-operations/:operationId/reconcile` | reviewer | Reconcile an interrupted review operation |
| GET | `/api/editorial/published` | reviewer | Published articles |
| PATCH | `/api/articles/:id/publication` | reviewer (not own) | Publish. Indexes in Search and writes an SNS outbox event. |
| POST | `/api/editorial/notifications/retry` | reviewer | Retry pending Search notifications |
| POST | `/api/editorial/publication-operations/:operationId/reconcile` | reviewer | Reconcile an interrupted publication |
| GET | `/api/editorial/flags` | reviewer | Open outdated-article flags |
| POST | `/api/articles/:id/flags` | reviewer | Report an outdated article (a repeat report returns the open flag, 200) |
| PATCH | `/api/flags/:id` | reviewer (not own article) | Resolve a re-review |
| GET | `/api/csrf-token` | login | CSRF token for Editorial writes |
| POST | `/internal/retry-notifications` | cron secret | Scheduled retry of notifications |
| POST | `/internal/retry-publication-events` | cron secret | Requeue failed SNS events (D3) |
| POST | `/internal/auto-flags` | HMAC (Search) | Automatic re-review from reader votes: needs 5+ unhelpful and more than 60% unhelpful (201 / 200 duplicate / 400 / 401 / 404 / 409 / 422 / 429) |
| GET | `/api/health` | public | Health |

## 8.4 Search, Feedback & Analytics Service (Nermeen): `services/search-analytics-service/routes/*.js`, `server.js`

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/public/articles?q=&categoryId=&page=` | public | Search published articles. Limit 120. |
| GET | `/api/public/articles/:id` | public | Read a published article (records a view) |
| POST | `/api/public/search-clicks` | public | Record a click on a search result |
| POST | `/api/articles/:id/votes` | login + Turnstile | Helpful or unhelpful vote (one per user) |
| POST | `/api/articles/:id/feedback` | login + Turnstile | Written feedback with local sentiment |
| GET | `/api/analytics/overview` | reviewer | Success rate, zero-result searches, unhelpful articles, click-through rate |
| GET | `/api/analytics/live-counters` | reviewer | DynamoDB live counters |
| POST | `/api/analytics/exports` | reviewer | Generate a CSV export in S3 |
| GET | `/api/analytics/exports[/:name]` | reviewer | List or download exports |
| GET | `/api/analytics/csrf` | login | CSRF token for Search writes |
| POST | `/internal/publications`, `/internal/unpublications` | HMAC (Editorial) | Add an article to the search index, or remove it |
| GET | `/api/health` | public | Health |

## 8.5 Data model

Each service writes only its own tables. Cross-service data goes through HMAC APIs or events
(`docs/final/02-technical-evidence-pack.md` §11–12).

| Owner | Entity (table) | Key fields | Relationships and constraints | Source |
|---|---|---|---|---|
| Identity | `users` | id, name, email (UNIQUE), password_hash, role | `CHECK role IN (author, editor, admin)` | `infra/floci/db/00-core-schema.sql` |
| Identity | `user_sessions` | session id, JSON data, expiry | Shared by all four services (connect-pg-simple) | `docs/data-model.md` |
| Identity, Article | `audit_logs` | user_id, action, target_id, details | Logins, failed logins, article actions | `infra/floci/db/00-core-schema.sql` |
| Article | `categories` | id, name (UNIQUE) | 1─* `articles` | same |
| Article | `articles` | id, title, content, category_id, author_id, status | FK → `categories`, FK → `users` (author) | same |
| Article | `article_versions` | article_id, version_number, content | FK → `articles` ON DELETE CASCADE; `UNIQUE(article_id, version_number)` | same |
| Article | `article_event_outbox` | event_id, type, payload, status, attempts | Written in the same transaction as the status change, then SQS | `services/article-service/migrations/001_article_event_outbox.sql` |
| Article | `article_transition_operations` | operation_id | Makes Editorial status transitions idempotent | `…/002_article_transition_idempotency.sql` |
| Editorial | `editorial_reviews` | review_id, article_id, submitted_by, reviewer_id, decision, comments | `decision IN (pending, approved, rejected)`; one pending review per article (partial unique index) | `services/editorial-service/migrations/001_editorial.sql` |
| Editorial | `editorial_status_events` | article_id, actor_id, previous_status, new_status | Editorial history timeline | same |
| Editorial | `editorial_outdated_flags` | flag_id, article_id, flagged_by, status, resolved_by | `status IN (open, resolved)`; one open flag per article | `001_editorial.sql`, `008_flag_one_open_per_article.sql` |
| Editorial | `publication_outbox` | article_id, state, attempts, next_attempt_at | Search notification retry | `001_editorial.sql` |
| Editorial | `editorial_workflow_operations` | operation_id, article_id | One active operation per article | `003_editorial_workflow_operations.sql` |
| Editorial | `editorial_event_inbox` | event_id (PK) | SQS idempotency: a duplicate is acknowledged without side effects | `005_editorial_event_inbox.sql` |
| Editorial | `editorial_publication_event_outbox` | event_id, payload, state | Feeds SNS | `006_editorial_publication_events.sql` |
| Editorial | `editorial_publication_event_receipts` | event_id (PK), article_id, event_type, processed_at | Written by the Lambda. Idempotent. | same |
| Search | `search_published_articles` | article_id (PK), title, content, category_id | Only published articles. 1─* views, votes, feedback (by article_id). | `services/search-analytics-service/migrations/001_search_analytics.sql` |
| Search | `search_query_logs` | search_id, query_text, result_count | 1─* `search_result_clicks` (FK, ON DELETE CASCADE) | same |
| Search | `search_result_clicks` | search_id, article_id | FK → `search_query_logs` | same |
| Search | `article_views` | article_id, viewed_at | — | same |
| Search | `helpfulness_votes` | article_id, user_id, helpful | `UNIQUE(article_id, user_id)` | same |
| Search | `article_feedback` | article_id, user_id, comment_text, sentiment_status, sentiment_label | `sentiment_confidence` between 0 and 1 | same |
| Search (DynamoDB) | `supporthub-search-counters` | `TERM#<term>`, `ARTICLE#<id>` | Live counters, batched every 5 s | `evidence/search-aws/02-dynamodb-live-counters.txt` |
| Article (S3) | `supporthub-article-backups` | `articles/<id>/versions/<v>.json` | Version backups | `docs/final/02-technical-evidence-pack.md` §19 |
| Search (S3) | `supporthub-search-analytics-exports` | `exports/analytics-<timestamp>.csv` | Analytics exports | `evidence/search-aws/03-csv-export-generation.txt` |

**Relationships across services:**
- Editorial and Search store `article_id` and user IDs as plain values, with no cross-service
  foreign keys. They are checked through the Article and Identity APIs.
- Article events flow from `article_event_outbox` to SQS to `editorial_event_inbox`.
- Publication events flow from `editorial_publication_event_outbox` to SNS, then the Lambda, then
  `editorial_publication_event_receipts`.
