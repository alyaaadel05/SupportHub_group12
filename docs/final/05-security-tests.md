# SupportHub — Security Test Report (executed 2026-11-24)

All tests below were **executed** against the integrated Floci stack in the cloud
sandbox (real HTTP through the same-origin proxy, real Floci with IAM enforcement,
real PostgreSQL). Evidence files are in `evidence/final/`. Earlier per-service
security evidence is preserved and still valid:
`evidence/security/*`, `services/editorial-service/docs/security-test-evidence.md`,
`services/search-analytics-service/evidence/*`.

| Test ID | Threat | Component | Test procedure | Expected result | Actual result | HTTP | Evidence | Status |
|---|---|---|---|---|---|---|---|---|
| ST-01 | Unauthenticated access (T1) | Article | `POST /api/articles` with no session cookie | Rejected | `Login required` | 401 | `e2e/lifecycle-*Z.txt` §4 | PASS |
| ST-02 | Unauthorized role / editorial approval by author (T2) | Editorial | Author session `POST /api/articles/:id/reviews` | Forbidden | `Reviewer permission required` | 403 | `e2e/lifecycle-*` §4; k6: 55 author probes of `/api/reviews` all 403 | PASS |
| ST-03 | Unauthorized role / editor creating content | Article | Editor session `POST /api/articles` (k6, 60×) | Forbidden | 60/60 denied | 403 | `load/workflow-20261124T021755Z-summary.md` | PASS |
| ST-04 | BOLA – other author's private draft (T3) | Article | Author 2 `GET /api/articles/:id` of Author 1's draft | Forbidden | Forbidden | 403 | `e2e/lifecycle-*` §4 | PASS |
| ST-05 | BOLA – other author's version history (T11) | Article | Author 2 `GET /api/articles/:id/versions` | Forbidden | Forbidden | 403 | `e2e/lifecycle-*` §4 | PASS |
| ST-06 | CSRF – forged token (T8) | Article | Valid session, `X-CSRF-Token` = 64 zeros | Rejected | `Invalid or missing CSRF token` | 403 | `e2e/lifecycle-*` §4 | PASS |
| ST-07 | CSRF – foreign Origin (T8) | Article | Valid session + token, `Origin: https://evil.example` | Rejected | `Origin not allowed` | 403 | `e2e/lifecycle-*` §4 | PASS |
| ST-08 | SQL injection in ID (T4) | Article | `GET /api/articles/1%20OR%201=1` | Validation error, no query | `Invalid ID` | 400 | `e2e/lifecycle-*` §4 | PASS |
| ST-09 | SQL injection in search text (T4) | Search | `GET /api/public/articles?q='; DROP TABLE articles;--` | Treated as text | 0 results, tables intact | 200 | `security/extra-security-checks.txt` | PASS |
| ST-10 | Stored XSS (T5) | Article + frontend | Create article with `<script>…<img onerror>` content; read back; scan frontend for HTML sinks | Stored and returned as inert JSON text; rendered with `textContent` | verbatim JSON string, `application/json`; 0 `innerHTML`/`eval` sinks; CSP `script-src 'self'` | 201/200 | `security/extra-security-checks.txt`, `frontend/smoke-*` | PASS |
| ST-11 | Invalid input (T4) | Article | Empty title / too-short content | Validation error | `Title must be 3-200…` | 400 | `e2e/lifecycle-*` §4 | PASS |
| ST-12 | Invalid workflow transition (T9) | Editorial | Publish an article that is still `in_review` | Conflict | Conflict | 409 | `e2e/lifecycle-*` §4 | PASS |
| ST-13 | Feedback abuse – anonymous vote (T7) | Search | `POST /api/articles/:id/votes` without session | Rejected | `Login required` (also 28/28 in k6) | 401 | `e2e/lifecycle-*` §6, k6 summary | PASS |
| ST-14 | Bot registration without Turnstile (T7) | Identity | `POST /api/auth/register` with no `turnstileToken` | Rejected before any Cloudflare call | `Turnstile verification failed` | 400 | `e2e/lifecycle-20261124T021310Z.txt` §2 | PASS |
| ST-15 | Brute-force login (T1) | Identity | 31 wrong-password logins from one client | 429 after 30 attempts; all earlier 401; event logged | first 429 at attempt 30 (1 earlier login counted); `security_event rate_limited` | 401→429 | `rate-limits/production-limits-*.txt` | PASS |
| ST-16 | Resource exhaustion – duplicate checks / search (T12, T7) | Article, Search | 32 duplicate checks, 122 searches | 429 after 30 / 120 | first 429 at 31 / 121 | 429 | `rate-limits/production-limits-*.txt` | PASS |
| ST-17 | Service-to-service forgery (T2/T9) | Article, Search | `/internal/*` without signature, forged signature, 10-min-old timestamp, unknown service name | Rejected | 401 on all 6 requests | 401 | `security/extra-security-checks.txt` | PASS |
| ST-18 | IAM least privilege per component | All AWS | 39 AWS CLI calls with each component's **own** key: allowed actions succeed, other actions and other components' resources are denied | 16 ALLOW / 23 DENY as designed | 39/39 as expected | n/a | `iam/iam-permission-tests-20261124T020750Z.txt` | PASS |
| ST-19 | Secret exposure via cross-component secret access (T6) | Secrets Manager | Article container (own key) requests `supporthub/editorial/runtime` with `SECRETS_REQUIRED=true` | AccessDenied, service refuses to start | `AccessDeniedException`, exit 1 | n/a | `aws/secrets-runtime-denial.txt` | PASS |
| ST-20 | Secret exposure in repository (T6) | Repository | Scan tracked files and full history for `.env`, keys, connection strings | No secrets | **FAIL (historical):** real Neon URL in `backend/.env.example` since `d0a2a2b`; removed from the current tree; **password rotation required** | n/a | `security/extra-security-checks.txt` | FAIL → mitigated, rotation pending |
| ST-21 | Session fixation / logout | Identity | Code + existing tests: `req.session.regenerate` on login, `destroy` + cookie clear on logout, HttpOnly/SameSite=Lax cookies | Implemented | 25/25 Identity unit tests pass | n/a | `unit-tests/all-services-*.txt` | PASS |
| ST-22 | Security headers | All APIs + frontend | Inspect response headers | CSP, HSTS, nosniff, frame protection, no X-Powered-By | present on API; frontend `_headers` CSP verified in browser | n/a | `security/extra-security-checks.txt`, `frontend/smoke-*` | PASS |

