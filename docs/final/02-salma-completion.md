# Salma: Editorial Service

Verified 2026-11-25 on Windows / Docker Desktop, in the isolated stack (`supporthub-iso-*`:
own Floci 2.5.0 and own PostgreSQL) unless a line says otherwise. Neon, Vercel and Cloudflare were
not changed. Statuses: PASS (run and verified), IMPLEMENTED / NOT VERIFIED, FAIL, BLOCKED, OPTIONAL.

| Requirement | Status | Evidence |
|---|---|---|
| Review queue, approve, reject with comment, history, flags | PASS | `evidence/final/e2e/lifecycle-20261125T185609Z.txt`, `evidence/final/salma/` |
| Two editors decide at once: one 201, one 409 | PASS | `evidence/final/salma/resilience-security-20261125T193131Z.txt` |
| Five concurrent publishes: one publication event | PASS | `evidence/final/salma/resilience-security-20261125T193131Z.txt` |
| Invalid transitions 409, author 403, no CSRF 403, bad input 400 | PASS | `evidence/final/salma/resilience-security-20261125T193131Z.txt` |
| SQS consumer idempotent (same event 3 more times: 1 review) | PASS | `evidence/final/salma/resilience-security-20261125T193131Z.txt` |
| Malformed event goes to the dead-letter queue, worker keeps running | PASS | `evidence/final/salma/resilience-security-20261125T193131Z.txt` |
| Consumer stopped and restarted: event processed | PASS | `evidence/final/salma/resilience-security-20261125T193131Z.txt` |
| Article Service down: safe 5xx, retry gives one approval | PASS | `evidence/final/salma/resilience-security-20261125T193131Z.txt` |
| Search Service down during publication | PASS with manual recovery | `evidence/final/salma/resilience-security-20261125T193131Z.txt` |
| SNS events and Lambda receipts: 105 / 105 | PASS | `evidence/final/aws/aws-usage-20261125T193434Z.txt` |
| IAM least privilege, Secrets Manager | PASS | `evidence/final/iam/iam-permission-tests-20261125T190729Z.txt`, `evidence/final/aws/aws-usage-20261125T193434Z.txt` |
| Docker, 175 unit tests | PASS | `evidence/final/integration/unit-tests-*.txt` |
| Production editor workflow | BLOCKED | Needs real accounts |

## Known limitation to explain in the discussion
If Search is unreachable during publication, the outbox row becomes `needs_reconciliation` and is
**not** retried automatically. This is deliberate in `notificationService.js` and covered by unit
tests. Until someone runs Search's `scripts/sync-published.js`, the article is missing from search.

## Note
The 3 Editorial unit failures seen at the start came from an outdated local `node_modules` (a locked
dependency was not installed). `npm ci` fixed them; no code changed.
