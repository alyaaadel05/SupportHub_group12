# 7. Role and Permission Matrix

> Draft for the group report. Taken from the route files and middleware in `services/*/`.
> Paths are relative to the repository root.

## 7.1 Roles

The `users` table allows **author**, **editor** and **admin**: `CHECK (role IN ('author','editor','admin'))`
in `infra/floci/db/00-core-schema.sql`.

| Role | How it is obtained | Notes |
|---|---|---|
| Guest | No session | Can use only the public endpoints. |
| Author | Every self-registration | `services/identity-service/services/authService.js` ("New users receive the author role"). Asking for `admin` at registration still stores `author` (`evidence/final/alyaa/resilience-security-20261125T193131Z.txt`). |
| Editor | Assigned in the database by an administrator | Editorial and Search also accept the alias `reviewer` (`REVIEWER_ROLES` in `services/editorial-service/middleware/security.js`, `ANALYTICS_ROLES` in `services/search-analytics-service/middleware/security.js`). |
| Admin | Assigned in the database | Has every permission. Editorial still blocks an admin from reviewing or publishing their own article. |

There is no separate "reader" role in the database. In the k6 test, "reader" means anonymous traffic
plus votes by a logged-in user (`docs/final/06-integration-and-load-results.md`).

## 7.2 Middleware that enforces roles

| Service | Middleware (file) | No session | Wrong role |
|---|---|---|---|
| Identity | `requireAuth` (`services/identity-service/middleware/security.js`) | 401 | — |
| Article | `requireRole("author","admin")`, plus per-record `canAccess` (admin, or author and `author_id` = user) (`services/article-service/middleware/security.js`) | 401 | 403 |
| Editorial | `requireAuthor` (author, admin), `requireReviewer` (reviewer, editor, admin) (`services/editorial-service/middleware/security.js`) | 401 | 403 |
| Search | `requireLogin`, `requireReviewer` (reviewer, editor, admin) (`services/search-analytics-service/middleware/security.js`) | 401 | 403 |
| All writes | `requireCsrf` and `assertOrigin` (Identity, Article), `requireBrowserWrite` (Editorial, Search) | — | 403 for a missing or invalid CSRF token or a foreign Origin |
| Internal | `requireServiceSignature` (Article), `requireEditorialSignature` (Search), `requireCronSecret` (Editorial) | 401 for an invalid signature or secret | 503 if not configured |

## 7.3 Matrix

✔ = allowed · **own** = only the user's own records · ✖ = denied with the code shown.

