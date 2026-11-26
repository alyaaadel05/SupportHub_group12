# 12. Teammate Contribution-Statement Templates

> Templates for Salma and Nermeen to complete, correct and sign.
> - They list only facts about each student's **original** work, taken from the code, Git history and
>   evidence.
> - `[brackets]` mark things only the student can confirm.
> - Later fixes made during integration are not listed here; they are in Alyaa's statement
>   (`05-alyaa-contribution-statement.md` §5.4).

---

## Salma Osama (245536): Editorial Workflow & Publication Service

### Component and functions
I own `services/editorial-service`. It provides:
- the review queue;
- approve and reject decisions with comments;
- publication;
- editorial history (status events);
- outdated-content flags with mandatory resolution;
- the asynchronous link to the Article Service (SQS) and to subscribers (SNS → Lambda).

### What I implemented
My commits are `c6102d7`, `a3cf090` and `3d97c20`, plus [list any others] (`git log --author=Salma`).
- **Review workflow:** `submit`, `queue`, `decide`, `history` in `services/reviewService.js`. One
  pending review per article (partial unique index in `migrations/001_editorial.sql`).
- **Publication:** `publish` and `reconcilePublication` in `services/publicationService.js`, with
  idempotent workflow operations (`services/workflowOperationRepository.js`, migrations 003 and 004).
- **Outdated flags:** `services/flagService.js`, `migrations/001_editorial.sql`, `007_flag_integrity.sql`.
- **SQS consumer:** `workers/articleEventConsumer.js`, with a durable inbox for idempotency
  (`migrations/005_editorial_event_inbox.sql`).
- **HMAC client** for Article and Search: `signedHeaders`, `getArticle`, `transitionArticle`,
  `notifySearch` in `services/serviceClient.js`.
- **SNS publication events:** `services/publicationEventService.js`, `workers/publicationEventPublisher.js`,
  `migrations/006_editorial_publication_events.sql`.
- **The publication-outcome Lambda handler**, a migration runner with checksums and advisory locks,
  and the Editorial Docker setup. [Confirm the Lambda folder and the migration-runner file names.]

### Security controls
- Role checks: `requireAuthor` and `requireReviewer` in `middleware/security.js`.
- Self-review block ("Cannot review your own article") and self-publication block.
- CSRF and Origin check on every write: `requireBrowserWrite`.
- `requireCronSecret` for the internal retry endpoint.
- Parameterised SQL and a 100 kb body limit.
- Threat model with 9 threats (T1–T9) in `docs/threat-model.md`, and HTTP-level security tests
  S1–S8 in `docs/security-test-evidence.md`.
- [Add anything else you designed, for example the per-route rate limits.]

### Major decisions
- [Why an inbox table rather than relying on SQS deduplication.]
- [Why a message is deleted only after the database commit.]
- [Why publication uses idempotent operations with reconciliation.]
- [Why SNS plus a Lambda receipt is used for publication events.]

### Tests
- Full suite on 2026-11-23: **151 tests, 151 passed** (136 existing + 15 added)
  (`services/editorial-service/docs/security-test-evidence.md`).
- [Paste your own final `npm test` summary, as that document asks.]

### Difficulties
- [Describe one or two real problems you solved, and how you solved them.]

Later reliability fixes in this component were implemented by Alyaa (see her statement).

Signed: ____________________  Date: __________

---

## Nermeen Mostafa (239814): Knowledge Search, Feedback & Analytics Service

### Component and functions
I own `services/search-analytics-service` and `frontend/js/analytics.js`. It provides:
- published-only search with a category filter, ranking and pagination;
- article views and click tracking;
- helpfulness votes and written feedback with sentiment;
- the analytics dashboard;
- DynamoDB live counters, CloudWatch metrics and S3 CSV exports.

### What I implemented
Facts from my own statement, `services/search-analytics-service/CONTRIBUTION.md`: 67 authored
commits between 16 and 21 Nov 2026. [Confirm the final number.]
- **Search:** `search` and `getPublicArticle` in `services/searchService.js`. Relevance rule in
  `services/ranking.js`: title +5, category +3, content +1.
- **Signed indexing:** `/internal/publications` and `/internal/unpublications`, checked by
  `requireEditorialSignature`. Each article is re-fetched from the Article Service (`serviceClient.js`)
  and indexed only if it is published.
- **Feedback:** `vote` and `comment` in `services/feedbackService.js`. One vote per user per
  article (`UNIQUE(article_id,user_id)`). Turnstile check (`middleware/turnstile.js`). Sentiment
  classification (`services/sentimentService.js`).
- **Analytics:** `computeOverview` in `services/analyticsService.js`: success rate, zero-result
  searches, click-through rate, knowledge gaps, poorly rated articles, trends. Caches with
  single-flight loading.
- **AWS:**
  - DynamoDB batched counters: `services/countersService.js`.
  - CloudWatch metrics: `services/metricsService.js`.
  - S3 CSV export: `services/exportService.js`.
  - Least-privilege IAM: `infra/iam/search-analytics-policy.json`.
- **Frontend:** `frontend/js/analytics.js` (uses `textContent` only).
- **Deployment:** Dockerfile and my own Vercel project.

### Security controls
- `requireLogin` and `requireReviewer` (author gets 403).
- `requireBrowserWrite` (CSRF and Origin).
- HMAC-signed internal routes.
- Turnstile on votes and feedback.
- Rate limits: public search 120.
- Path-traversal and formula-injection protection on CSV exports.
- Threat model with 10 threats and 21 documented security tests (`SECURITY.md`).
- [Confirm the list.]

### Major decisions
- **Batched DynamoDB counters:** p95 went from 1.74 s to about 160 ms, and throughput from about
  38 to about 85 req/s (`SCALING.md` §5.1).
- **Short caches with single-flight loading, and 503 with Retry-After on database-pool exhaustion:**
  the mixed 1,000-user test went from 64.29 % to **0.00 %** failed (14,178 requests) (`SCALING.md` §5.4).
- [Why sentiment is computed locally rather than by an external API.]

### Tests
- 73 automated tests at the time of my statement (`CONTRIBUTION.md`).
- k6 final run on 21 Nov: 4,960 requests, 0 failed, p95 452 ms (`SCALING.md` §5.2).
- 1,000-user search-only stress test: 12,027 requests, 0 failed (`SCALING.md` §5.3).
- [Paste your own final `npm test` summary.]

### Difficulties
- Database-pool exhaustion under analytics load (`SCALING.md` §5.4).
- Seven frontend-to-backend mismatches on the Search side (`FRONTEND-INTEGRATION.md`).
- [Add your own words.]

Later reliability fixes in this component were implemented by Alyaa (see her statement).

Signed: ____________________  Date: __________
