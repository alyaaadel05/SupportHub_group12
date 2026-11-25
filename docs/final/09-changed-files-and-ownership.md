# Changed files and ownership

Verified 2026-11-25 on Windows / Docker Desktop, in the isolated stack (`supporthub-iso-*`:
own Floci 2.5.0 and own PostgreSQL) unless a line says otherwise. Neon, Vercel and Cloudflare were
not changed. Statuses: PASS (run and verified), IMPLEMENTED / NOT VERIFIED, FAIL, BLOCKED, OPTIONAL.

Nothing is committed. Two groups are mixed in the working tree.

## Present before this session (the team's own uncommitted work)
- Editorial: `middleware/security.js`, `server.js`, `tests/origin-allowlist.test.js`
- Search: `middleware/security.js`, `server.js`, `services/sentimentService.js`,
  `scripts/test-sentiment-live.js`, `package*.json`, seven `.md` files, `tests/origin-allowlist.test.js`
- Identity: `package*.json`, `services/securityAlerts.js` (first version), `infra/iam/identity-sns-policy.json`
- `tests/load/stack/*`, `tests/load/k6/results/`, `tests/integration/editorial-decision-check.mjs`
- `evidence/final/iam/alyaa-iam-verification-20261125.txt`

## Changed or created in this session (AI-assisted)
| File | Owner | Change |
|---|---|---|
| `services/identity-service/services/securityAlerts.js` | Alyaa | Added throttle, event mapping, middleware |
| `services/identity-service/server.js` | Alyaa | Connected the alert middleware (off by default) |
| `services/identity-service/tests/security-alerts.test.js` | Alyaa | New, 7 tests |
| `services/search-analytics-service/infra/iam/search-analytics-policy.json` | Nermeen | Namespace condition |
| `infra/floci/docker-compose.supporthub.yml`, `setup-supporthub.sh` | Group | Isolated mode, Identity SNS topic and policy |
| `infra/floci/verify-iam.sh`, `verify-aws-usage.sh` | Group | Isolated mode, 9 more IAM checks (1 is LIMIT) |
| `infra/floci/isolated-env.sh` | Group | New |
| `tests/integration/resilience-check.mjs` | Group | New, 60 checks |
| `tests/integration/frontend-smoke.cjs` | Group | Optional output folder and browser channel |
| The ten new `docs/final` files in this set | Group | New |
| `evidence/final/{alyaa,salma,nermeen,integration}/` and other 2026-11-25 result files | As named | New |

Local only: `npm ci` in Editorial (lock file unchanged).
