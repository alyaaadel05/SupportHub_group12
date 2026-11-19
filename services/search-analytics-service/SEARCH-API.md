# Search & Analytics Service – API and Ranking Rule

Base URL (local): `http://localhost:3004`
All responses are JSON. Rate limit on `/api/*`: **300 requests per 15 minutes per IP** (then `429`).

## 1. Search ranking rule

1. **Keywords:** the search text is lowercased, split into words (letters and numbers only, punctuation removed), duplicates removed, and **at most 12 words** are used.
2. **Score per keyword** for each published article:

| Where the word is found | Points |
|---|---|
| Title | **+5** |
| Category name | **+3** |
| Content | **+1** |

3. The article's **relevance** = the sum of points for all keywords. Example: `reset password` on "How to Reset Your Password" → title (5+5) + content (1+1) = **12**.
4. With keywords, articles that score **0 are not returned**.
5. **Order:** highest relevance first → then newest `published_at` → then lowest `article_id` (stable order).
6. With **no keywords**, all published articles (optionally filtered by category) are returned, newest first.
7. **Only published articles** are searchable: search reads only `search_published_articles`, which contains only articles confirmed as `published`.

## 2. Public endpoints (no login)

| Method | Path | Purpose | Success | Errors |
|---|---|---|---|---|
| GET | `/api/health` | Service + database check | 200 | 500 |
| GET | `/api/public/articles` | Search published articles | 200 | 400, 429 |
| GET | `/api/public/articles/:id` | Full published article; **records a view** | 200 | 400, 404, 429 |
| POST | `/api/public/search-clicks` | Record which search result was clicked | 201 | 400, 404, 429 |

**Search query parameters**

| Parameter | Rule | Default |
|---|---|---|
| `q` | Text, max 100 characters | empty (all) |
| `categoryID` | Positive whole number | none |
| `page` | Whole number 1–100 | 1 |
| `pageSize` | Whole number 1–50 | 10 |

**Search response**
```json
{
  "results": [{
    "article_id": "1", "title": "How to Reset Your Password",
    "category_id": "1", "category_name": "Account Support",
    "published_at": "2026-11-11T20:22:28.720Z", "status": "published",
    "relevance": 6, "excerpt": "First 180 characters of the content..."
  }],
  "total": 1, "page": 1, "pageSize": 10, "searchId": "4"
}
```
Every search is saved in `search_query_logs` (query text, result count, time).

## 3. Logged-in endpoints (shared Identity session cookie)

| Method | Path | Who | Purpose | Success | Errors |
|---|---|---|---|---|---|
| GET | `/api/analytics/csrf` | Any logged-in user | Get a CSRF token | 200 | 401 |
| POST | `/api/articles/:id/votes` | Any logged-in user | Helpful / unhelpful vote (one per user per article, can be changed) | 200 | 400, 401, 403, 404, 429 |
| POST | `/api/articles/:id/feedback` | Any logged-in user | Written feedback (max 1000 characters) + sentiment | 201 | 400, 401, 403, 404, 429 |
| GET | `/api/analytics/overview` | reviewer, editor\*, admin | Dashboard statistics | 200 | 401, 403 |

\* `editor` is allowed temporarily until the team migrates it to `reviewer`.

**Votes and feedback also require:**
- `Origin` header = the SupportHub frontend address (else 403)
- `X-CSRF-Token` header = the token from `/api/analytics/csrf` (else 403)
- A valid Cloudflare **Turnstile** token in the body (`turnstileToken`), checked on the server (else 403)

Vote body: `{ "helpful": true, "turnstileToken": "..." }`
Feedback body: `{ "comment": "Very clear, thanks", "turnstileToken": "..." }`

## 4. Internal service-to-service endpoints

| Method | Path | Caller | Purpose | Success | Errors |
|---|---|---|---|---|---|
| POST | `/internal/publications` | Editorial Service | An article was published or updated: fetch it from the Article Service and index it | 200 | 401, 404, 502, 503 |
| POST | `/internal/unpublications` | Editorial Service | Remove an article from search | 200 | 400, 401 |

Body: `{ "articleId": 1 }`

**Signed requests** (shared secret `SERVICE_SHARED_SECRET`):
- `x-service-name: editorial-service`
- `x-service-timestamp`: time in milliseconds (must be within 5 minutes)
- `x-service-signature`: HMAC-SHA256 of `sender, timestamp, method, path, SHA-256(body)`
Unknown sender, wrong signature or old timestamp → **401**.
The Search service never trusts the notification content: it fetches the article from the Article Service and indexes it **only if its status is `published`**.

Initial / repair sync: `node scripts/sync-published.js` (read-only from `articles`, writes only `search_published_articles`, safe to run twice).

## 5. Status codes used

| Code | Meaning in this service |
|---|---|
| 200 / 201 | Success / created |
| 400 | Invalid input (ID, page, page size, search text, vote, feedback) |
| 401 | Not logged in, or invalid internal service credentials |
| 403 | Wrong role, wrong origin, missing/invalid CSRF token, failed Turnstile |
| 404 | Article not published / not found, unknown route |
| 413 | Request body larger than 100 KB |
| 429 | Too many requests (rate limit) |
| 500 | Unexpected server error (details only in server logs) |
| 502 / 503 | Article Service, Turnstile or configuration unavailable |