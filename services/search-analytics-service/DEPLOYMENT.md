# Deployment — Search, Feedback & Analytics Service

## Live URLs

- Production: https://supporthub-search-analytics.vercel.app
  - Health: `/api/health` → `{"status":"ok","service":"search-analytics-service","database":"connected"}`
  - Public search: `/api/public/articles?q=password` → returns the published article from Neon
- Preview (feature branch `feature/nermeen-search-feedback-analytics`):
  https://supporthub-search-analytics-fr8m1ygao-nermeen6.vercel.app
  - Protected by Vercel Deployment Protection (only the project owner can open it)
  - `npx vercel curl <preview>/api/health` → status ok, database connected (`evidence/vercel-preview.txt`)
- Shared frontend (Cloudflare Pages): https://supporthub-group12.pages.dev
  - `functions/api/[[path]].js` forwards `/api/public/*`, `/api/articles/:id/(votes|feedback|view)`
    and `/api/analytics/*` to this service using the Pages variable `SEARCH_ANALYTICS_ORIGIN`
    = `https://supporthub-search-analytics.vercel.app`
  - Because the browser only talks to `pages.dev`, the session cookie stays first-party.

## Team agreement

- Each backend is a separate Vercel project in its owner's free (Hobby) account; URLs are shared.
- Development and testing on feature branches (preview deployments); reviewed PRs are merged
  into `main`; the team production deploy is done from `main` after integration checks.
- One shared frontend on Cloudflare Pages connected to all backend URLs.
- Secrets are set only in the hosting dashboard, never committed to GitHub.
- Docker + Floci stay the environment for the AWS demonstration.

## How it is deployed

Deployed from the service folder with the Vercel CLI (no Git auto-deploy, because the
repository belongs to the team lead and the team deploys manually after review).

```bash
cd services/search-analytics-service
npx vercel link          # project: supporthub-search-analytics
npx vercel               # preview deployment
npx vercel --prod        # production deployment
```

- `vercel.json` builds `server.js` with `@vercel/node` and routes all paths to it.
- `server.js` exports the Express app (`module.exports = app`) and only calls
  `app.listen()` when run directly (`require.main === module`), so the same file works
  locally, in Docker and on Vercel.
- `.vercelignore` stops `.env`, `node_modules`, `evidence/` and load-test results from
  being uploaded.
- `.gitignore` in this folder ignores `.vercel/` and `.env*` (except `.env.example`).

## Environment variables on Vercel (names only)

Secret values are added with the Vercel CLI as type **Secret** (hidden in the dashboard,
not downloadable). `npx vercel env ls` lists them as `Hidden`.

| Name | Production | Preview | Purpose |
|---|---|---|---|
| `NODE_ENV` | ✅ | ✅ | `production` |
| `DATABASE_URL_POOLED` | ✅ | ✅ | Neon pooled connection, role `neondb_owner` (secret) |
| `SESSION_SECRET` | ✅ | ✅ | Must equal Identity's secret **in the same environment** (secret) |
| `SERVICE_SHARED_SECRET` | ✅ | ✅ | HMAC secret for internal Editorial requests (secret) |
| `FRONTEND_ORIGIN` | ✅ `https://supporthub-group12.pages.dev` | ✅ (local test origin) | Allowed browser origin (CORS / write checks) |
| `TURNSTILE_SECRET_KEY` | ✅ | – | Cloudflare Turnstile server-side check for votes/feedback (secret) |
| `COOKIE_SECURE` | ✅ | ✅ | `true` (HTTPS only) |
| `RATE_LIMIT_MAX` | ✅ | ✅ | 300 requests / 15 min / IP |
| `DB_POOL_MAX` | ✅ | ✅ | 3 (small pool per serverless instance) |

Not set on purpose:

| Name | Why |
|---|---|
| `PORT` | Set by Vercel |
| `AWS_*`, `DYNAMODB_COUNTERS_TABLE`, `CLOUDWATCH_NAMESPACE`, `S3_EXPORT_BUCKET` | AWS runs on Floci (local emulator). Without these, counters/metrics are skipped and exports return 503; search, voting and analytics still work from Neon. On the live dashboard the DynamoDB and S3 sections show "unavailable"; they are demonstrated on the local dashboard. |
| `HF_INFERENCE_URL`, `HF_TOKEN` | Hugging Face returns 402 (no free credits); sentiment would be `unavailable` anyway (see `SECURITY.md` S20). |

## Problems found during deployment

| Problem | Cause | Fix |
|---|---|---|
| Every request returned `500 FUNCTION_INVOCATION_FAILED` | `server.js` refuses to start without `FRONTEND_ORIGIN` (fail-closed security check). | Found with `npx vercel logs`; added `FRONTEND_ORIGIN` and redeployed. |
| Live site returned `{"error":"search service not configured"}` | Cloudflare Pages had no `SEARCH_ANALYTICS_ORIGIN`. | Variable name found in `functions/api/[[path]].js`; team lead added it and redeployed Pages. |
| Logged-in users got 401 from analytics | `SESSION_SECRET` on Vercel did not exactly match Identity's (hidden whitespace in the first paste). Cookie name, sessions table and `req.session.user` were checked and matched. | Re-entered the secret and redeployed → author 403, editor 200. |
| Authors redirected away from the articles page | The page also loaded `analytics.js`, whose role check redirected non-editors. | `analytics.js` now only runs on the analytics page. |

## Database credential rotation (21 Nov 2026)

The shared Neon password was rotated by the team lead after an old connection string was exposed.
For this service:
1. Confirmed role `neondb_owner`, database `neondb` and the pooled endpoint without revealing the password.
2. Updated `DATABASE_URL_POOLED` in the local `.env` and recreated the Docker container → health connected.
3. Replaced the Vercel Production variable (and Preview), redeployed → health connected.
No secrets were shared in chat, GitHub or screenshots.

## Online verification

| Check | Result |
|---|---|
| Health, keyword search, category filter (Vercel) | 200 (`evidence/vercel-online.txt`) |
| Analytics without login | 401 |
| Author logged in on pages.dev → analytics | 403 |
| Editor logged in on pages.dev → analytics | 200 with real data; live dashboard works |
| Vote + changed vote (same user) | saved; totalVotes stays 1 (`evidence/live-integration.txt`) |
| Vote without CSRF token | 403 |

## Still to do

- Publication test with Editorial: a newly approved article must become searchable (with the team).
- Team production deploy from `main` after PRs are merged.