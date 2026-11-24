# SupportHub — Group Technical Evidence Pack (Group 12)

**Course:** Cloud Computing and Cloud Security (26CSCN29H) · **Branch:** `integration/group12-final`
**Team:** Alyaa Adel (Article & Category Management; shared Identity Service) · Salma Osama (Editorial Workflow & Publication) · Nermeen Mostafa (Knowledge Search, Feedback & Analytics)

Every result quoted here comes from an executed run; the file is named next to it
(`evidence/final/...` unless stated). Status words: **PASS**, **FAIL**, **NOT VERIFIED**.
Companion documents: `01-repository-audit.md`, `03-local-windows-runbook.md`,
`04-deployment-verification.md`, `05-security-tests.md`, `06-contribution-statements.md`,
`07-demo-plan.md`, `08-compliance-matrix.md`.

---

## 1. Problem definition
Support teams keep help content in unstructured places: articles go out unreviewed,
duplicate or outdated, and nobody knows which searches fail or which articles help.
SupportHub is a secure cloud knowledge base where articles are written, reviewed,
published, searched and measured in one controlled workflow.

## 2. Intended users
| User | Needs |
|---|---|
| Readers / customers | Search and read published articles; vote on helpfulness |
| Authors (support staff) | Write drafts, categories, versions, compare/restore, duplicate warnings, Stack Overflow references, submit for review |
| Editors / reviewers | Review queue, approve/reject with comments, publish, flag/resolve outdated content, editorial history |
| Administrators | Everything above plus analytics (views, searches, zero-result searches, unhelpful articles, exports) |

## 3. Benefits
Only reviewed content reaches customers; duplicates are caught before saving; every
change is versioned and restorable; analytics turn searches, views and votes into
measurable knowledge gaps; cloud hosting gives one shared, always-available source.

## 4. Scope and boundaries
In scope: everything in proposal §1.3 (articles, versions, duplicates, editorial
workflow, published search, views, votes, analytics, flags, RBAC, logging, cloud
deployment, security testing). Out of scope (unchanged): AI writing/search,
multi-level approval chains, enterprise SSO, ticketing/CRM, mobile apps.
Deviation recorded honestly: self-registration creates role `author` (the Neon
`users.role` constraint allows author/editor/admin only); there is no separate
`reader` role — readers are anonymous for search and any logged-in user can vote.

## 5. System architecture
Three layers: browser frontend (HTML/CSS/JS, Cloudflare Pages) → four Express
services (Identity shared + three student-owned) → PostgreSQL (Neon in the cloud,
local Postgres in the Floci stack) and AWS services (Floci). One same-origin `/api`
proxy (Cloudflare Pages Function, or `frontend/dev-server.js` locally) routes to
the services, so one session cookie works everywhere.

## 6. Architecture diagram
```
                         Browser (HTML/CSS/JS)
                                 │  HTTPS, same-origin /api/*
                  Cloudflare Pages Function  /  dev-server.js (local)
        ┌───────────────┬────────┴─────────┬────────────────────┐
        ▼               ▼                  ▼                    ▼
  Identity (shared)  Article (Alyaa)   Editorial (Salma)   Search & Analytics (Nermeen)
  login/register     articles,versions  queue,decisions,    search, views, votes,
  sessions, CSRF     duplicates, S3     publish, flags      analytics, exports
        │                │   ▲  HMAC GET/PATCH /internal │ HMAC POST /internal/publications
        │                │   └───────────────────────────┤────────────────────▶ Search
        │                │  HMAC GET /internal/articles/:id (published only) ◀── Search
        ▼                ▼                ▼                    ▼
  ┌──────────── PostgreSQL (Neon / local TLS Postgres): shared sessions + per-service tables ───────────┐
        │                │ outbox                 ▲ inbox             │
        │                ▼                        │                   ▼
  Secrets Mgr ◀── all   SQS supporthub-article-events ──▶ Editorial consumer     DynamoDB counters
  (per-ARN IAM)          (+ DLQ after 5 receives)       SNS publication topic ──▶ Lambda receipts
                         S3 article-backups             (Editorial)               CloudWatch metrics
                         (Article)                                                S3 analytics exports
  External: Cloudflare Turnstile (Identity registration, Search votes) · Stack Exchange API (Article)
```

