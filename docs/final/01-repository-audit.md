# SupportHub Group 12 — Initial Repository Audit (Phase 1)

**Date:** 2026-11-24  **Branch audited:** `integration/group12-final` @ `4708d08`
**Method:** every source file, compose file, IAM policy, migration, test and
evidence file on the branch was read; all 12 remote branches were fetched and
their history summarised; the four service test suites were executed; the real
Floci image (`floci/floci:latest`, v2.5.0) was started and probed. No file was
changed before this audit was written.

Status legend used throughout: **Completed and tested** · **Implemented but not
fully tested** · **Partially implemented** · **Not implemented** · **Unable to verify**.

---

## 1. Architecture summary (as found)

```
Browser (HTML/CSS/JS, Cloudflare Pages)
   │  same-origin /api/*  (functions/api/[[path]].js  ->  4 HTTPS origins)
   ▼
Identity (3003)   Article (3001)   Editorial (3002)   Search & Analytics (3004)
   │ shared express-session cookie "supporthub.sid", store = Postgres user_sessions
   ▼
Neon PostgreSQL (single shared database, per-service tables)

Async:  Article --(transactional outbox)--> SQS supporthub-article-events(-demo)
                 --> Editorial consumer (inbox/idempotency) --> editorial_reviews
        Editorial --(publication outbox)--> SNS topic --> Lambda publication-outcome
Sync:   Editorial --HMAC--> Article /internal/articles/:id[/status]
        Editorial --HMAC--> Search  /internal/publications
        Search    --HMAC--> Article /internal/articles/:id   (published only)
AWS (Floci): S3, SQS, Secrets Manager, IAM (Article); SQS, SNS, Lambda (Editorial);
             DynamoDB, CloudWatch, S3, IAM (Search)
External: Stack Exchange API (Article), Cloudflare Turnstile (Identity register, Search votes/feedback)
```

## 2. Repository structure

| Path | Content | Owner (by Git history) |
|---|---|---|
| `services/identity-service` | Shared auth (register/login/logout/me/csrf) | Alyaa (9 of 11 commits) |
| `services/article-service` | Articles, categories, versions, duplicates, Stack Exchange, S3 backup, SQS outbox | Alyaa (20 of 21) |
| `services/editorial-service` | Review queue, decisions, publication, flags, SQS consumer, SNS publisher, Lambda | Salma (3 large commits, ~9,600 lines) + 3 integration commits by Alyaa |
| `services/search-analytics-service` | Search, views, votes, feedback, analytics, DynamoDB, CloudWatch, S3 export | Nermeen (56 of 58) |
| `frontend/` | 7 pages, JS modules, Cloudflare Pages Function proxy, dev proxy | Alyaa 14, Nermeen 5 |
| `infra/floci`, `infra/iam` | Article Floci compose, PowerShell setup, Article IAM policies | Alyaa |
| `tests/load` | Isolated load-test stack + k6 scripts | Alyaa |
| `evidence/` | 70+ evidence files (TXT/MD/PNG/JSON) | Alyaa 13, Nermeen 1 |
| `backend/`, `database/` | Original monolith prototype (marked temporary in proposal) | historical |

## 3. Three-service ownership

| Student | Component | Verified functions (≥3) |
|---|---|---|
| Alyaa Adel | Article & Category Management | CRUD + validation, categories, ownership/drafts, versions/compare/restore, Jaccard duplicates, Stack Exchange references, S3 version backup, transactional SQS outbox |
| Salma Osama | Editorial Workflow & Publication | Review queue, approve/reject with comments + self-review block, publication with idempotent operations, outdated flags, editorial history, SQS consumer with inbox, SNS publication events |
| Nermeen Mostafa | Search, Feedback & Analytics | Published-only search with category filter/ranking, views, Turnstile-protected votes/feedback, analytics overview (gaps, unhelpful articles, CTR), DynamoDB counters, CloudWatch metrics, S3 CSV export |

## 4. Shared Identity Service

Implemented by Alyaa (`f2eb4dd`, `16d18af`, `4b5147a`). bcryptjs cost 12, password 12–72 bytes,
session regeneration on login (fixation), Postgres-backed sessions, CSRF token (32 random bytes,
timing-safe compare), Origin allow-list, login/register limiter 30/15 min, Turnstile on registration,
audit_logs for register/login/logout, Dockerfile. Tests: **11/11 pass** (re-run 2026-11-24).
Gaps: failed logins are **not** written to the audit log; self-registration creates `author`
(proposal said `reader`; Neon role constraint allows only author/editor/admin).

## 5–7. Functionality status

| Function | Status | Notes |
|---|---|---|
| Article CRUD, validation, ownership, draft-only edit/delete | Completed and tested | unit tests + earlier live evidence |
| Categories (public list, author/admin manage) | Completed and tested | |
| Versions, compare, restore | Completed and tested | `version.test.js` |
| Duplicate detection (Jaccard, accessible articles only) | Completed and tested | |
| Stack Exchange related questions | Implemented but not fully tested | backend + editor.html UI (correction after re-inspection: the UI exists in `editor.html`/`editorial.js`); live API not reachable from the sandbox |
| S3 version backup/retrieve | Completed and tested | screenshots in `evidence/aws-verification` |
| Transactional outbox → SQS | Completed and tested | Docker worker publishes to **`-demo` queue**, Editorial example uses main queue (mismatch) |
| Editorial queue/decide/publish/history/flags | Completed and tested (unit, 155 tests) | flags list/resolve and history have **no frontend UI** |
| Editorial SQS consumer + inbox | Completed and tested | `editorial-idempotency-postgres.txt` |
| Editorial SNS publisher + Lambda | Implemented but not fully tested | Lambda never deployed in evidence |
| Search/views/votes/analytics | Completed and tested | extensive evidence in service folder |
| Frontend pages | Partially implemented | `articles.html` contains a second concatenated HTML document; `_headers` empty (no CSP) |
| Local dev proxy | Broken for others | `dev-server.js` hard-codes Tailscale IPs `100.69.198.126`, `100.69.7.28` |
| Cloudflare proxy routes | Partially implemented | `/articles/:id/history`, `/flags/:id`, `/editorial/flags` route incorrectly or not at all |

