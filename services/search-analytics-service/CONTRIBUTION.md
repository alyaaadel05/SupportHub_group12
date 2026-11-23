# Contribution Statement — Nermeen Mostafa (239814)

**Role:** Search, Feedback & Analytics Service owner (SupportHub, Group 12)
**Branch:** `feature/nermeen-search-feedback-analytics` · **Commits:** 67 authored commits (16–21 Nov 2026)
**Folder owned:** `services/search-analytics-service/` + `frontend/js/analytics.js`

## 1. What I implemented myself

| Area | What I built | Evidence |
|---|---|---|
| **Search backend** | Independent Express service (port 3004): keyword search with a documented relevance rule (title +5, category +3, content +1), category filter, pagination with safe limits, published-only index, article details, search history in Neon | `services/searchService.js`, `services/ranking.js`, `SEARCH-API.md`, tests |
| **Publication integration** | Signed (HMAC) `/internal/publications` + `/internal/unpublications`; the service re-fetches each article from the Article Service and indexes it only if `published`; idempotent read-only sync script | `middleware/security.js`, `services/serviceClient.js`, `scripts/sync-published.js`, `evidence/signed-publication-test.txt` |
| **Feedback & voting** | Logged-in helpful/unhelpful votes (one per user per article, changeable), written feedback, Turnstile check, rate limiting. Sentiment analysis (Hugging Face) is implemented but not live: the provider returns 402 (no free credits), handled safely | `services/feedbackService.js`, `evidence/live-integration.txt`, `evidence/vote-abuse.txt`, `evidence/sentiment.txt` |
| **Analytics** | Totals, success / zero-result / click-through / helpfulness rates, popular terms, knowledge gaps, most-viewed, trending (7 days), daily activity, poorly rated articles with a minimum-vote rule, sentiment breakdown | `services/analyticsService.js`, `ANALYTICS.md`, `evidence/analytics-accuracy.txt` |
| **AWS on Floci (3 services + IAM)** | DynamoDB batched live counters, CloudWatch custom metrics, private encrypted S3 CSV exports, least-privilege IAM user and policy, repeatable setup script | `services/countersService.js`, `metricsService.js`, `exportService.js`, `infra/`, `AWS-ARCHITECTURE.md`, `AWS-DYNAMODB.md` |
| **Analytics dashboard (frontend)** | Rewrote `frontend/js/analytics.js` to use my real API: stat cards, trends, knowledge gaps, poorly rated, sentiment, DynamoDB live counters, S3 export button; only runs on the analytics page; `textContent` only (XSS-safe) | `frontend/js/analytics.js`, `FRONTEND-INTEGRATION.md` |
| **Frontend ↔ backend fixes** | Found and fixed 7 integration mismatches (response fields, endpoint names, roles, category parameter, redirect bug) on the Search side | `FRONTEND-INTEGRATION.md` |
| **Security** | Threat model (10 threats) and 21 documented security tests: SQL injection, unpublished exposure, 401/403 roles, forged/replayed internal requests, CSRF, rate limiting, CSV injection, path traversal, IAM, Turnstile (incl. reused tokens), XSS, external API failure | `SECURITY.md`, `evidence/` |
| **Performance** | k6 load tests (5/25/100 users); found the DynamoDB per-request bottleneck and batched it (p95 1.74 s → 160 ms, ~38 → ~85 req/s); final run on 21 Nov: 4960 requests, 0 failed, p95 452 ms | `load-tests/`, `SCALING.md` |
| **Docker & deployment** | Dockerfile (non-root, health check), container with Neon + Floci; own Vercel project (production + preview), environment variables as Secrets, `.vercelignore` | `Dockerfile`, `DEPLOYMENT.md`, `evidence/vercel-*.txt` |
| **Automated tests** | 73 tests (ranking, validation, security, unauthorized access, DynamoDB, CloudWatch, S3, analytics calculations, category filter) | `tests/`, `npm test` |

## 2. Integration work done together with the team

- **Shared login:** verified my service reads Identity's shared session (author → 403, editor → 200) online and locally; diagnosed a session-secret mismatch.
- **Neon password rotation:** updated my local `.env`, Docker and Vercel after the team lead rotated the password; switched local tests to the Neon development branch and checked its schema read-only.
- **Cross-laptop test over Tailscale:** Editorial (Salma) → my Search (HMAC) → Article (Alyaa, HMAC) → indexed (`updated_at` changed at the moment of the request).

## 3. Statement

I confirm that the work listed in section 1 was implemented by me on my own branch, and that every claim is backed by the code, commits and evidence files referenced above.

Nermeen Mostafa — 239814