## 7. Three-service ownership matrix
| Component | Owner | Code | Tables owned | AWS services |
|---|---|---|---|---|
| Article & Category Management | **Alyaa Adel** | `services/article-service` | categories, articles, article_versions, article_event_outbox, article_transition_operations | S3, SQS, Secrets Manager (+IAM) |
| Shared Identity Service | **Alyaa Adel** (implementation and maintenance; used by all) | `services/identity-service` | users, user_sessions, audit_logs (shared writes) | Secrets Manager (+IAM) |
| Editorial Workflow & Publication | **Salma Osama** | `services/editorial-service` | editorial_reviews, editorial_status_events, editorial_outdated_flags, editorial_workflow_operations, editorial_event_inbox, publication_outbox, editorial_publication_event_outbox/receipts | SQS, SNS, Lambda, Secrets Manager (+IAM) |
| Knowledge Search, Feedback & Analytics | **Nermeen Mostafa** | `services/search-analytics-service` | search_published_articles, search_query_logs, search_result_clicks, article_views, helpfulness_votes, article_feedback | DynamoDB, CloudWatch, S3, Secrets Manager (+IAM) |

## 8. Functional requirements (≥3 related functions per component, all executed)
| Component | Functions (business rules) | Evidence |
|---|---|---|
| Article | create/edit drafts (draft-only edit/delete, ownership); categories (in-use categories cannot be deleted); versions, compare, restore (creates a new version, never bypasses review); Jaccard duplicate detection limited to accessible articles; Stack Exchange references; S3 version backup; submit → transactional outbox | `e2e/lifecycle-*` §2 |
| Editorial | SQS-driven review queue; approve/reject with mandatory comment on rejection; self-review blocked; idempotent publication operations; outdated flags with mandatory resolution; editorial history | `e2e/lifecycle-*` §3, 5, 7 |
| Search | published-only search with category filter and ranking; views and click tracking; Turnstile-protected one-vote-per-user feedback; analytics (success rate, zero-result terms, unhelpful articles, CTR); DynamoDB live counters; S3 CSV export | `e2e/lifecycle-*` §5–6 |

## 9–10. REST API, methods and status codes
| Method | Path (via `/api`) | Service | Roles | Success | Errors |
|---|---|---|---|---|---|
| GET | /auth/csrf | Identity | public | 200 | 429 |
| POST | /auth/register | Identity | public + Turnstile | 201 | 400, 403, 409, 429 |
| POST | /auth/login · /auth/logout · GET /auth/me | Identity | public / auth | 200 | 400, 401, 403, 429 |
| GET | /categories | Article | public | 200 | 500 |
| POST/PATCH/DELETE | /categories[/:id] | Article | author, admin | 201/200/204 | 400, 401, 403, 404, 409, 429 |
| GET | /articles/mine · /articles/:id | Article | author (own), admin | 200 | 401, 403, 404 |
| POST | /articles | Article | author, admin | 201 | 400, 401, 403, 429 |
| PATCH/DELETE | /articles/:id | Article | owner (draft only) | 200/204 | 400, 401, 403, 404, 409 |
| POST | /articles/check-duplicates | Article | author, admin | 200 | 400, 401, 403, 429 |
| GET | /articles/:id/versions[/compare · /:versionId] | Article | owner | 200 | 400, 401, 403, 404 |
| POST | /articles/:id/restore | Article | owner | 200 | 400, 401, 403, 404, 409 |
| POST/GET | /articles/:id/versions/:vid/export | Article (S3) | owner | 200 | 401, 403, 404, 503 |
| GET | /articles/related-questions?q= | Article (Stack Exchange) | author, admin | 200 | 400, 401, 403, 429, 502 |
| POST | /articles/:id/submit | Article (outbox→SQS) | owner | 200 | 401, 403, 409 |
| GET | /reviews?status= | Editorial | editor, admin | 200 | 401, 403 |
| POST | /articles/:id/reviews | Editorial | editor, admin (not own) | 201 | 400, 401, 403, 404, 409 |
| PATCH | /articles/:id/publication | Editorial | editor, admin | 200 | 401, 403, 404, 409 |
| GET | /articles/:id/history · /editorial/published · /editorial/flags | Editorial | editor, admin | 200 | 401, 403 |
| POST · PATCH | /articles/:id/flags · /flags/:id | Editorial | editor, admin | 201 · 200 | 400, 401, 403, 404, 409 |
| GET | /public/articles?q=&categoryId=&page= · /public/articles/:id | Search | public | 200 | 400, 404, 429 |
| POST | /articles/:id/votes · /articles/:id/feedback | Search | logged in + Turnstile | 200/201 | 400, 401, 403, 404, 429, 502 |
| GET/POST | /analytics/overview · live-counters · exports | Search | editor, admin | 200/201 | 401, 403, 503 |
| GET | /health (each service) | all | public | 200 | 503 |
Internal (HMAC only, not routed by the proxy): `GET /internal/articles/:id`, `PATCH /internal/articles/:id/status` (Article), `POST /internal/publications|unpublications` (Search).
Detailed docs: `services/article-service/API_DOCUMENTATION.md`, `services/search-analytics-service/SEARCH-API.md`, `docs/api-contract.md`.

