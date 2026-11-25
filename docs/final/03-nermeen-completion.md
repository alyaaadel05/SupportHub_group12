# Nermeen: Search and Analytics Service

Verified 2026-11-25 on Windows / Docker Desktop, in the isolated stack (`supporthub-iso-*`:
own Floci 2.5.0 and own PostgreSQL) unless a line says otherwise. Neon, Vercel and Cloudflare were
not changed. Statuses: PASS (run and verified), IMPLEMENTED / NOT VERIFIED, FAIL, BLOCKED, OPTIONAL.

| Requirement | Status | Evidence |
|---|---|---|
| Published-only search, ranking, filter, pagination | PASS | `evidence/final/nermeen/resilience-security-20261125T193131Z.txt`, 99 unit tests |
| Drafts hidden from search and direct URL | PASS | `evidence/final/nermeen/resilience-security-20261125T193131Z.txt` |
| Votes: 10 concurrent, one row; changeable; Turnstile and CSRF enforced | PASS | `evidence/final/nermeen/resilience-security-20261125T193131Z.txt` |
| Feedback with local sentiment (3 labels stored and shown in analytics) | PASS | `evidence/final/nermeen/resilience-security-20261125T193131Z.txt`, `evidence/final/nermeen/sentiment-local-20261125.txt` |
| Analytics totals equal the database; 401/403 enforced | PASS | `evidence/final/nermeen/resilience-security-20261125T193131Z.txt` |
| DynamoDB counters, CloudWatch metrics, S3 exports | PASS | `evidence/final/aws/aws-usage-20261125T193434Z.txt` |
| Floci outage: search and analytics work, export fails safely | PASS | `evidence/final/nermeen/resilience-security-20261125T193131Z.txt` |
| PostgreSQL outage and recovery | PASS | `evidence/final/nermeen/resilience-security-20261125T193131Z.txt` |
| IAM least privilege | PASS with one emulator limit | `evidence/final/iam/iam-permission-tests-20261125T190729Z.txt`, `evidence/final/nermeen/team-floci-search-iam-*.txt` |
| CloudWatch namespace restriction | IMPLEMENTED / NOT VERIFIED | Policy condition added; Floci cannot enforce it |
| Rate limit: 429 after 120 searches | PASS | `evidence/final/rate-limits/production-limits-20261125T193434Z.txt` |
| Production voting with a real Turnstile widget | BLOCKED | Needs a person in a browser |

## Notes
- `/api/health` returns 500 (not 503) when PostgreSQL is down. This is the documented behaviour.
- The S3 export returns a generic 500 during an AWS outage.
- Sentiment is word-based; its confidence value is a heuristic, not a probability.
- The historical Hugging Face HTTP 402 evidence and the ignored backup file are untouched.
  `HF_TOKEN` is still an accepted but unused secret key, and `04-deployment-verification.md` still
  lists it as optional.
