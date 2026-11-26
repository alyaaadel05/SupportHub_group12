# 3. Security

> Draft for the group report.

## 3.1 Threat model

Source of the threats: `docs/threat-model.md`.

| # | Threat | Mitigation | Evidence that it works |
|---|---|---|---|
| T1 | SQL injection | Parameterised PostgreSQL queries. IDs are validated. | ST-08, ST-09 below |
| T2 | Cross-site scripting | User content is rendered with `textContent`. CSP `script-src 'self'`. Helmet headers. | ST-10; 0 CSP violations in the browser (`evidence/final/integration/screenshots/smoke-20261125T190715Z.txt`) |
| T3 | Broken object-level authorisation (editing another author's article) | Ownership is checked in SQL | ST-04, ST-05 |
| T4 | Broken function-level authorisation (an author calling editorial endpoints) | Server-side role checks in every service | ST-02, ST-03 |
| T5 | CSRF | Session-bound CSRF token and Origin allow-list on every write | ST-06, ST-07 |
| T6 | Credential attacks | bcrypt (cost 12). Login limit 30 per 15 min. Failed logins are audited. | ST-15 |
| T7 | Automated abuse (bots, fake votes) | Cloudflare Turnstile checked server-side. Votes require a login. | ST-13, ST-14 |
| T8 | Sensitive data exposure | Secrets Manager and environment variables. No real `.env` in Git. TLS. Credential rotated. | ST-19, ST-20 |
| T9 | Session hijacking | HttpOnly, Secure, SameSite=Lax cookies. Session regenerated on login. Server-side store. Logout is invalid on all 4 services. | ST-21 |

## 3.2 Security test cases

| ID | Test | Expected | Actual | Evidence |
|---|---|---|---|---|
| ST-01 | `POST /api/articles` with no session | 401 | 401 `Login required` | `evidence/final/e2e/lifecycle-20261125T185609Z.txt` §4 |
| ST-02 | Author approves a review | 403 | 403 `Reviewer permission required` | same; 55/55 author probes denied in k6 (`evidence/final/integration/load/workflow-20261125T193351Z-summary.md`) |
| ST-03 | Editor creates an article | 403 | 60/60 denied | `evidence/final/integration/load/workflow-20261125T193351Z-summary.md` |
| ST-04 | Author 2 reads Author 1's draft | 403 | 403 | `evidence/final/e2e/lifecycle-20261125T185609Z.txt` §4 |
| ST-05 | Author 2 reads or deletes Author 1's versions | 403 | 403 | same, plus `evidence/final/alyaa/resilience-security-20261125T193131Z.txt` |
| ST-06 | Forged CSRF token | 403 | 403 `Invalid or missing CSRF token` | `evidence/final/e2e/lifecycle-20261125T185609Z.txt` §4 |
| ST-07 | Foreign Origin, including look-alike origins | 403 | 403 `Origin not allowed` | same |
| ST-08 | `GET /api/articles/1%20OR%201=1` | 400, no query run | 400 `Invalid ID` | same |
| ST-09 | Search for `'; DROP TABLE articles;--` | Treated as text | 0 results, tables intact | `evidence/final/security/extra-security-checks.txt` |
| ST-10 | Stored `<script>` and `onerror` payload | Returned as inert text | Returned as a JSON string; 0 `innerHTML`/`eval` sinks in the frontend | same |
| ST-13 | Anonymous vote | 401 | 401; 45/45 in k6 | `evidence/final/integration/load/workflow-20261125T193351Z-summary.md` |
| ST-14 | Registration without a Turnstile token | 400 | 400 `Turnstile verification failed` | `evidence/final/e2e/lifecycle-20261125T185609Z.txt` |
| ST-15 | Brute-force login | 429 after 30 | 429 | `evidence/final/rate-limits/production-limits-20261125T193434Z.txt` (4/4) |
| ST-17 | `/internal/*` call that is unsigned, forged, expired or from an unknown service | 401 | 401 | `evidence/final/alyaa/resilience-security-20261125T193131Z.txt`, `evidence/final/security/extra-security-checks.txt` |
| ST-18 | AWS calls made with each component's own key | Allowed calls succeed; other components' resources denied | 47 pass, 0 fail, 1 limit | `evidence/final/iam/iam-permission-tests-20261125T190729Z.txt` |
| ST-19 | Article key reads the Editorial secret | `AccessDenied`, service refuses to start | `AccessDeniedException`, exit 1 | `evidence/final/aws/secrets-runtime-denial.txt` |
| ST-20 | Secrets in the repository | None | Tree and 13/13 remote branches clean. The revoked value is still in GitHub `refs/pull/1-8`. | `evidence/security-automation/02-final-repository-secret-scan.txt` |
| ST-21 | Session reused after logout, on all four services | 401 | 401 | `evidence/final/alyaa/resilience-security-20261125T193131Z.txt` |
| ST-22 | Self-registration asks for the `admin` role | Stored as `author` | Stored as `author` | same |

The full list of 22 tests with procedures is in `docs/final/05-security-tests.md`.
Re-run results from 2026-11-25 are in `docs/final/07-security-test-results.md`.

## 3.3 IAM least privilege

- Each component uses its **own** IAM user (Floci; these would be IAM roles on real AWS). Each
  policy is limited to named resources (`infra/iam/*.json`).
- Each ECS task gets its own component key from Secrets Manager. The execution role can read only
  `supporthub/ecs/*` (`evidence/cloud-architecture/02-ecs-on-floci.txt` §B).
- Production worker users can only send to, or only consume from, the production queue: 7/7
  allow/deny checks (`evidence/security-automation/01-production-configuration-verification.txt`).
- On the simulated remote host: 12 allow/deny checks passed, including "no component key can
  invoke the Lambda" (`evidence/cloud-architecture/05-remote-deployment-preparation.txt` §E).

## 3.4 Secrets Manager

- **Secrets:** `supporthub/shared/{session,service-hmac,database}` and one runtime secret per
  service. One loader is used in all four services: allow-listed keys only, values never logged,
  and `SECRETS_REQUIRED=true` fails closed (`docs/final/02-technical-evidence-pack.md` §21).
- **Workers:** they load only their own per-component database secret
  (`supporthub/article/database`, `supporthub/editorial/database`).
  Source: `evidence/cloud-architecture/step1-floci-recreation/STEP1-REPORT.txt` §4.
- **Scans:** the evidence files were scanned against the live secret values with 0 hits, and
  gitleaks found no leaks (`evidence/security-automation/FINAL_SUMMARY.txt`, `evidence/editorial-aws/FINAL_SUMMARY.txt`).

## 3.5 Database roles

- **Rotation:** the Neon owner password was reset on 2026-11-26 and the old credential is
  rejected. Results: restricted component migration 6/6, database permission checks **32/32**,
  restricted authentication checks **4/4** (`evidence/production-security/database-credential-rotation.txt`).
- **Roles:** the services and workers connect as `supporthub_{article,identity,editorial,search}_app`.
  After all deployments were exercised, there was no owner-role session in production
  (`evidence/final-security-search/01-vercel-and-docker-configuration.txt`).
- **Worker configuration:** a worker refuses to start with the owner role or with
  `sslmode=disable` (exit 2) (`evidence/security-automation/06-startup-recovery-tests.txt`, T6.6).

## 3.6 Rate limiting

| Endpoint | Production limit | Result | Evidence |
|---|---|---|---|
| Login | 30 per 15 min | 429 | `evidence/final/rate-limits/production-limits-20261125T193434Z.txt` |
| Duplicate check | 30 | 429 | same |
| Public search | 120 | 429 | same |

The separate `RATE_LIMIT_PROFILE=loadtest` profile is used only for load tests and is refused in
production (`docs/final/08-compliance-matrix.md`).
Limitation: the counters are held in memory, so each Vercel instance counts separately
(`docs/final/02-technical-evidence-pack.md` §33).

## 3.7 Honest limitations

**Floci emulator limits** (configured correctly, but only real AWS could prove enforcement):
- Floci does not verify SigV4 signatures; it checks only the access key ID
  (`evidence/editorial-aws/02-sns-configuration-and-iam.txt`).
- It serves unsigned S3 GETs, even though Block Public Access is on and no bucket policy exists
  (`evidence/search-aws/04-s3-object-verification.txt`).
- It ignores the `cloudwatch:namespace` condition (`docs/final/05-aws-iam-verification.md`).
- It does not enforce ECS task or execution roles. This is compensated with per-task component
  keys (`evidence/cloud-architecture/02-ecs-on-floci.txt` §A).
- It accepts its default admin credentials. This is mitigated by binding Floci to loopback only:
  the LAN and Tailscale cannot reach it (`evidence/cloud-architecture/step1-floci-recreation/STEP1-REPORT.txt` §6).
- It does not log SNS deliveries, and ECS task output does not reach CloudWatch Logs.
- A Floci restart took about 4.5 min (`evidence/cloud-architecture/02-ecs-on-floci.txt` §E).

**Other limitations:**
- The Lambda receives `DATABASE_URL` as a plain environment variable. On real AWS this would come
  from Secrets Manager or KMS (`evidence/editorial-aws/FINAL_SUMMARY.txt`).
- The production site does not yet send the branch's CSP header
  (`evidence/final/integration/production-read-only-probe-20261125T193623Z.txt`).
- The revoked password remains in GitHub `refs/pull/1-8` until GitHub Support purges them
  (`evidence/security-automation/02-final-repository-secret-scan.txt`).
- There is no MFA. Vote deduplication is per account, not per real identity (`docs/threat-model.md`).