## 11–12. Database schema and relationships
`users 1─* articles 1─* article_versions`; `categories 1─* articles`; `articles 1─* editorial_reviews / editorial_status_events / editorial_outdated_flags`;
`search_published_articles 1─* article_views / helpfulness_votes (UNIQUE article_id,user_id) / article_feedback`; `search_query_logs 1─* search_result_clicks`;
`article_event_outbox` (Article) → SQS → `editorial_event_inbox` (Editorial, PK event_id = idempotency);
`editorial_publication_event_outbox` → SNS → Lambda → `editorial_publication_event_receipts` (PK event_id).
Constraints: role and status CHECKs, one pending review per article (partial unique index), unique categories, versions `UNIQUE(article_id, version_number)`.
Schema sources: each service's `migrations/`, `infra/floci/db/00-core-schema.sql` (local), Neon check `services/search-analytics-service/evidence/dev-schema-check.txt`.
Each service writes only its own tables; cross-service data goes through HMAC APIs or events.

## 13. Roles and permission matrix (enforced in the backend)
| Action | Anonymous | Author | Editor | Admin | Enforced in |
|---|---|---|---|---|---|
| Search/view published | ✔ | ✔ | ✔ | ✔ | Search (published table only) |
| Vote / feedback | ✖ 401 | ✔ | ✔ | ✔ | Search `requireLogin` + Turnstile + UNIQUE vote |
| Create/edit/delete drafts | ✖ 401 | own only | ✖ 403 | ✔ | Article `requireRole` + `canAccess` |
| Versions / restore / backup | ✖ | own only | ✖ | ✔ | Article `versionService` ownership |
| Submit for review | ✖ | own drafts | ✖ | ✔ | Article `transitionStatus` (atomic `author_id` check) |
| Review queue, approve/reject | ✖ | ✖ 403 | ✔ (not own) | ✔ | Editorial `requireReviewer`, self-review check |
| Publish / flags / history | ✖ | ✖ 403 | ✔ | ✔ | Editorial |
| Analytics | ✖ | ✖ 403 | ✔ | ✔ | Search `requireReviewer` |
Verified: ST-01…ST-05, ST-13 (`05-security-tests.md`) and 143 expected denials in k6.

## 14. Authentication and authorization
bcrypt (cost 12), 12–72-byte passwords, session regeneration on login, Postgres session
store shared by all services (`supporthub.sid`, HttpOnly, SameSite=Lax, Secure in
production, 8 h), CSRF token per session (timing-safe), Origin allow-list on writes,
role + ownership checks in every service, 30/15 min login limit, failed logins audited.

## 15. Service-to-service communication
**Synchronous (REST + HMAC-SHA256):** sender, 13-digit timestamp (±5 min), method, path
and body hash are signed with `SERVICE_SHARED_SECRET`; 10 s timeouts; Search only ever
receives published articles; only Editorial may change article status, with an
`operationId` making retries idempotent (`article_transition_operations`).
**Asynchronous (SQS/SNS):** submit writes the article status **and** an outbox row in one
transaction → worker publishes to SQS (now up to 25 events per 5 s tick) → Editorial
consumer checks its inbox (duplicate events acknowledged without side effects), fetches the
authoritative author over HMAC, creates the review, deletes the message only after commit;
failures stay in SQS and move to the DLQ after 5 receives. Publication writes an SNS outbox
row → publisher → SNS → Lambda writes an idempotent receipt.
Measured: submission visible in the editor queue after **1.1 s**; SNS→Lambda receipt **≤3.5 s**; 116/116 events delivered, 47/47 Lambda receipts (`aws/aws-usage-*.txt`).