**Total: 22 tests — 21 PASS, 1 FAIL (historical secret in Git history; mitigated in the tree, requires credential rotation).**

## Not verified here

| Item | Reason |
|---|---|
| Successful registration with a **valid** Turnstile token | `challenges.cloudflare.com` blocked in the sandbox; Identity correctly fails closed (400). Run step 3 of `04-deployment-verification.md`. |
| Successful helpfulness vote with Turnstile enforced | Same reason (502 "Turnstile verification unavailable", safe failure). Votes were exercised with `REQUIRE_TURNSTILE_FOR_VOTES=false` **only** in the k6 load-test profile. |
| Stack Exchange results | `api.stackexchange.com` blocked; service returns the safe 502 message (verified in the browser). |

## Security-event logging (evidence)

- Structured JSON lines `{"type":"security_event","event":"access_denied|authentication_failed|rate_limited",...}` from all four services (no bodies, cookies, tokens or query strings).
- `audit_logs` rows: `LOGIN_FAILED` (email stored as a truncated SHA-256), `USER_LOGIN`, `article.create/update/submit/version.export`.
- Search publishes `Requests`, `ClientErrors`, `ServerErrors`, `RateLimited`, `LatencyMs`, `Searches`, `ZeroResultSearches` to CloudWatch (`aws/aws-usage-*.txt`).