## 8. Security gaps

1. No per-endpoint production limits for writes (only a global 300/15 min); no documented test profile beyond `RATE_LIMIT_MAX`.
2. Failed logins and 401/403/429 denials not recorded as security events.
3. Frontend has no security headers (`_headers` is empty).
4. Search `RATE_LIMIT_MAX` parsed with raw `Number()` (invalid value → limiter misconfigured).
5. Self-registration grants `author` (documented as residual risk).

## 9–12. Cloud / AWS / IAM / Secrets / Floci

| Component | AWS services genuinely used | IAM identity | Secrets Manager |
|---|---|---|---|
| Article (Alyaa) | S3, SQS, Secrets Manager (+IAM) | `supporthub-article-service` user, 3 scoped policies — **Completed and tested** | feature-flag secret only |
| Editorial (Salma) | SQS (consume), SNS (publish), Lambda (code) | **Not implemented** (only a Lambda trust/logging policy, logging policy uses `*` account-wide) | **Not implemented** |
| Search (Nermeen) | DynamoDB, CloudWatch, S3 (+IAM) | `search-analytics-service` user — **Completed and tested** (`evidence/iam.txt`) | **Not implemented** |
| Identity (shared) | none | none | none |

- **Shared Secrets Manager:** Not implemented — session/HMAC/cron/Turnstile secrets come only from `.env`.
- **Floci:** Article compose works (evidence); Editorial compose depends on an external network `floci_default`; Search uses an AWS profile. There is **no single stack** that runs all services against one Floci.
- **Automation:** PowerShell (Article) + Bash (Search) scripts only; no all-component Bash script.
- **Probe on 2026-11-24:** Floci 2.5.0 starts in 0.09 s, `FLOCI_SERVICES_IAM_ENFORCEMENT_ENABLED=true` really denies requests outside a user's policy (verified with a throwaway user), Lambda Node 22 executes when the runtime image is available locally.

## 13–15. Frontend, API communication, load testing

- Frontend uses real APIs everywhere (no mock data found). Design is basic.
- Previous `editor.html` "You do not have permission" alert: produced by `requireRole(["author","admin"])` after `/api/auth/me` returned 401. Root cause was Identity rejecting the login POST from Origin `http://localhost:8080` (fixed by allow-listing). The alert is correct behaviour for editors (editors are redirected to `review.html`).
- Load test (`evidence/integration/load/`): 1,000 requests, 0 failures, separated public/author/editor — but **read-only** (no draft creation, edits, duplicates, submissions, approvals, rejections or publication) and with AWS disabled. Instructor's "which requests are Author vs Editor" needs write workflows too.

## 16. Monitoring and logging

audit_logs (Identity + Article), Editorial status events table, Search CloudWatch request metrics (count/latency/errors) and `evidence/cloudwatch.txt`. No structured security-event log for denials.

## 17. Evidence folder

`evidence/aws-verification` (8 screenshots: S3, IAM deny, SQS, Secrets), `evidence/final-demo` (Alyaa demo pack, test outputs), `evidence/integration` (outbox retry, idempotency, Floci recovery, load tests), `evidence/security` (Article + Identity tests), `evidence/alyaa-final` (k6 baseline), `services/search-analytics-service/evidence` (17 files), `services/editorial-service/docs` (security tests, threat model). All preserved.

## 18. Test baseline (executed 2026-11-24, Node 22)

| Suite | Result |
|---|---|
| article-service | 50/50 pass (5 files fail without any `DATABASE_URL`; pass with a dummy non-connecting URL — tests mock the DB) |
| editorial-service | 155/155 pass (same note) |
| search-analytics-service | 79/79 pass (same note) |
| identity-service | 11/11 pass |

## 19. Prioritised implementation plan

1. **Editorial + Search IAM and Secrets Manager; shared Secrets Manager for all services** (instructor requirement, largest gap).
2. Single Docker Compose stack (Floci + Postgres + 4 services + 3 workers), env-driven URLs, unify SQS queue, remove hard-coded Tailscale IPs.
3. `infra/floci/setup-supporthub.sh`: idempotent Floci/IAM/secrets/queues/buckets/topic/Lambda + health checks + permission tests.
4. End-to-end lifecycle verification through SQS/SNS/Lambda with saved evidence; IAM allow/deny evidence per component.
5. Per-endpoint production rate limits + explicit load-test profile; verify production limits still trigger.
6. k6 workflow load test (~1,000 requests) with Author / Editor / Reader write+read traffic.
7. Security-event logging (failed logins, 401/403/429).
8. Frontend: polish the existing design (no redesign); fix `articles.html`; add flags and history UIs; security headers.
9. Final report (35 sections), contribution statements, demo plan, compliance matrix; commit and push.
