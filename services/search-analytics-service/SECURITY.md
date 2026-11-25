# Search & Analytics Service – Threat Model and Security Tests

## 1. Threat model (application-specific)
| # | Threat | Example attack | Mitigation | Where enforced |
|---|---|---|---|---|
| T1 | **Unpublished article exposure** | Reader opens `/api/public/articles/2` (a draft) or searches for draft text | Public search reads only `search_published_articles`; articles are indexed only after the Article Service confirms `status = published`; the sync copies only `published` rows and removes others | `services/searchService.js`, `services/serviceClient.js`, `scripts/sync-published.js` |
| T2 | **SQL injection** | `q='; DROP TABLE search_query_logs; --`, `categoryID=1 OR 1=1` | All SQL is parameterized (`$1`, `$2`); IDs must be positive whole numbers; search text max 100 characters | `services/*.js`, `services/http.js`, `services/ranking.js` |
| T3 | **Unauthorized analytics / report access** | Not-logged-in user or an author calls `/api/analytics/overview` or downloads a report | `requireReviewer`: no session → 401; role not reviewer/editor/admin → 403 (checked in Express, not only the UI) | `middleware/security.js`, `routes/analyticsRoutes.js` |
| T4 | **Forged internal notifications** | Attacker calls `/internal/publications` to inject an article into search | HMAC-SHA256 signature with a shared secret, sender must be `editorial-service`, timestamp within 5 minutes (stops replays); article content is always re-fetched from the Article Service | `middleware/security.js`, `services/serviceClient.js` |
| T5 | **Vote manipulation (ballot stuffing)** | One user votes 100 times or votes for someone else | Login required; vote is tied to the session user (no user ID accepted from the request); one vote per user per article (`UNIQUE(article_id,user_id)` + upsert); Turnstile anti-bot check; rate limit | `services/feedbackService.js`, `migrations/001_search_analytics.sql`, `middleware/turnstile.js` |
| T6 | **Cross-site request forgery (CSRF)** | Malicious website makes a logged-in reviewer's browser vote or create exports | Origin must equal the SupportHub frontend; `X-CSRF-Token` must match the session token (timing-safe compare) | `middleware/security.js` (`requireBrowserWrite`) |
| T7 | **Flooding / denial of service** | Script sends thousands of searches | Rate limit (default 300 requests / 15 min per IP → 429); bounded queries (max 1000 rows, page ≤ 100, page size ≤ 50); 100 KB body limit | `server.js`, `services/ranking.js` |
| T8 | **Secret leakage** | Keys in GitHub, logs or reports | Secrets only in `.env` (git-ignored) and the hosting dashboard; `.vercelignore` stops `.env` being uploaded; logs contain only error messages; reports contain only aggregates | `.gitignore`, `.vercelignore`, `LOG-SAFETY.md`, `services/exportService.js` |
| T9 | **CSV injection in reports** | Attacker searches `=HYPERLINK(...)` so it runs when a reviewer opens the report in Excel | Cells starting with `= + - @` are prefixed with `'` and every cell is quoted | `services/exportService.js` |
| T10 | **Over-privileged cloud credentials / path tricks** | Stolen service keys used to delete tables or buckets; `../.env` requested as a report name | Least-privilege IAM user (only its own table, bucket prefix and metrics); report names must match a strict pattern | `infra/iam/search-analytics-policy.json`, `services/exportService.js` |

## 2. Security test results
Run on 19–21 Nov 2026 against the local service (port 3004), Neon, Floci (IAM enforcement on) and the deployed Vercel service.
Automated tests: `npm test` (73 passing). Live tests: `curl`, AWS CLI and scripts in `scripts/`.

