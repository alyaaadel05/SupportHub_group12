# Development Load-Testing Configuration

This document describes the **local, isolated** settings used for k6 load testing.
None of these settings are used in production, and none of them change the
production defaults.

## 1. Rate limits

| Service | Limiter | Production value | Configurable? |
|---|---|---|---|
| Article | General `/api` | 300 requests / 15 min per client | Yes, `RATE_LIMIT_MAX` |
| Identity | Session checks, CSRF, logout (`/api/auth`) | 300 requests / 15 min per client | Yes, `RATE_LIMIT_MAX` |
| Identity | Login and registration | **30 requests / 15 min per client** | **No, fixed in code** |
| Editorial | General `/api` | 300 requests / 15 min per client | Yes, `RATE_LIMIT_MAX` |
| Search & Analytics | General `/api` | 300 requests / 15 min per client | Yes, `RATE_LIMIT_MAX` (Nermeen's existing setting) |

### Behaviour of `RATE_LIMIT_MAX` (Article, Identity, Editorial)

- **Not set** → 300 (production default).
- **A positive whole number** (for example `5000`) → that value.
- **Anything else** (empty, `0`, negative, decimal, text) → 300.
  A typo can never disable or break rate limiting.
- The helper is `config/rateLimit.js` in each service and is covered by
  `tests/rate-limit-config.test.js`.

### Why the login limit is not configurable

Raising the login/registration limit would let an attacker try passwords faster.
It stays at 30 per 15 minutes in every environment. Load tests must therefore
**not** send high volumes of login requests; they log in a small number of test
users once and reuse the session cookie.

### Why `/api/health` is still rate limited

Health checks remain behind the general limiter so that the endpoint cannot be
used to bypass rate limiting. During local load tests the limit is raised with
`RATE_LIMIT_MAX` instead of exempting any endpoint.

## 2. Where to set `RATE_LIMIT_MAX`

Set it **only** in an isolated local environment, for example a local,
uncommitted `.env` file or the shell running a local Docker container:

```powershell
# Local Docker / Floci only - never in Vercel, Cloudflare or a shared .env
$env:RATE_LIMIT_MAX = "5000"
```

Never set `RATE_LIMIT_MAX` in:

- Vercel project environment variables
- Cloudflare Pages environment variables
- any `.env` file that points at the shared Neon database

`.env` files are ignored by Git (`.env`, `.env.*`, keeping `.env.example`), so
local values are never committed.

## 3. Load-test safety rules

- Run k6 only against **local** services (Docker / Floci on `127.0.0.1`).
- Use a **disposable local PostgreSQL** database, never the shared Neon database.
- Do not load test the live Vercel deployments or Cloudflare Pages.
- Do not purge or reuse the shared SQS queues; use local Floci queues.
- Do not modify Articles 7, 21 or 22.
- Record HTTP 200, 429 and 5xx counts separately so that rate limiting can be
  distinguished from real failures.
- Keep existing results (Alyaa's `evidence/alyaa-final/load-tests/` and
  Nermeen's `services/search-analytics-service/load-tests/results/`) unchanged;
  write new results to new files.

## 4. SQS queue names (local Floci)

The Article outbox worker and the Editorial consumer must use the **same** queue
for the Article → Editorial event flow to work locally:

| Component | Setting | Value currently in the repository |
|---|---|---|
| Article outbox worker (`infra/floci/docker-compose.yml`) | `SQS_QUEUE_URL` | `http://floci:4566/000000000000/supporthub-article-events-demo` |
| Editorial consumer (`services/editorial-service/.env.example`) | `ARTICLE_EVENTS_QUEUE_URL` | `http://localhost:4566/000000000000/supporthub-article-events` |

These names differ (`-demo` suffix). When running the full flow locally, set the
Editorial service's local `ARTICLE_EVENTS_QUEUE_URL` to the same queue the Article
worker publishes to (and use `http://floci:4566` instead of `localhost` when the
consumer runs inside the Docker network). This is a local configuration step
only; no committed configuration or cloud queue is changed.

Event format is already compatible: the Article service publishes
`{ eventId, eventType: "article.submitted", articleId, occurredAt }`, which is
exactly what the Editorial consumer validates.
