# Security test results

Verified 2026-11-25 on Windows / Docker Desktop, in the isolated stack (`supporthub-iso-*`:
own Floci 2.5.0 and own PostgreSQL) unless a line says otherwise. Neon, Vercel and Cloudflare were
not changed. Statuses: PASS (run and verified), IMPLEMENTED / NOT VERIFIED, FAIL, BLOCKED, OPTIONAL.

| Requirement | Status | Evidence |
|---|---|---|
| Unauthenticated access rejected with 401 | PASS | `evidence/final/e2e/lifecycle-20261125T185609Z.txt`, `evidence/final/nermeen/resilience-security-20261125T193131Z.txt` |
| Wrong role: 403 | PASS | `evidence/final/e2e/lifecycle-20261125T185609Z.txt`, `evidence/final/salma/resilience-security-20261125T193131Z.txt`, `evidence/final/nermeen/resilience-security-20261125T193131Z.txt` |
| Ownership: other author read, versions, delete 403 | PASS | `evidence/final/e2e/lifecycle-20261125T185609Z.txt`, `evidence/final/alyaa/resilience-security-20261125T193131Z.txt` |
| CSRF missing or wrong: 403 | PASS | `evidence/final/e2e/lifecycle-20261125T185609Z.txt`, `evidence/final/salma/resilience-security-20261125T193131Z.txt`, `evidence/final/nermeen/resilience-security-20261125T193131Z.txt` |
| Foreign Origin: 403 (including look-alike origins) | PASS | `evidence/final/e2e/lifecycle-20261125T185609Z.txt`, `origin-allowlist.test.js` in two services |
| SQL injection | PASS | `evidence/final/e2e/lifecycle-20261125T185609Z.txt`, `evidence/final/nermeen/resilience-security-20261125T193131Z.txt` |
| Invalid input: 400 | PASS | `evidence/final/e2e/lifecycle-20261125T185609Z.txt`, `evidence/final/salma/resilience-security-20261125T193131Z.txt`, `evidence/final/nermeen/resilience-security-20261125T193131Z.txt` |
| Self-assigned admin role | PASS | `evidence/final/alyaa/resilience-security-20261125T193131Z.txt` |
| Session reuse after logout, four services | PASS | `evidence/final/alyaa/resilience-security-20261125T193131Z.txt` |
| Forged, expired or unsigned internal calls: 401 | PASS | `evidence/final/alyaa/resilience-security-20261125T193131Z.txt`, `evidence/final/nermeen/resilience-security-20261125T193131Z.txt` |
| Brute force: 429 | PASS | `evidence/final/rate-limits/production-limits-20261125T193434Z.txt` |
| Invalid state transitions: 409 | PASS | `evidence/final/e2e/lifecycle-20261125T185609Z.txt`, `evidence/final/salma/resilience-security-20261125T193131Z.txt` |
| Cross-component AWS access denied | PASS | `evidence/final/iam/iam-permission-tests-20261125T190729Z.txt` |
| CSP: no violations in a real browser | PASS | `evidence/final/integration/screenshots/smoke-20261125T190715Z.txt` |
| npm audit, production dependencies: 0 vulnerabilities | PASS | run 2026-11-25 in all four services |
| Secrets in the current tree (pattern search) | PASS | 0 matches for key, token, Neon URL and private-key patterns |
| Secrets in Git history | FAIL | Neon password in commit d0a2a2b, recorded 2026-11-24 |
| Gitleaks re-scan | NOT RUN | Denied by the tool permission system this session |
| CSP header on the production site | FAIL | Not sent by the deployed version |

Stored XSS was tested on 2026-11-24 (`evidence/final/security/`) and not repeated.