| # | Test (threat) | Request / action | Expected | Actual | Pass |
|---|---|---|---|---|---|
| S1 | Draft hidden (T1) | `GET /api/public/articles/2`, `/4`, `/6` | 404 | 404 "Published article not found" | ✅ |
| S2 | In-review hidden (T1) | `GET /api/public/articles/7` | 404 | 404 | ✅ |
| S3 | Published visible (T1) | `GET /api/public/articles/1` | 200 | 200 with full article | ✅ |
| S4 | SQL injection in search (T2) | `q='; DROP TABLE search_query_logs; --` | 200, treated as text, table intact | 200, total 0; text stored literally; table still exists | ✅ |
| S5 | SQL injection in IDs (T2) | `categoryID=1 OR 1=1`, `/articles/1 OR 1=1`, `/articles/1;DROP TABLE articles` | 400 | 400 "Invalid ID" | ✅ |
| S6 | Over-long search (T7) | `q` = 101 characters | 400 | 400 "Search is too long" | ✅ |
| S7 | Invalid paging (T7) | `page=0/101/abc`, `pageSize=51` | 400 | 400 "Invalid page" / "Invalid page size" | ✅ |
| S8 | Analytics without login (T3) | `GET /api/analytics/overview`, `/live-counters`, `/exports` | 401 | 401 "Login required" | ✅ |
| S9 | Wrong role (T3) | Author / reader session → analytics (automated) | 403 | 403 | ✅ |
| S10 | Allowed roles (T3) | Reviewer / editor / admin session → analytics (automated) | allowed | allowed | ✅ |
| S11 | Forged internal signature (T4) | `POST /internal/publications` with fake signature | 401 | 401 "Invalid service signature" | ✅ |
| S12 | Replayed / unknown sender (T4) | Old timestamp; sender `unknown-service` (automated) | 401 | 401 | ✅ |
| S13 | CSRF / foreign origin (T6) | Wrong Origin; missing or wrong CSRF token (automated) | 403 | 403 | ✅ |
| S14 | Flood (T7) | 320 requests in a row | 429 after the limit | 429 "Too Many Requests"; `RateLimited` metric in CloudWatch | ✅ |
| S15 | CSV injection (T9) | Cell `=HYPERLINK("x")` (automated) | Neutralised | `'=HYPERLINK(...)` stored as text | ✅ |
| S16 | Report path traversal (T10) | Download `../.env` (automated) | 400 | 400 "Invalid export name" | ✅ |
| S17 | IAM least privilege (T10) | Service user deletes a table / an export / lists all buckets | AccessDenied | AccessDenied for all three | ✅ |
| S18 | Upstream failure (availability) | Signed publication while Article Service is down | 502, no crash | 502 "Article API unavailable" | ✅ |
| S19 | Bot protection on votes/feedback (Turnstile, live, T5) | `node scripts/test-turnstile-live.js` against Cloudflare with official test keys: no token / no secret / always-pass / always-fail / already-spent (reused or expired) | 403 / 503 / accepted / 403 / 403 | 403 "Turnstile token required" / 503 "Turnstile not configured" / accepted / 403 "Turnstile verification failed" / 403 "Turnstile verification failed" (`evidence/turnstile.txt`) | ✅ |
| S20 | Historical Hugging Face API failure (2026-11-20; replaced by local sentiment analysis) | Historical live Hugging Face test (2026-11-20): API returned HTTP 402; tested without a token. Original output preserved in `evidence/sentiment.txt`. The current `scripts/test-sentiment-live.js` now tests local sentiment. | No crash; feedback still saved; sentiment `unavailable` / `not_configured` | `unavailable` for both texts, `not_configured` without token, no crash (`evidence/sentiment.txt`) | ✅ |
| S21 | Online analytics without login (T3, deployed) | `GET https://supporthub-search-analytics.vercel.app/api/analytics/overview` and `/exports` | 401 | 401 "Login required" for both; public health and search return 200 (`evidence/vercel-online.txt`) | ✅ |

Still to test live once the shared login is available: vote ownership and duplicate-vote protection (T5), CSRF from a real browser session (T6), and author/reader → 403 on the deployed service (T3).