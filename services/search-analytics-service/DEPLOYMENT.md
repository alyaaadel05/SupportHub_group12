# Deployment — Search, Feedback & Analytics Service

## Live URL

- Service: https://supporthub-search-analytics.vercel.app
- Health: `/api/health` → `{"status":"ok","service":"search-analytics-service","database":"connected"}`
- Public search: `/api/public/articles?q=password` → returns the published article from Neon

## Team agreement

- Each backend is a separate Vercel project in its owner's free (Hobby) account; URLs are shared.
- Development and testing on feature branches; reviewed PRs are merged into `main`;
  the team production deploy is done from `main` after integration checks.
- Frontend: Cloudflare Pages (it uses the `functions/` directory).
- Secrets are set only in the hosting dashboard, never committed to GitHub.

## How it is deployed

Deployed from the service folder with the Vercel CLI (no Git auto-deploy, because the
repository belongs to the team lead and the team deploys manually after review).

```bash
cd services/search-analytics-service
npx vercel link          # project: supporthub-search-analytics
npx vercel --prod
```

- `vercel.json` builds `server.js` with `@vercel/node` and routes all paths to it.
- `server.js` exports the Express app (`module.exports = app`) and only calls
  `app.listen()` when run directly (`require.main === module`), so the same file works
  locally, in Docker and on Vercel.
- `.vercelignore` stops `.env`, `node_modules`, `evidence/` and load-test results from
  being uploaded.
- `.gitignore` in this folder ignores `.vercel/` and `.env*` (except `.env.example`).

## Environment variables on Vercel (names only)

Values are copied from the local `.env` straight into Vercel by the CLI, so they are never
shown on screen. `npx vercel env ls` lists them as `Hidden`.

| Name | Purpose |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL_POOLED` | Neon pooled connection (secret) |
| `SESSION_SECRET` | Shared session secret with Identity (secret) |
| `SERVICE_SHARED_SECRET` |