## 16. External integrations
| Integration | Real job | Verification |
|---|---|---|
| Cloudflare Turnstile | Server-side token check before registration (Identity) and votes/feedback (Search); secret key only on the server | Fail-closed behaviour PASS (400/502); valid-token success **NOT VERIFIED** in the sandbox (host blocked); earlier team evidence `services/search-analytics-service/evidence/turnstile.txt` |
| Stack Exchange API | Related Stack Overflow questions (title + link only, never copied) for authors | Safe 502 on outage PASS in browser; live results **NOT VERIFIED** here (host blocked) |

## 17–18. Cloud deployment architecture and Floci implementation
Floci 2.5.0 (`floci/floci`, IAM enforcement **on**) runs S3, SQS, SNS, Lambda (Node 22), DynamoDB,
CloudWatch, Secrets Manager and IAM. `infra/floci/docker-compose.supporthub.yml` runs Floci, Postgres
(TLS, no host port), 4 APIs, 3 workers and the frontend proxy on network `supporthub-int-net`, coexisting
with the team's existing containers. Public demo deployment: Cloudflare Pages + Vercel + Neon (`04-deployment-verification.md`).

## 19. AWS service usage per student (runtime proof, `aws/aws-usage-20261124T021842Z.txt`)
| Student | Component | AWS service | Actual use | IAM permissions | Verification |
|---|---|---|---|---|---|
| Alyaa | Article | S3 | version backups `articles/<id>/versions/<v>.json`, retrieval | Get/PutObject on `articles/*`, ListBucket; no Delete | backups listed; e2e export/retrieve 200 — PASS |
| Alyaa | Article | SQS | transactional outbox publisher | `sqs:SendMessage` on article-events | 116 events published — PASS |
| Alyaa | Article | Secrets Manager | session, HMAC, DB URL, runtime config at start-up | GetSecretValue on 4 ARNs | start-up log; deny test — PASS |
| Alyaa | Identity (shared) | Secrets Manager | session, DB URL, Turnstile secret | GetSecretValue on 3 ARNs | start-up log — PASS |
| Salma | Editorial | SQS | consumer of article events with inbox idempotency | Receive/Delete/ChangeVisibility on article-events | 116 inbox rows — PASS |
| Salma | Editorial | SNS | publication events | `sns:Publish` on publication topic | 47 published — PASS |
| Salma | Editorial | Lambda | publication-outcome subscriber writing receipts | role with own log group only | 47 receipts — PASS |
| Salma | Editorial | Secrets Manager | session, HMAC, DB URL, CRON secret | GetSecretValue on 4 ARNs | start-up log — PASS |
| Nermeen | Search | DynamoDB | live search/article counters | UpdateItem/Scan on own table | 25 items — PASS |
| Nermeen | Search | CloudWatch | request/latency/error/search metrics | PutMetricData | 8 metric names — PASS |
| Nermeen | Search | S3 | analytics CSV exports | Get/PutObject `exports/*` | 3 exports — PASS |
| Nermeen | Search | Secrets Manager | session, HMAC, DB URL, Turnstile secret | GetSecretValue on 4 ARNs | start-up log — PASS |

## 20. Individual IAM security
Four IAM users (Floci; IAM roles on real AWS): `supporthub-article-service`, `supporthub-editorial-service`,
`search-analytics-service`, `supporthub-identity-service`, plus the Lambda execution role. Policies in
`infra/iam/*.json` and `services/search-analytics-service/infra/iam/`. **39/39** allow/deny tests PASS
with each component's own key (`iam/iam-permission-tests-20261124T020750Z.txt`): e.g. Article cannot read
Editorial's secret or Search's DynamoDB; Editorial cannot publish article events or create topics; Search
cannot read Article backups; Identity cannot read the internal HMAC secret.

## 21. Shared Secrets Manager
Seven secrets: `supporthub/shared/{session,service-hmac,database}`, `supporthub/{article/runtime-config,editorial/runtime,search/runtime,identity/runtime}`.
One loader (`config/secrets.js` + `start.js`, identical in all services): JSON secrets, allow-listed keys only,
values never logged, retries transient errors, `SECRETS_REQUIRED=true` fails closed, `.env` fallback for local
development. All four services loaded their secrets at start-up (`aws/aws-usage-*`); cross-component retrieval is
denied and the service refuses to start (`aws/secrets-runtime-denial.txt`). **Rotation:** `aws secretsmanager
put-secret-value` (or Secrets Manager rotation) then restart the services; for `shared/session` all sessions are
invalidated (users log in again); for `service-hmac` restart all three internal services together.
**Recovery:** if Secrets Manager is down, required mode keeps the old containers running and new ones refuse to start;
setting `AWS_SECRETS_ENABLED=false` with `.env` values is the documented emergency fallback.

