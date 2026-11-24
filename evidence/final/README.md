# Final verification evidence (2026-11-24)

New evidence produced on `integration/group12-final` in the cloud sandbox (integrated
Floci stack). All earlier evidence in `evidence/` and in the service folders is unchanged.
No file here contains a secret value (verified by scanning against the generated keys and
secret values before commit).

| Folder | Content | Authoritative file |
|---|---|---|
| `setup/` | One-command setup run (35/35) | `setup-supporthub-cloud-sandbox-run.txt` |
| `iam/` | Per-component IAM allow/deny tests (39/39) | `iam-permission-tests-20261124T020750Z.txt` |
| `aws/` | AWS usage per component; Secrets Manager runtime denial | `aws-usage-20261124T021842Z.txt`, `secrets-runtime-denial.txt` |
| `e2e/` | Lifecycle test runs (earlier runs kept; latest adds registration/failed-login cases) | `lifecycle-20261124T021310Z.txt` (47/47) |
| `rate-limits/` | Production limits produce 429 | `production-limits-20261124T021235Z.txt` |
| `load/` | k6 workflow test, ~1,000 requests, per-role tables | `workflow-20261124T021755Z-summary.md` (+ JSON) |
| `security/` | HMAC, XSS, SQLi, headers, repository secret scan + finding | `extra-security-checks.txt` |
| `frontend/` | Browser smoke runs and screenshots; `before-after/` original vs polished | `smoke-20261124T022739Z.txt` (20/20); earlier smoke files were taken during the (reverted) redesign attempt |
| `unit-tests/` | All four service test suites (351/351) | `all-services-20261124T022739Z.txt` |

Summary and statuses: `docs/final/08-compliance-matrix.md`.
