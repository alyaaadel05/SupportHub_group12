# SupportHub — Final Compliance Matrix and Evidence Checklist (2026-11-24)

**Where verified:** "Cloud sandbox" = the integrated Floci stack run in the Claude Code cloud
session (Floci 2.5.0, local TLS Postgres instead of Neon). "Local Windows" and "Production"
checks must be run by the team (`03-local-windows-runbook.md`, `04-deployment-verification.md`).

| Requirement | Status | Actual implementation | Evidence |
|---|---|---|---|
| Browser-based frontend | PASS | 7 pages, HTML/CSS/JS, existing design polished | `frontend/smoke-20261124T022739Z.txt` (20/20), screenshots |
| Real backend integration (no mock data) | PASS | all pages call the 4 APIs through `/api` | smoke + `e2e/lifecycle-20261124T021310Z.txt` |
| Article Management Service (Alyaa) | PASS | CRUD, categories, versions, duplicates, references, S3, outbox | e2e §2, 64 unit tests |
| Editorial Service (Salma) | PASS | queue, decisions, publication, flags, history, SQS/SNS/Lambda | e2e §3,5,7, 169 unit tests |
| Search and Analytics Service (Nermeen) | PASS | search, views, votes, analytics, DynamoDB/CloudWatch/S3 | e2e §5–6, 93 unit tests |
| Shared Identity (Alyaa) | PASS | sessions shared by all services, CSRF, brute-force limit | e2e §2, 25 unit tests, ST-15 |
| Three meaningful functions per component | PASS | business rules + inter-service communication | `02-…` §8 |
| REST methods and status codes | PASS | GET/POST/PATCH/DELETE, 200/201/204/400/401/403/404/409/429/502/503 | `02-…` §9–10, e2e |
| Persistent database | PASS (sandbox Postgres) / NOT VERIFIED (Neon from sandbox) | PostgreSQL, migrations | e2e, `aws-usage` DB counts |
| Backend role enforcement | PASS | 401/403 in every service | ST-01–03, 143 k6 denials |
| Article ownership checks | PASS | per-record `author_id` check | ST-04, ST-05 |
| External API integration | PASS (fail-closed paths) / NOT VERIFIED (live success) | Turnstile (Identity, Search), Stack Exchange (Article) | ST-14, smoke (502 message); hosts blocked in sandbox |
| CSRF and Origin protection | PASS | token + Origin allow-list on all writes | ST-06, ST-07 |
| Secure sessions | PASS | HttpOnly, SameSite=Lax, regenerate, Postgres store | ST-21 |
| XSS and SQL injection protection | PASS | textContent + CSP; parameterised SQL | ST-08–ST-10, ST-22 |
| Alyaa's individual IAM | PASS | `supporthub-article-service` (S3, SQS, secrets) + `supporthub-identity-service` | `iam/iam-permission-tests-20261124T020750Z.txt` |
| Salma's individual IAM | PASS | `supporthub-editorial-service` (SQS consume, SNS, secrets) + Lambda role | same file |
| Nermeen's individual IAM | PASS | `search-analytics-service` (DynamoDB, CloudWatch, S3, secrets) | same file |
| Three AWS services for Alyaa | PASS | S3, SQS, Secrets Manager | `aws/aws-usage-20261124T021842Z.txt` |
| Three AWS services for Salma | PASS | SQS, SNS, Lambda (+ Secrets Manager) | same |
| Three AWS services for Nermeen | PASS | DynamoDB, CloudWatch, S3 (+ Secrets Manager) | same |
| Shared Secrets Manager | PASS | 7 secrets, per-ARN IAM, loader in all 4 services, fail-closed | `aws-usage`, `aws/secrets-runtime-denial.txt` |
| Floci deployment | PASS (sandbox) / NOT VERIFIED (team's Windows Floci) | `docker-compose.supporthub.yml` | `setup/setup-supporthub-cloud-sandbox-run.txt` |
| Bash infrastructure automation | PASS (sandbox) / NOT VERIFIED (Git Bash on Windows) | `setup-supporthub.sh`, `verify-iam.sh`, `verify-aws-usage.sh` | setup log 35/35 |
| Docker integration | PASS | 11 containers, health checks, non-root | setup log |
| Synchronous service communication | PASS | HMAC REST Editorial→Article/Search, Search→Article | e2e §5, ST-17 |
| Asynchronous SQS communication | PASS | outbox → SQS → inbox; SNS → Lambda | e2e §3, `aws-usage` (116/116, 47/47) |
| Production rate limiting | PASS | per-endpoint limits, default profile | `rate-limits/production-limits-20261124T021235Z.txt` |
| Dedicated testing rate limiting | PASS | `RATE_LIMIT_PROFILE=loadtest`, refused in production | unit tests, k6 run |
| ~1,000-request load test | PASS | 1,001 requests, 0 failures | `load/workflow-20261124T021755Z-summary.md` |
| Author traffic breakdown | PASS | 440 requests, p95 32.7 ms | same |
| Editor traffic breakdown | PASS | 300 requests incl. 60 decisions, p95 77.5 ms | same |
| Reader traffic breakdown | PASS | 250 requests, p95 28.8 ms | same |
| Threat model (≥6) | PASS | 12 application-specific threats | `02-…` §24 |
| Security tests (≥8) | PASS (21/22) | 22 executed; 1 FAIL = historical secret in Git history | `05-security-tests.md` |
| Logging and monitoring | PASS | JSON security events, audit_logs, CloudWatch | `aws-usage`, k6 run logs |
| Traffic evidence | PASS | per-role/per-endpoint k6 tables, security events | k6 summary JSON/MD |
| Frontend improvements | PASS | polish of existing design, flags/history panels, CSP | before/after screenshots |
| Technical evidence pack | PASS | `docs/final/02-technical-evidence-pack.md` | — |
| Alyaa contribution statement | PASS (draft for student review) | `06-contribution-statements.md` | Git history |
| Salma contribution statement | PASS (draft for student review) | same | Git history |
| Nermeen contribution statement | PASS (draft for student review) | same | Git history |
| Five-minute demo plan | PASS | `07-demo-plan.md` | rehearsed via e2e |
| Final deployment verification (Vercel/Pages/Neon) | NOT VERIFIED | hosts blocked from the sandbox | `04-deployment-verification.md` §4 |
| Cloudflare Pages Preview for this branch | NOT VERIFIED | needs dashboard access | `04-…` §1 |
| GitHub push | see final commit report | `integration/group12-final` | — |

## Evidence checklist

| # | Evidence | Status |
|---|---|---|
| 1 | Unit tests 351/351 (`unit-tests/all-services-20261124T022739Z.txt`) | PASS |
| 2 | Browser smoke 20/20, 0 CSP violations (`frontend/smoke-20261124T022739Z.txt`) | PASS |
| 3 | End-to-end lifecycle 47/47 (`e2e/lifecycle-20261124T021310Z.txt`) | PASS |
| 4 | IAM allow/deny 39/39 (`iam/…`) | PASS |
| 5 | AWS usage per component (`aws/aws-usage-…`) | PASS |
| 6 | Secrets Manager cross-component denial (`aws/secrets-runtime-denial.txt`) | PASS |
| 7 | Production rate limits 4/4 (`rate-limits/…`) | PASS |
| 8 | k6 1,001 requests, role breakdown (`load/…`) | PASS |
| 9 | Setup automation 35/35 (`setup/…`) | PASS |
| 10 | Extra security checks: HMAC, XSS, SQLi, headers, secret scan (`security/…`) | PASS except historical secret (FAIL, mitigated) |
| 11 | Successful registration with a valid Turnstile token | NOT VERIFIED (Cloudflare blocked in sandbox) |
| 12 | Stack Exchange live results | NOT VERIFIED (host blocked in sandbox) |
| 13 | Team's Windows Docker Desktop + existing Floci/Editorial/Postgres | NOT VERIFIED (not reachable from the cloud) |
| 14 | Vercel backends, Cloudflare Pages, Neon in production | NOT VERIFIED |

## Manual actions required from the team

1. **Rotate the Neon password** for endpoint `ep-steep-mouse-b9cb7jvq` (user `neondb_owner`) — it is in Git history (commit `d0a2a2b`).
2. Run `bash infra/floci/setup-supporthub.sh` on Windows (Git Bash) and keep the output.
3. Run the deployment checks in `04-deployment-verification.md` §4 on the Cloudflare **Preview** URL with test accounts.
4. Review and sign the contribution statements; add the university AI-use disclosure.
5. Record the 5-minute demo video (`07-demo-plan.md`).
