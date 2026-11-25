# Integration and load results

Verified 2026-11-25 on Windows / Docker Desktop, in the isolated stack (`supporthub-iso-*`:
own Floci 2.5.0 and own PostgreSQL) unless a line says otherwise. Neon, Vercel and Cloudflare were
not changed. Statuses: PASS (run and verified), IMPLEMENTED / NOT VERIFIED, FAIL, BLOCKED, OPTIONAL.

## End-to-end workflow: 47/47 PASS
`evidence/final/e2e/lifecycle-20261125T185609Z.txt`: register, login, create, submit, SQS to Editorial, approve or reject, publish, search index,
search, vote, analytics. Written feedback and its analytics: `evidence/final/nermeen/resilience-security-20261125T193131Z.txt`. Approve/reject with database
checks: 6/6 in `evidence/final/salma/`. Browser: 20/20 in `evidence/final/integration/screenshots/smoke-20261125T190715Z.txt`, with 8 screenshots.

## Setup on Windows
35 pass, 1 fail in `setup-isolated-windows-20261125T184928Z.txt`. The failure is the CloudWatch finding
in doc 05. The IAM tests were rerun after the change; the whole setup was not.

## Load test, 1,001 requests (k6, 14 users)
| | Run 1 (19:32, Turnstile on) | Run 2 (19:33, Turnstile off for votes) |
|---|---|---|
| Author / Editor / Reader / setup | 440 / 300 / 250 / 11 | 440 / 300 / 250 / 11 |
| Success / unexpected failures | 995 / 6 | 1,001 / 0 |
| Expected denials (401/403) | 121 | 160 |
| HTTP 5xx | 0 | 0 |
| Average / median | 20.9 / 11.2 ms | 56.4 / 32.1 ms |
| p95 / max | 64.1 / 347 ms | 192.7 / 1,548 ms |
| Throughput | 37.9 req/s | 28.2 req/s |
| p95 author / editor / reader | 39.0 / 105.9 / 25.6 ms | 143.9 / 251.4 / 38.6 ms |

Files: `evidence/final/integration/load/`. "Reader" is the public/anonymous traffic plus votes by a logged-in reader.
Run 1's six reader failures match its six vote requests: the script sends no Turnstile token and
Turnstile was enforced. Run 2 turned Turnstile off for votes, on the isolated stack only, so that
Cloudflare was not load-tested. Both runs use `RATE_LIMIT_PROFILE=loadtest`. These are single-host
measurements on a machine running other containers, with different database sizes, so they are not a benchmark.
Earlier load-test results are unchanged.

## Production rate limits: 4/4 PASS
`evidence/final/rate-limits/production-limits-20261125T193434Z.txt`: duplicates 30, public search 120, login 30 per 15 minutes, then 429.

## Failure and recovery: 60/60 in the final run
`node tests/integration/resilience-check.mjs`. Evidence: the newest `resilience-security-*` file in
`evidence/final/` `alyaa`, `salma`, `nermeen` and `integration`. Earlier runs are kept. Their failures
were errors in the new script (Search health is documented as 500; `pageSize`; `fullName`; a
socket race) and one wrong assumption about automatic retry (doc 02). That last expectation was
changed to the real, documented design. No application code was changed to make these checks pass.

## Unit tests: 370/370
Identity 32, Article 64, Editorial 175, Search 99.
