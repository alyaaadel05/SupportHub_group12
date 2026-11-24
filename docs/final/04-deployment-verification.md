# SupportHub — Deployment Audit (Vercel, Cloudflare Pages, Neon, Turnstile)

**Status of this document:** configuration audit from the repository + exact
verification steps. **No production setting was changed.** The cloud sandbox used
for this work cannot reach `*.vercel.app`, `vercel.com`, `*.pages.dev`,
`challenges.cloudflare.com` or `api.stackexchange.com` (blocked by the
environment's network policy, HTTP 403 from the proxy), so every live
deployment check below is **NOT VERIFIED** until a team member runs it.

## 1. How the project is deployed (from the repository)

| Part | Host | Deployed how | Evidence in repo |
|---|---|---|---|
| Frontend | Cloudflare Pages `supporthub-group12.pages.dev` | Pages project connected to GitHub (proposal §3.5); Pages Function `frontend/functions/api/[[path]].js` proxies `/api/*` | `frontend/` |
| Identity (Alyaa) | Vercel project (Alyaa) | `services/identity-service/vercel.json` | `evidence/integration/article-deployment-verification.txt` |
| Article (Alyaa) | Vercel project (Alyaa) | `services/article-service/vercel.json` (`@vercel/node`, `server.js`) | same |
| Editorial (Salma) | Vercel project (Salma) | `services/editorial-service/vercel.json` | — |
| Search & Analytics (Nermeen) | `https://supporthub-search-analytics.vercel.app` | Vercel **CLI** (`npx vercel`, `npx vercel --prod`) — no Git auto-deploy | `services/search-analytics-service/DEPLOYMENT.md`, `evidence/vercel-online.txt`, `evidence/vercel-preview.txt` |
| Database | Neon PostgreSQL (pooled endpoint) | — | `services/search-analytics-service/evidence/dev-schema-check.txt` |

**Preview deployments for `integration/group12-final`:**
- Vercel: the backends are deployed with the Vercel CLI from each owner's account
  (documented for Search; no Git integration files exist for the others), so
  **pushing this branch does not create Vercel deployments** and does not touch production.
- Cloudflare Pages: if the Pages project is connected to GitHub with the default
  settings, every non-production branch push creates a **Preview** deployment at
  `https://integration-group12-final.supporthub-group12.pages.dev` (branch alias)
  while production stays on the production branch (normally `main`).
  **NOT VERIFIED** — check in Cloudflare dashboard → Pages → supporthub-group12 →
  Settings → Builds & deployments → "Preview deployments: All non-Production branches".

## 2. What the new code changes when it is deployed

| Change | Effect on Vercel/Pages | Action needed |
|---|---|---|
| `server.js` per-endpoint rate limits | Active on Vercel (production profile). `RATE_LIMIT_PROFILE=loadtest` is **ignored when `NODE_ENV=production`**. In-memory counters are per serverless instance. | none |
| `start.js` + Secrets Manager loader | **Not used on Vercel** (Vercel runs `server.js`); Vercel keeps using its environment variables. | none |
| Structured security-event logs | Appear in Vercel runtime logs (JSON lines). | none |
| Article 502 passthrough | Stack Exchange outages now return 502 "Reference provider unavailable" instead of 500. | none |
| `frontend/_headers` (CSP etc.) | Applied by Cloudflare Pages to static pages. Verified in a real browser locally: 0 CSP violations, Turnstile script allowed. | check the Preview before merging to `main` |
| Pages Function routing | Adds Editorial routes for `/flags/:id`, `GET /articles/:id/history`, `POST /articles/:id/submissions` (previously 404). Existing routes unchanged. | none |
| `backend/.env.example` | Real Neon credentials removed from the file (they remain in Git history). | **rotate that Neon password** |

## 3. Required environment variables (names only)

**Cloudflare Pages (frontend project):** `IDENTITY_ORIGIN`, `ARTICLE_ORIGIN`, `EDITORIAL_ORIGIN`, `SEARCH_ANALYTICS_ORIGIN` (each `https://<project>.vercel.app/`, no path).
Turnstile **site key** is public and set in `frontend/js/config.js` (`0x4AAAAAAGKXHCV-7y1Q1mjv` for production, Cloudflare test key on localhost).

**All four Vercel backends:** `NODE_ENV=production`, `DATABASE_URL` or `DATABASE_URL_POOLED` (Neon), `SESSION_SECRET` (**identical** in all four), `FRONTEND_ORIGIN=https://supporthub-group12.pages.dev` (comma-separate preview origins if needed).

| Service | Additional variables |
|---|---|
| Identity | `TURNSTILE_SECRET_KEY` (**required** in production — the server refuses to start without it) |
| Article | `SERVICE_SHARED_SECRET`, optional `STACK_EXCHANGE_KEY`; S3/SQS/Secrets variables only where an AWS account exists (see §5) |
| Editorial | `SERVICE_SHARED_SECRET`, `ARTICLE_SERVICE_URL`, `SEARCH_SERVICE_URL`, `CRON_SECRET` |
| Search & Analytics | `SERVICE_SHARED_SECRET`, `ARTICLE_SERVICE_URL`, `TURNSTILE_SECRET_KEY`, `REQUIRE_TURNSTILE_FOR_VOTES=true`, optional `HF_INFERENCE_URL`/`HF_TOKEN`, `DB_POOL_MAX` |

Never set on Vercel: `RATE_LIMIT_MAX`, `RATE_LIMIT_PROFILE=loadtest`, `AWS_ENDPOINT_URL` pointing at Floci.

List names without values:

```bash
npx vercel env ls production
```

## 4. Verification steps (run on a team machine — no setting is changed)

1. Health of each backend and of the Pages proxy:

```bash
for u in https://supporthub-group12.pages.dev/api/auth/csrf https://supporthub-group12.pages.dev/api/categories "https://supporthub-group12.pages.dev/api/public/articles?q=password"; do curl -s -o /dev/null -w "%{http_code}  $u\n" "$u"; done
```

```bash
curl -s https://supporthub-search-analytics.vercel.app/api/health
```

(Repeat `/api/health` for the Identity, Article and Editorial Vercel URLs; protected previews need `npx vercel curl <url>/api/health`.)

2. Full lifecycle against the **Preview** frontend with **test accounts only** (it creates articles; do not run it against production data). `DB_CONTAINER=` disables the local database checks:

```bash
BASE_URL=https://integration-group12-final.supporthub-group12.pages.dev DB_CONTAINER= SUPPORTHUB_DEMO_PASSWORD='<test-account password>' node tests/integration/lifecycle-e2e.mjs
```

The script expects the accounts `author@`, `author2@`, `editor@`, `admin@supporthub.test`; create them in the target database first or edit the emails. Expected differences on Vercel (no Floci there): the S3 backup step returns **503** ("S3 bucket is not configured"), the SQS step only works if the Article outbox worker runs somewhere with SQS access, and the SNS/Lambda checks are skipped (no `DB_CONTAINER`).

3. Turnstile server-side validation (production): open `https://supporthub-group12.pages.dev/login.html`, register with the widget completed → **201**; then replay the request without `turnstileToken` (DevTools → copy as fetch, delete the field) → **400 "Turnstile verification failed"**. Votes: `POST /api/articles/:id/votes` without a token → **403 "Turnstile token required"**.

4. Neon connectivity: every `/api/health` response includes a database `SELECT 1`; Search also reports `"database":"connected"`.

## 5. Floci-only features and what production would need

| Feature | Works locally (Floci) | Production requirement |
|---|---|---|
| Article S3 backups, SQS outbox, Secrets Manager | yes (verified) | A real AWS account: S3 bucket, SQS queue + DLQ, secrets, IAM **roles** (not users) with the same policy documents; a long-running outbox worker (not Vercel serverless) or an AWS Lambda/EventBridge schedule |
| Editorial SQS consumer, SNS publisher, Lambda | yes (verified) | Same AWS account; consumer as a container/Lambda with SQS trigger; Lambda deployed with the role in `infra/iam/editorial-lambda-logs-policy.json` |
| Search DynamoDB, CloudWatch, S3 export | yes (verified) | AWS account; on Vercel these features skip gracefully when their variables are unset |
| Shared Secrets Manager | yes (verified) | AWS Secrets Manager; run services with `node start.js` on a host that has an IAM role |

The coursework explicitly allows Floci as the deployment target; the Vercel deployments remain the public demonstration of the web application.

## 6. Result summary

| Check | Result |
|---|---|
| Repository deployment configuration audited | PASS |
| Required environment variables documented (names only) | PASS |
| Production deployment untouched by this work | PASS (no deploy/CLI/dashboard action was performed) |
| Cloudflare Pages Preview for `integration/group12-final` | NOT VERIFIED (dashboard access needed) |
| Vercel Preview for this branch | Not expected (CLI deployments) — NOT VERIFIED |
| Deployed `/api/health` endpoints | NOT VERIFIED (hosts blocked from the sandbox) |
| Deployed registration/login/submission/approval/search | NOT VERIFIED — run §4.2 |
| Turnstile validation in production | NOT VERIFIED here; earlier team evidence: `services/search-analytics-service/evidence/turnstile.txt` |
| Neon connectivity | NOT VERIFIED here; earlier evidence: `evidence/vercel-online.txt` (Search) |
