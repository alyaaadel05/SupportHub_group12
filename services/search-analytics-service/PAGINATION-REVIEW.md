# Search & Analytics Service – Pagination Review

## Purpose
Verify whether pagination in `GET /api/public/articles` reduces unnecessary data retrieval.

## How pagination works now
- Query parameters: `q` (keyword), `categoryID` (optional), `page` (1–100).
- Page size is fixed at **10 results**.
- Code: `services/searchService.js` → `search()`.

## Findings
| Layer | Reduced by pagination? | Evidence |
|---|---|---|
| Service → browser (response size) | ✅ Yes | Only 10 results are returned per page, and each result has a 180-character `excerpt` instead of the full `content`. |
| Database → service (data read) | ❌ No | Every search runs `SELECT ... content ... LIMIT 1000`, so up to 1000 full articles (including full text) are read from Neon on every request, even for page 1. Ranking and slicing to 10 happen in Node.js. |
| Input limits | ✅ Yes | `page` must be 1–100 and `q` at most 100 characters, so huge or invalid page requests are rejected with 400. |

## Impact
- With a small number of articles the effect is small.
- With many articles and many users (e.g. a whole university), each search transfers a lot of unnecessary article text from the database, increasing response time and database load. This will be measured with the k6 load tests (`load-tests/search-load-test.js`).

## Possible improvement (not applied yet)
Move matching, ranking and paging into the database:
- Use PostgreSQL full-text search (`tsvector` + GIN index) for keyword matching and ranking.
- Use `ORDER BY rank LIMIT 10 OFFSET (page-1)*10` so only 10 rows are read.
- Return `COUNT(*)` separately for the total number of results.

This change would be measured before and after with k6 (checklist item "Compare performance before and after optimization").