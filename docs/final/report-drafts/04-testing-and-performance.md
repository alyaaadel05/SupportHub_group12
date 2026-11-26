# 4. Testing and Performance

> Draft for the group report. "Isolated stack" means the `supporthub-iso-*` containers with their
> own Floci and PostgreSQL. No production data is involved unless a line says otherwise.

## 4.1 Unit tests

| Service | Tests | Result | Evidence |
|---|---|---|---|
| Identity | 32 | 32/32 | `evidence/final/integration/unit-tests-20261125T193654Z.txt`; re-run 32/32 in `evidence/cloud-architecture/FINAL_SUMMARY.txt` |
| Article | 64 | 64/64 | same |
| Editorial | 183 | 183/183 | `evidence/editorial-aws/FINAL_SUMMARY.txt` (175 + 8 new) |
| Search & Analytics | 110 | 110/110 | `evidence/cloud-architecture/FINAL_SUMMARY.txt` (99 + 8 sentiment and export + 3 gateway headers) |
| **Total** | **389** | **389/389** | The last single combined run was 370/370 (`evidence/final/integration/unit-tests-20261125T193654Z.txt`). |

## 4.2 Integration lifecycles

| Test | Scope | Result | Evidence |
|---|---|---|---|
| End-to-end lifecycle | Register, login, create, submit, SQS to Editorial, approve or reject, publish, index, search, vote, analytics | **47/47** | `evidence/final/e2e/lifecycle-20261125T185609Z.txt` |
| Browser smoke test | 7 pages, real APIs, 0 CSP violations, 8 screenshots | **20/20** | `evidence/final/integration/screenshots/smoke-20261125T190715Z.txt` |
| Editorial decisions | Approve and reject, with database checks | 6/6 | `evidence/final/salma/editorial-decision-check-20261125T193418Z.txt` |
| Re-review of outdated articles | Flag, re-review, resolve | 65/65 | `evidence/editorial-aws/01-outdated-article-rereview.txt` |
| SNS → Lambda receipt | Fresh event, invalid payloads, duplicate deliveries | 10/10, 10/10, 5/5 | `evidence/editorial-aws/04-lambda-execution.txt`, `05-persistent-receipts.txt` |
| Lifecycle with **ECS workers only** | Create → SQS → review → publish → SNS → Lambda receipt | 10/10 and 10/10 | `evidence/cloud-architecture/02-ecs-on-floci.txt` §C–D |
| Lifecycle on a simulated private host | Same lifecycle | 10/10 | `evidence/cloud-architecture/05-remote-deployment-preparation.txt` §E |
| Search AWS functions | IAM, DynamoDB, CSV export to S3 | 94 pass, 1 emulator limit | `evidence/search-aws/FINAL_SUMMARY.txt` |
| **Production** lifecycle (Article 21) | Create, duplicate check, submit, SQS, review queue, approve, publish, search, read, feedback, Turnstile, vote, analytics, outdated flag | All PASS | `evidence/production-integration/production-integration-results.txt` |

## 4.3 Failure and recovery tests