## 22. Docker architecture
Images: `node:22-alpine`, production dependencies only (`npm ci --omit=dev`), non-root `node` user, `.env` excluded
by `.dockerignore`, `CMD node start.js`. 11 containers, health checks via `/api/health`, restart `unless-stopped`.

## 23. Infrastructure automation
`infra/floci/setup-supporthub.sh` (idempotent; 35/35 PASS, `setup/setup-supporthub-cloud-sandbox-run.txt`),
`verify-iam.sh`, `verify-aws-usage.sh`, `lambda/build-lambda-zip.js`. Existing PowerShell (`setup-article-aws.ps1`) and
Search Bash (`services/search-analytics-service/infra/setup-floci.sh`) scripts kept.

## 24. Threat model (application-specific)
| # | Threat | Component | Scenario | Impact | Likelihood | Mitigation | Test | Residual risk |
|---|---|---|---|---|---|---|---|---|
| T1 | Credential theft / brute force / session hijack | Identity | password guessing on `/auth/login`; stolen cookie | account takeover | Medium | bcrypt 12, 30/15 min limit, regenerate session, HttpOnly/SameSite, 8 h expiry, LOGIN_FAILED audit | ST-15, ST-21 | per-IP limit only; no MFA |
| T2 | Unauthorized approval/publication | Editorial | author calls `/reviews` or `/publication` directly | unreviewed content public | Medium | backend role checks, self-review block, HMAC-only status changes | ST-02, ST-17 | compromised editor account |
| T3 | Access to another author's draft | Article | change `:id` in URL | data leak | High | ownership check on every record, 403 | ST-04 | admin can see all |
| T4 | SQL injection | All | `1 OR 1=1`, `'; DROP…` | data loss | Medium | parameterised queries, strict ID parsing | ST-08, ST-09, ST-11 | — |
| T5 | Stored XSS | Article → frontend | `<script>` in article | session abuse | Medium | text-only rendering, CSP, nosniff | ST-10, ST-22 | third-party Turnstile script trusted |
| T6 | Secret exposure | Repo/cloud | secrets in Git or logs; cross-service secret read | full compromise | Medium | Secrets Manager per-ARN IAM, gitignore, no secret logging | ST-19, ST-20 | **historical Neon URL in history → rotate** |
| T7 | Bots / repeated votes / search floods | Identity, Search | scripted registrations, vote stuffing | skewed analytics | High | Turnstile, login required, UNIQUE vote, search 120/15 min | ST-13, ST-14, ST-16 | distributed IPs |
| T8 | CSRF | All writes | cross-site form posts with the user's cookie | unwanted changes | Medium | CSRF token + Origin allow-list + SameSite | ST-06, ST-07 | — |
| T9 | Invalid workflow transitions | Editorial/Article | publish a draft, replay operations | inconsistent status | Medium | allowed-transition table, conditional UPDATE, operationId | ST-12 | — |
| T10 | Data loss / outage | Platform | worker crash, Floci/SQS down | lost submissions | Low | transactional outbox, inbox idempotency, DLQ, retries, S3 backups | `evidence/integration/real-outbox-retry.txt`, `isolated-floci-recovery-v2.txt` | no point-in-time restore on free tier |
| T11 | Unauthorized version access/restore | Article | change version IDs | leak/overwrite | Medium | version belongs to article + owner check | ST-05 | — |
| T12 | Duplicate-detection exposure/abuse | Article | probe private drafts, huge inputs | leak, CPU | Medium | accessible articles only, size limits, 30/15 min | ST-16 | — |

## 25. Security tests
22 executed tests, 21 PASS, 1 FAIL (historical secret, mitigated) — `05-security-tests.md`.

## 26. Functional integration testing
`tests/integration/lifecycle-e2e.mjs`: **47/47 PASS** (`e2e/lifecycle-20261124T021310Z.txt`) — registration rejection paths,
login, create, edit, versions, compare, duplicates, S3 backup, submit, SQS → queue, approve, publish, SNS → Lambda,
search, view, vote, analytics, DynamoDB, S3 export, reject path, history, flag/resolve.
Browser: `tests/integration/frontend-smoke.cjs` **20/20 PASS** (Chromium, CSP enforced). Unit tests: **351/351 PASS**
(Identity 25, Article 64, Editorial 169, Search 93 — `unit-tests/all-services-*.txt`).