| Action | Endpoint | Guest | Author | Editor | Admin | Enforced by | Evidence |
|---|---|---|---|---|---|---|---|
| Search and read published articles | `GET /api/public/articles`, `/public/articles/:id` | ✔ | ✔ | ✔ | ✔ | Public route. Only the published table is used. (`search-analytics-service/routes/searchRoutes.js`) | `evidence/final/e2e/lifecycle-20261125T185609Z.txt` |
| List categories | `GET /api/categories` | ✔ | ✔ | ✔ | ✔ | Public (`article-service/routes/categoryRoutes.js`) | production probe `evidence/final/integration/production-read-only-probe-20261125T193623Z.txt` |
| Register, log in | `POST /api/auth/register`, `/login` | ✔ (CSRF + Turnstile) | — | — | — | `requireCsrf` (`identity-service/routes/authRoutes.js`) | ST-14 in `03-security.md` |
| Current user, log out | `GET /api/auth/me`, `POST /api/auth/logout` | ✖ 401 | ✔ | ✔ | ✔ | `requireAuth` | `evidence/final/integration/production-read-only-probe-20261125T193623Z.txt` (logout 401) |
| Vote or give written feedback | `POST /api/articles/:id/votes`, `/feedback` | ✖ 401 | ✔ | ✔ | ✔ | `requireLogin`, Turnstile check in `feedbackController.js`, `UNIQUE(article_id,user_id)` | 45/45 anonymous votes denied (`evidence/final/integration/load/workflow-20261125T193351Z-summary.md`) |
| Create an article, check duplicates, related questions | `POST /api/articles`, `/articles/check-duplicates`, `GET /articles/related-questions` | ✖ 401 | ✔ | ✖ 403 | ✔ | `requireRole("author","admin")` | Editor create denied 60/60 (k6 file above) |
| Read, edit or delete an article | `GET/PATCH/DELETE /api/articles/:id`, `GET /articles/mine` | ✖ 401 | **own** (edit and delete: drafts only) | ✖ 403 | ✔ | `requireRole` + `canAccess`; ownership checked in SQL (`articleService.js`) | ST-04, `evidence/final/e2e/lifecycle-20261125T185609Z.txt` §4 |
| Versions: list, compare, restore, S3 backup | `/api/articles/:id/versions…`, `/restore`, `/versions/:vid/export` | ✖ 401 | **own** | ✖ 403 | ✔ | `requireRole` + version-service ownership | ST-05 |
| Manage categories | `POST/PATCH/DELETE /api/categories[/:id]` | ✖ 401 | ✔ | ✖ 403 | ✔ | `requireRole("author","admin")` | `docs/final/02-technical-evidence-pack.md` §9–10 |
| Submit for review | `POST /api/articles/:id/submit` (Article), `/articles/:id/submissions` (Editorial) | ✖ 401 | **own** drafts | ✖ 403 | ✔ | `requireRole` / `requireAuthor`; atomic `author_id` check | `evidence/final/alyaa/resilience-security-20261125T193131Z.txt` |
| Review queue, approve or reject | `GET /api/reviews`, `POST /articles/:id/reviews` | ✖ 401 | ✖ 403 | ✔ (not own) | ✔ (not own) | `requireReviewer`; "Cannot review your own article" in `reviewService.js` | ST-02: 55/55 author probes denied (k6 file above) |
| Publish | `PATCH /api/articles/:id/publication` | ✖ 401 | ✖ 403 | ✔ (not own) | ✔ (not own) | `requireReviewer`; "Cannot publish your own article" in `publicationService.js` | `evidence/final/salma/resilience-security-20261125T193131Z.txt` |
| History, published list, open flags | `GET /api/articles/:id/history`, `/editorial/published`, `/editorial/flags` | ✖ 401 | ✖ 403 | ✔ | ✔ | `requireReviewer` | production probe: `/api/editorial/published` 401 |
| Report an outdated article, resolve a re-review | `POST /api/articles/:id/flags`, `PATCH /flags/:id` | ✖ 401 | ✖ 403 | ✔ (resolve: not own) | ✔ (resolve: not own) | `requireReviewer`; author check in `flagService.js` (D2) | `evidence/editorial-aws/01-outdated-article-rereview.txt` |
| Retry notifications, reconcile operations | `POST /api/editorial/notifications/retry`, `…/reconcile` | ✖ 401 | ✖ 403 | ✔ | ✔ | `requireReviewer` | `services/editorial-service/routes/` |
| Analytics, live counters, CSV export | `GET /api/analytics/overview`, `/live-counters`, `/exports[/:name]`, `POST /exports` | ✖ 401 | ✖ 403 | ✔ | ✔ | `requireReviewer` | `evidence/search-aws/02-dynamodb-live-counters.txt`, `05-csv-download-validation.txt` (anonymous 401, author 403) |
| Internal service calls | `/internal/articles/:id[/status]`, `/internal/publications`, `/internal/unpublications`, `/internal/retry-*` | ✖ 401 | ✖ 401 | ✖ 401 | ✖ 401 | HMAC signature or cron secret only. Not routed by the proxy. | ST-17 |

**Logout is global.** A session is invalid on all four services after logout (ST-21,
`evidence/final/alyaa/resilience-security-20261125T193131Z.txt`).
