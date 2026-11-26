# 5. Individual Contribution Statement: Alyaa Adel (241261)

> Draft. Alyaa must read, correct and sign it.
>
> Before submission:
> - Salma and Nermeen should confirm §5.4. It lists fixes made inside their components.
> - Make §5.5 consistent with the "AI-use disclosure" section of
>   `docs/final/06-contribution-statements.md`. That section says the AI-assisted integration work
>   is not claimed as any student's independent work.

## 5.1 Article & Category Management Service (owner)

I implemented `services/article-service`. I authored 20 of the 21 commits on that folder
(`docs/final/06-contribution-statements.md`).

**Features:**
- Article CRUD with validation, and draft-only edit and delete.
- Category management (categories in use are protected).
- Ownership checks.
- Version history, comparison and restore.
- Jaccard duplicate detection.
- Stack Exchange related questions.
- S3 version backups.
- A transactional PostgreSQL outbox with an SQS publisher, scheduler and retry.
- HMAC-protected internal endpoints with `operationId` idempotency.

**Evidence:**
- 64/64 unit tests (`evidence/final/integration/unit-tests-20261125T193654Z.txt`).
- 18/18 resilience and security checks (`evidence/final/alyaa/resilience-security-20261125T193131Z.txt`).
- Article IAM 14/14 (`docs/final/05-aws-iam-verification.md`).

## 5.2 Shared Identity Service (designer and implementer)

I implemented `services/identity-service`, which all services use:
- Registration with server-side Turnstile verification. Self-registration cannot choose a role.
- bcrypt (cost 12) and PostgreSQL-backed sessions shared by all services.
- CSRF tokens and the Origin allow-list.
- Login rate limiting (30 per 15 min).
- Audit logging, Docker integration and the SNS security-alert client.

**Evidence:**
- 32/32 unit tests (same unit-test file).
- Brute-force limit 429 (`evidence/final/rate-limits/production-limits-20261125T193434Z.txt`).
- Identity IAM 8/8 (`docs/final/05-aws-iam-verification.md`).

## 5.3 Shared infrastructure, integration and operations

- **Integration:** merged the three feature branches into `integration/group12-final`. Built the
  same-origin proxy and the frontend integration (`docs/final/06-contribution-statements.md`).
- **Floci stack:** the integrated Floci stack and `infra/floci/setup-supporthub.sh`.
  Per-component IAM users and policies (`infra/iam/`). The shared Secrets Manager loader in all four
  services. Rate-limit profiles and security-event logging. IAM result: 47 pass, 0 fail, 1 emulator
  limit (`evidence/final/iam/iam-permission-tests-20261125T190729Z.txt`).
- **Tests:** the end-to-end, browser, resilience, rate-limit and k6 workflow tests. Results:
  e2e 47/47, browser 20/20, resilience 60/60, k6 1,001 requests (see the testing section).
- **Production integration:** workers on the production database, with a separate production queue
  and DLQ and least-privilege worker IAM users (`evidence/production-integration/production-integration-results.txt`).
- **Credential rotation:** rotated the database credential and moved every service to a restricted
  role. Checks 32/32 and 4/4 (`evidence/production-security/database-credential-rotation.txt`).
- **Startup automation:** `infra/floci/start-production-workers.sh` and `infra/floci/floci-queues.sh`,
  including the duplicate-prevention and recovery tests (`evidence/security-automation/`).
- **ECS and gateway:**
  - The ECS deployment of the three workers (`infra/floci/ecs/`).
  - The master startup script `infra/floci/start-supporthub.sh`.
  - Recreating the main Floci with loopback-only binding (Step 1).
  - The Cloudflare gateway Worker code (`infra/cloudflare/floci-gateway/`).
  - The architecture diagram (`docs/architecture/`).
  - Evidence: `evidence/cloud-architecture/`.

## 5.4 Additional reliability work in the Editorial and Search components

Salma (Editorial) and Nermeen (Search) own the design of these components. I found and fixed these
defects during integration testing.

| Component | Defect | Fix | Evidence |
|---|---|---|---|
| Editorial | D1: duplicate outdated reports created parallel re-reviews | Migration 008 (partial unique index) and `ON CONFLICT DO NOTHING` | `evidence/editorial-aws/01-outdated-article-rereview.txt` (65/65) |
| Editorial | D2: an author could resolve the re-review of their own article | Author check through the Article Service, fails closed | same |
| Editorial | D3: failed SNS events were never retried | `requeueFailed()` and `POST /internal/retry-publication-events` | `evidence/editorial-aws/03-sns-publication-notifications.txt` |
| Search | S2: CSV export hung when S3 was unreachable | S3 timeouts (3 s and 8 s) and a 503 response | `evidence/final-security-search/02-s3-csv-export-security.txt` |
| Search | D-S1, D-S2: sentiment stuck as pending, or reported before it was stored | `reprocessSentiment()` and an honest `pending` response | `evidence/final-security-search/03-feedback-sentiment-verification.txt` |
| Search, Article, Identity | Vercel could not reach Floci | Opt-in gateway headers (`config/flociAccess.js`) | `evidence/cloud-architecture/03-vercel-floci-connectivity.txt` |

## 5.5 AI-assisted development (disclosure)

I developed much of the work in §5.3 and §5.4, from 2026-11-24 onward, with Claude Code, an AI
coding assistant, working under my direction. Each evidence file from those sessions records this.

I chose the tasks, approved every production-affecting step, reviewed the changes and committed
them. Two early commits on other branches (`3f5ac7f`, `c6da34e`) carry the assistant's own Git
identity.

All results quoted come from executed runs saved in `evidence/`. I will follow the module's AI-use
rules (brief section 11) when submitting.

Signed: ____________________  Date: __________
