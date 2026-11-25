# Requirements compliance matrix

Verified 2026-11-25 on Windows / Docker Desktop, in the isolated stack (`supporthub-iso-*`:
own Floci 2.5.0 and own PostgreSQL) unless a line says otherwise. Neon, Vercel and Cloudflare were
not changed. Statuses: PASS (run and verified), IMPLEMENTED / NOT VERIFIED, FAIL, BLOCKED, OPTIONAL.

Source: `CloudComputing_CloudSecurity_CW.pdf` (26CSCN29H), sections 2 to 11. The brief requires **no**
specific cloud vendor. It does not mention IAM users, three AWS services per student, a 1,000-request
test or a video. Those come from the team's checklists and request, so they are marked "not in the brief".

| Requirement | Status | Evidence |
|---|---|---|
| S2 Browser frontend using real APIs | PASS | `evidence/final/integration/screenshots/smoke-20261125T190715Z.txt` 20/20 |
| S2 Three components with 3+ functions | PASS | docs 01 to 03 |
| S2 HTTP/REST API and status codes | PASS | `evidence/final/e2e/lifecycle-20261125T185609Z.txt` |
| S2 Persistent data store | PASS (local); production answered read-only requests | `evidence/final/nermeen/resilience-security-20261125T193131Z.txt`, production probe |
| S2 Two or more roles, backend enforced | PASS | `evidence/final/e2e/lifecycle-20261125T185609Z.txt` section 4 |
| S2 External API (Stack Exchange, Turnstile) | PASS | `evidence/final/integration/screenshots/smoke-20261125T190715Z.txt`, `evidence/final/e2e/lifecycle-20261125T185609Z.txt` |
| S2/S4 Deployed cloud version | IMPLEMENTED / NOT VERIFIED | Site is live; the authenticated workflow there was not tested |
| S3 Logs and monitoring | PASS | `evidence/final/aws/aws-usage-20261125T193434Z.txt`, security events, SNS alerts |
| S3 Secrets outside source code | FAIL (Git history) | Old Neon password is in history; pattern search of the current tree is clean |
| S4 Testing of the integrated deployed application | BLOCKED | Local integration PASS; production needs real accounts |
| S5 Authentication, authorisation, ownership, validation | PASS | doc 07 |
| S5 Least privilege | PASS | doc 05 |
| S5 Shared responsibility, recovery, limitations (written) | IMPLEMENTED / NOT VERIFIED | `02-technical-evidence-pack.md`; students check the wording |
| S9.2 Threat model, 6+ threats | PASS | `02-technical-evidence-pack.md`, `docs/threat-model.md` |
| S9.2 Eight or more security tests | PASS | doc 07 |
| S7.2 Responsibility matrix, demo plan, contribution statements | PASS (drafts) | `06-contribution-statements.md`, `07-demo-plan.md` |
| S9.3 Repository evidence per student | IMPLEMENTED / NOT VERIFIED | Git history by author; students review |
| S10 Live demonstration and discussion | BLOCKED | Students only |
| S11 AI-use rules | BLOCKED | Students must check the module rules and disclose AI assistance |
| Per-student AWS services and IAM (not in the brief) | PASS | doc 05 |
| About 1,000 requests by role (not in the brief) | PASS | doc 06 |
| Five-minute video (not in the brief) | BLOCKED | Students record it |
