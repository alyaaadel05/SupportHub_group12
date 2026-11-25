# Alyaa: Article Management and Identity

Verified 2026-11-25 on Windows / Docker Desktop, in the isolated stack (`supporthub-iso-*`:
own Floci 2.5.0 and own PostgreSQL) unless a line says otherwise. Neon, Vercel and Cloudflare were
not changed. Statuses: PASS (run and verified), IMPLEMENTED / NOT VERIFIED, FAIL, BLOCKED, OPTIONAL.

| Requirement | Status | Evidence |
|---|---|---|
| Article CRUD, categories, ownership, role checks | PASS | `evidence/final/e2e/lifecycle-20261125T185609Z.txt`, `evidence/final/alyaa/resilience-security-20261125T193131Z.txt`, 64 unit tests |
| Version history, comparison, restore | PASS | `evidence/final/e2e/lifecycle-20261125T185609Z.txt`, `evidence/final/alyaa/resilience-security-20261125T193131Z.txt` |
| 10 concurrent edits: 11 versions, all numbers distinct | PASS | `evidence/final/alyaa/resilience-security-20261125T193131Z.txt` |
| 10 concurrent submissions: one accepted, one event | PASS | `evidence/final/alyaa/resilience-security-20261125T193131Z.txt` |
| Duplicate detection; Stack Exchange live (5 results) | PASS | `evidence/final/e2e/lifecycle-20261125T185609Z.txt`, `evidence/final/integration/screenshots/smoke-20261125T190715Z.txt` |
| Registration with Turnstile siteverify (Cloudflare test key) | PASS | `evidence/final/e2e/lifecycle-20261125T185609Z.txt` |
| Registration cannot choose a role (asked admin, stored author) | PASS | `evidence/final/alyaa/resilience-security-20261125T193131Z.txt` |
| bcrypt cost 12, CSRF, session invalid on all services after logout | PASS | `evidence/final/alyaa/resilience-security-20261125T193131Z.txt` |
| Brute-force limit: 429 after 30 attempts | PASS | `evidence/final/rate-limits/production-limits-20261125T193434Z.txt` |
| HMAC service signatures (missing, forged, expired rejected) | PASS | `evidence/final/alyaa/resilience-security-20261125T193131Z.txt` |
| S3 backup, SQS outbox, Secrets Manager | PASS | `evidence/final/aws/aws-usage-20261125T193434Z.txt`, `evidence/final/e2e/lifecycle-20261125T185609Z.txt` |
| Floci outage: event stays pending, published after recovery | PASS | `evidence/final/alyaa/resilience-security-20261125T193131Z.txt` |
| IAM least privilege (Article and Identity users) | PASS | `evidence/final/iam/iam-permission-tests-20261125T190729Z.txt` |
| Identity SNS security alerts (completed this session) | PASS (OPTIONAL feature) | 7 unit tests, `evidence/final/alyaa/resilience-security-20261125T193131Z.txt` |
| Docker integration | PASS | `evidence/final/integration/setup-isolated-windows-20261125T184928Z.txt` |
| Optimistic locking with revision numbers | OPTIONAL | Not implemented. Concurrent edits are all kept in history; the last write wins. |
| Production login and CRUD with real accounts | BLOCKED | Needs the student and real accounts |

## Remaining
Rotate the Neon password (doc 08), run the production demo, review the contribution statement.