## 27–28. Load test (k6, ~1,000 requests) and Author/Editor breakdown
`tests/load/k6/workflow-1000-requests.js`, run 2026-11-24 against the integrated stack (load-test profile),
14 VUs, 25.9 s (`load/workflow-20261124T021755Z-summary.md`).

| Metric | Result |
|---|---|
| Total requests | 1,001 |
| Author requests | 440 |
| Editor requests | 300 |
| Reader requests | 250 |
| Setup (logins, CSRF, categories) | 11 |
| Successful | 1,001 (858 × 2xx + 143 expected authorization denials) |
| Failed (unexpected) | 0 |
| HTTP 2xx / 4xx / 5xx | 858 / 143 (all deliberate 401/403 probes) / 0 |
| Average / median | 20.3 ms / 13.1 ms |
| P90 / P95 / max | 36.8 ms / 61.4 ms / 333 ms |
| Throughput | 38.6 req/s |
| Error rate | 0.00 % |

| Role | Requests | What they did | p95 |
|---|---|---|---|
| Author | 440 | 55× (list own, create draft, edit, versions, duplicate check, get, submit) + 55 denied editorial-queue probes | 32.7 ms |
| Editor | 300 | 60 queue reads, **60 decisions (40 approve + publish, 20 reject)**, published lists + 60 denied article-creation probes | 77.5 ms |
| Reader | 250 | 138 searches, 28 views, 28 clicks, 28 votes + 28 denied anonymous votes | 28.8 ms |

Consistency after the run: 47 published = 47 approved = 47 search-index rows = 47 Lambda receipts; 116/116 outbox events delivered.
**Finding fixed:** the first run showed the outbox worker published only 1 event per 5 s (49 submissions waited); it now drains up to 25 per tick (`services/article-service/services/articleOutboxWorker.js`).
Earlier read-only results are preserved in `evidence/integration/load/LOAD_TEST_REPORT.md`.

**Production vs testing limits:** production profile (default) — login/register 30, article create 30, update 60, duplicates 30, submit 30, restore 30, backups 20, categories 30, editorial decisions/publication/flags 60, search 120, clicks 120, votes/feedback 20, exports 10, general 300 per 15 min per client. Load-test profile — 20,000 per named limiter, 100,000 general; **refused when `NODE_ENV=production`**; login limit fixed at 30 in both. Verified: `rate-limits/production-limits-*.txt` (429 at 31/121/30).

## 29. Logging and monitoring
JSON security events from all services (401/403/429), `audit_logs` (logins, failed logins, article actions), Editorial status
events, CloudWatch metrics from Search, Docker logs per container, Floci health. Never logged: passwords, cookies, tokens, bodies, secrets.

## 30. Failure handling and recovery
Outbox retry + DLQ, consumer acknowledges only after commit, idempotent inbox/receipts/operations, publication outbox with
reconciliation state, AWS failures return 503/502 without crashing, Secrets Manager fail-closed, DB pool exhaustion returns
503 with Retry-After (Search). Evidence: `evidence/integration/real-outbox-retry.txt`, `isolated-floci-recovery-v2.txt`,
`retry-idempotency-tests.txt`, `aws/secrets-runtime-denial.txt`.

## 31. Shared responsibility
Provider (Cloudflare, Vercel, Neon, AWS/Floci host): physical security, managed runtime, TLS endpoints, storage durability.
Team: secure code, IAM policies, secrets, CORS/Origin, CSRF, validation, rate limits, logging, schema migrations, backups, rotation.

## 32. Cost and resource awareness
Free tiers only (Pages, Vercel Hobby, Neon free, Floci local). Per-request AWS calls batched (DynamoDB counters every 5 s,
CloudWatch every 5–10 s), DB pools 5–10 connections, caches for search/analytics, outbox batch limited to 25.

## 33. Security limitations and assumptions
Historical Neon credential in Git history (rotation required); in-memory rate-limit counters (per instance on Vercel);
no MFA; self-registered users are authors; Floci IAM users stand in for AWS roles; Turnstile and Stack Exchange live calls
not verifiable from the sandbox; Cloudflare/Vercel production not verified from the sandbox.

## 34. Individual contribution statements
See `06-contribution-statements.md` (appended at the end of the final report).

## 35. Final demonstration plan
See `07-demo-plan.md` (5-minute script).