| Test | Result | Evidence |
|---|---|---|
| Resilience suite (4 owners): outages, concurrency, security | **60/60** (Alyaa 18, Salma 15, Nermeen 26, integration 1) | `evidence/final/{alyaa,salma,nermeen,integration}/resilience-security-20261125T193131Z.txt` |
| Floci down: the Article API keeps serving, the event stays pending, then publishes automatically after recovery | PASS | `evidence/final/alyaa/resilience-security-20261125T193131Z.txt` |
| Real outbox worker with SQS down: failure recorded, event kept, retried | PASS | `evidence/integration/real-outbox-retry.txt`, `evidence/integration/isolated-floci-recovery-v2.txt` |
| 10 concurrent submissions: 1 accepted, 1 event | PASS | `evidence/final/alyaa/resilience-security-20261125T193131Z.txt` |
| Lambda failure → platform retry → receipt | 7/7 | `evidence/editorial-aws/06-editorial-security-and-recovery.txt` |
| Failed SNS event requeued (defect D3, fixed) | Retested PASS | `evidence/editorial-aws/03-sns-publication-notifications.txt` |
| Search export with S3 unreachable: fast 503 instead of a hang | 7/7 | `evidence/final-security-search/02-s3-csv-export-security.txt` |
| Sentiment that could not be stored is reprocessed | 20/20 | `evidence/final-security-search/03-feedback-sentiment-verification.txt` |
| ECS task killed → new task | 1/1 again after about 16 s | `evidence/cloud-architecture/02-ecs-on-floci.txt` §A |
| Floci restart → ECS services restored | PASS (restart took about 4.5 min) | same, §E |
| Startup script: Floci paused, stopped or missing; worker stopped; invalid configuration | 38 PASS + 1 FAIL, fixed and re-run as PASS | `evidence/security-automation/06-startup-recovery-tests.txt` |
| No duplicate containers or IAM keys on repeated startup | 21/21 | `evidence/security-automation/05-idempotency-verification.txt` |

## 4.4 Load tests

All load tests ran on a single host, not on Vercel. They are not a benchmark.

| Test | Traffic type | Requests | Result | Evidence |
|---|---|---|---|---|
| **k6 workflow test** (2026-11-25, 14 VUs) | **Authenticated reads and writes.** Author: create, edit, versions, duplicate check, submit. Editor: review queue, 60 decisions, 45 publications. Reader: search, view, vote. Plus expected-denial probes. | 1,001: Author 440, Editor 300, Reader 250, setup 11 | 0 unexpected failures, 0 5xx, 160 expected 401/403. p95: all 192.7 ms, author 143.9 ms, editor 251.4 ms, reader 38.6 ms. 28.2 req/s. | `evidence/final/integration/load/workflow-20261125T193351Z-summary.md` (+ `.json`) |
| Test A (2026-11-23, 50 VUs) | **Read-only.** Logged-in author and editor GETs plus public GETs. No writes. AWS disabled. | 1,000 | 0 failures, p95 418 ms | `evidence/integration/load/LOAD_TEST_REPORT.md` |
| Test B (2026-11-23, 500 VUs) | **Read-only**, same mix | 60,190 (Search pool 5), 42,614 (pool 15) | 0 failures, 0 5xx. p95 about 2.9 s and 5.7 s. | same |
| Search: 1,000 users, search only (Nermeen) | **Read-only**, public | 12,027 | 0 failed, p95 14.46 s, 71.7 req/s | `services/search-analytics-service/SCALING.md` §5.3 |
| Search: mixed 1,000 users (Nermeen) | Mostly reads. 10 % logged-in author votes, 5 % editor analytics. | 14,178 | 64.29 % failed before the cache fix, **0.00 %** after | `services/search-analytics-service/SCALING.md` §5.4 |
| Health-endpoint load (Alyaa) | **Read-only** `/api/health` | 100 + 100 | 100/100 each | `evidence/final-demo/test-evidence/article-identity-health-load.txt` |
| Concurrent logins (Alyaa) | Authenticated logins | 10 | 10/10 | `evidence/final-demo/test-evidence/identity-real-login-load.txt` |
| k6 baseline (Alyaa, 2026-11-23) | **Read-only** health endpoints | 1,000 | 793 OK, 207 failed, which led to the configurable rate limits | `evidence/alyaa-final/load-tests/alyaa-baseline-diagnosis.txt` |

**Notes:**
- In the earlier authenticated k6 run, Turnstile was enforced and votes sent no token, so 6 vote
  requests failed. The run cited above turned Turnstile off for votes **on the isolated stack only**,
  so that Cloudflare was not load-tested (`docs/final/06-integration-and-load-results.md`).
- Every load test used a dedicated load-test rate-limit profile.
- Production limits were tested separately: **4/4**
  (`evidence/final/rate-limits/production-limits-20261125T193434Z.txt`).
