# Search & Analytics Service – Database Indexing Review

## Purpose
Check that every frequent query made by the Search & Analytics Service is supported by an index, so the service stays fast as data grows (e.g. a whole university using it).

## Existing indexes (migrations/001_search_analytics.sql)
| Table | Column(s) | Index | Used by |
|---|---|---|---|
| search_published_articles | article_id | Primary key | View one article, voting, click logging |
| search_published_articles | category_id | search_articles_category_idx | Category filter in search |
| search_logs | search_id | Primary key | Click logging |
| search_result_clicks | search_id | clicks_search_idx | Click-through rate |
| article_views | article_id | article_views_id_idx | Most viewed articles |
| helpfulness_votes | (article_id, user_id) | UNIQUE constraint | One vote per user per article; votes per article |
| article_feedback | feedback_id | Primary key | Sentiment updates |

## Missing indexes found
| # | Table | Query that needs it | Problem without index | Proposed index |
|---|---|---|---|---|
| 1 | search_published_articles | Search sorts by `published_at DESC` | Whole table sorted on every search | `(published_at DESC)` |
| 2 | search_logs | Popular terms and knowledge gaps group by `LOWER(query_text)` | Every search ever logged is scanned for analytics | `(LOWER(query_text))` |
| 3 | search_logs | Zero-result searches filter `result_count = 0` | Full scan to find failed searches | Partial index on `LOWER(query_text)` where `result_count = 0` |
| 4 | article_feedback | Sentiment breakdown filters `sentiment_status = 'completed'` | Full scan of all feedback | `(sentiment_status, sentiment_label)` |

The proposed indexes are in `migrations/002_search_indexes.sql`. They are additive only (no data is changed or deleted) and will be applied after team agreement, because the Neon database is shared.

## Known limitation
Keyword matching is done in Node.js on up to 1000 published articles (see `services/searchService.js`). A normal index cannot speed up "contains word" matching. For a much larger catalogue, PostgreSQL full-text search (`tsvector` + GIN index) would be the next step.