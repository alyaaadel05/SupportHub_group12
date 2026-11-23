# Frontend Integration — Search, Feedback & Analytics Service

Owner: Nermeen Mostafa (239814)

This document explains how the SupportHub frontend talks to the Search, Feedback &
Analytics Service, which integration problems were found, and how they were fixed.

## 1. How requests reach this service

The frontend is plain HTML/CSS/JS (`frontend/`). Locally it runs with `npm start`
(http-server on port 8080).

`frontend/js/config.js` lists one API origin per service. Locally:

| Service   | Origin                       |
|-----------|------------------------------|
| identity  | http://127.0.0.1:3003/api    |
| article   | http://127.0.0.1:3001/api    |
| editorial | http://127.0.0.1:3002/api    |
| **search**| **http://127.0.0.1:3004/api**|

`apiBaseFor(path)` in `frontend/js/auth.js` sends these paths to this service:

| Path pattern                         | Used for                      |
|--------------------------------------|-------------------------------|
| `/public/...`                        | search and opening an article |
| `/articles/:id/(votes\|feedback\|view)` | helpfulness votes, feedback |
| `/analytics/...`                     | reviewer analytics dashboard  |

Everything else goes to the Article Service.

## 2. Frontend calls vs. backend routes

| Frontend call                               | Backend route                         | Login        |
|---------------------------------------------|---------------------------------------|--------------|
| `GET /public/articles?q=&category=`         | `GET /api/public/articles`            | public       |
| `GET /public/articles/:id`                  | `GET /api/public/articles/:id` (also records the view) | public |
| `POST /articles/:id/votes` `{helpful, turnstileToken}` | `POST /api/articles/:id/votes` | logged in + CSRF |
| `GET /analytics/overview`                   | `GET /api/analytics/overview`         | reviewer/editor/admin |
| `GET /analytics/live-counters`              | `GET /api/analytics/live-counters` (DynamoDB) | reviewer/editor/admin |
| `POST /analytics/exports`                   | `POST /api/analytics/exports` (S3)    | reviewer/editor/admin + CSRF |
| `GET /analytics/exports`, `/exports/:name`  | list / download CSV from S3           | reviewer/editor/admin |

The `api()` helper in `auth.js` sends the session cookie (`credentials: "include"`) and,
for non-GET requests, fetches a CSRF token from the Identity Service and sends it as
`X-CSRF-Token`. This matches `requireBrowserWrite` in this service.

The frontend never calls `/articles/:id/view`; views are recorded when
`GET /public/articles/:id` is called, so no extra route is needed.

## 3. Integration problems found and fixed

Found by reading `articles.js` / `analytics.js` and comparing them with the real
responses of this service.

| # | Problem | Effect | Fix |
|---|---------|--------|-----|
| 1 | Search returned `results`, `article_id`, `excerpt`; `articles.js` reads `articles`, `id`, `content` | Articles page would crash (`result.articles` undefined) | Search response now **also** returns `articles`, `id`, `content`. Old names kept so existing clients and tests still work. |
| 2 | Dashboard called `/analytics/summary`, which never existed in this service | Dashboard got 404 | `analytics.js` now calls `/analytics/overview`. |
| 3 | Dashboard expected article counts (total/published/pending) | Those belong to the Article Service, not this one | Removed from the dashboard; it shows search metrics instead. |
| 4 | Dashboard allowed only editor/admin; backend allows reviewer/editor/admin | Reviewers would be blocked by the page | `requireRole(["reviewer","editor","admin"])`. |
| 5 | No unhelpful-vote total or poorly rated articles in the overview | Checklist analytics missing | Added `helpfulVotes`, `unhelpfulVotes`, `poorlyRatedArticles`. |
| 6 | Knowledge gaps, sentiment, DynamoDB live counters and S3 exports were not visible | AWS features not shown in the UI | `analytics.js` adds these sections itself (`analytics.html` unchanged). |
| 7 | Frontend sends `category=`; service only read `categoryID` / `categoryId` | Category dropdown on the articles page was ignored | Service now also accepts `category`. Live check: `category=1` → 1 article, `category=99` → 0. Tests in `tests/category-filter.test.js`. |

Verification:
- `GET http://127.0.0.1:3004/api/public/articles?q=password` returns both `results`
  and `articles`, with `id` and `content`.
- `overview()` was run against Neon and returned the new fields.
- `npm test`: 67/67 passing.

## 4. Security notes for the frontend

- All values from the API are written with `textContent`, never `innerHTML`, so a
  stored search term such as `<script>` is shown as text (no XSS).
- Role checks in the page are only for user experience; the backend enforces them
  (401 without login, 403 for reader/author).
- CSV downloads are served by the backend after the role check; file names are
  validated against a strict pattern (no path traversal).
- The analytics responses use `Cache-Control: no-store, private`.

## 5. Still to verify (needs login from the Identity Service)

- Articles page search in the browser (page redirects to `login.html` without a session).
- Vote from the articles page (duplicate vote updates instead of adding).
- Dashboard with a reviewer/editor account, including the S3 export button.