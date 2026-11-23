# Search & Analytics Service – Database Model (Neon PostgreSQL)

Created by `migrations/001_search_analytics.sql` and `migrations/002_search_indexes.sql`
(additive only, `IF NOT EXISTS`, approved by the team before running on the shared database).

## 1. Relationships
```
 Alyaa's tables (read-only for Search)          Search & Analytics tables (owned by Search)
 ┌──────────────┐                               ┌───────────────────────────┐
 │ articles     │ id ── published copy ───────▶ │ search_published_articles │ article_id (PK)
 │ categories   │ id ── category_id / name ───▶ │                           │ category_id
 │ users        │ id ──┐                        └─────────────┬─────────────┘
 └──────────────┘      │                                      │ article_id
                       │       ┌──────────────────────┬───────┼──────────────┬──────────────────┐
                       │       ▼                      ▼       ▼              ▼                  ▼
                       │  article_views        helpfulness_votes      article_feedback   search_result_clicks
                       ├──────────────────────▶ user_id               user_id            search_id ─┐
                       └──────────────────────────────────────────────┘                             │
                                                                         search_query_logs ◀────────┘
                                                                         search_id (PK)
```
- **Logical links** (same BIGINT IDs, no foreign key): `article_id` → `articles.id`, `user_id` → `users.id`, `category_id` → `categories.id`.
  The team agreed not to add foreign keys to other services' tables, so each service stays independent and no `ON DELETE CASCADE` can reach another service's data. Search keeps its own copy of published articles instead.
- **Real foreign key** (inside Search only): `search_result_clicks.search_id` → `search_query_logs.search_id` (`ON DELETE CASCADE`).

## 2. Tables
| Table | Purpose | Key columns | Constraints / indexes | Written by | Read by |
|---|---|---|---|---|---|
| `search_published_articles` | Public copy of **published** articles only | `article_id` (PK), `title`, `content`, `category_id`, `published_at`, `updated_at` | PK; index on `category_id`; index on `published_at DESC` | `indexPublished()`, `scripts/sync-published.js` (upsert); removed on unpublish | search, article details, votes, clicks, analytics |
| `search_query_logs` | Every search | `search_id` (PK), `query_text` (≤100), `result_count` (≥0), `searched_at` | PK; CHECK `result_count >= 0`; index on `LOWER(query_text)`; partial index where `result_count = 0` | `search()` | analytics, CSV export, clicks |
| `search_result_clicks` | Which result was clicked after a search | `click_id` (PK), `search_id` (FK), `article_id`, `clicked_at` | FK to `search_query_logs` (cascade); index on `search_id` | `logClick()` | click-through rate |
| `article_views` | Every view of a published article | `view_id` (PK), `article_id`, `viewed_at` | index on `article_id` | `getPublicArticle()` | most viewed, total views |
| `helpfulness_votes` | Helpful / unhelpful votes | `vote_id` (PK), `article_id`, `user_id`, `helpful`, `created_at`, `updated_at` | **UNIQUE(`article_id`,`user_id`)** = one active vote per user per article | `vote()` (upsert: insert or change vote) | helpfulness rate, per-article votes |
| `article_feedback` | Written feedback + sentiment | `feedback_id` (PK), `article_id`, `user_id`, `comment_text` (≤1000), `sentiment_status`, `sentiment_label`, `sentiment_confidence` | CHECK confidence between 0 and 1; index on (`sentiment_status`,`sentiment_label`) | `comment()` | sentiment breakdown |

## 3. Operations used (CRUD + query)
| Operation | Where |
|---|---|
| **Create** | new search log, view, click, vote, feedback |
| **Read / query** | ranked search, article details, analytics aggregates (`COUNT`, `GROUP BY`, `FILTER`) |
| **Update** | change an existing vote (upsert); refresh an article copy when it is re-published; sentiment result |
| **Delete** | remove an article from search when it is unpublished (sync / `/internal/unpublications`) |

All queries are parameterized. Search reads Alyaa's `articles` and `categories` **read-only** (sync and category names) and never writes to other services' tables.

## 4. Notes
- The legacy table `search_logs (id, term, created_at)` from the old `backend/` belongs to the earlier monolith; Search uses its own `search_query_logs` and never touches the old table.
- DynamoDB keeps fast counters only; Neon is the source of truth (see `AWS-DYNAMODB.md`).