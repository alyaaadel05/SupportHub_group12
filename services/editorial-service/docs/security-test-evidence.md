# Editorial Service — Security Test Evidence

**Component:** Editorial Workflow and Publication Service · **Owner:** Salma
**Threat model:** [`threat-model.md`](./threat-model.md)
**Test file:** `tests/securityHttp.test.js` (HTTP-level), supported by `tests/securityTest.js`, `tests/csrfToken.test.js`, `tests/validation.test.js`, `tests/reviewWorkflow.test.js`

## 1. How to reproduce

```powershell
cd C:\Users\10\SupportHub_group12\services\editorial-service
npm test
# security tests only:
node --test tests/securityHttp.test.js
```

No database, Article Service or Floci is needed: the tests send real HTTP requests to the Editorial routes and the real `server.js`, while Article Service calls and database queries are replaced with recorders. This lets each test prove both the **response** and that the blocked request **never reached** the database or Article Service.

## 2. Results

**Run:** 2026-11-23 · Node.js 22 · `node --test` · full suite **151 tests, 151 passed, 0 failed** (136 pre-existing + 15 added).

> Re-run `npm test` on your own machine before submission and paste the final summary lines here, with a screenshot, so the evidence comes from your environment.

| ID | Threat | Test input | Expected | Actual | Result |
|---|---|---|---|---|---|
| S1 | Unauthenticated access (T4/T9) | No cookie: `GET /api/reviews`, `/api/editorial/flags`, `/api/editorial/published`, `/api/articles/1/history`; `POST /api/articles/1/reviews`, `/submissions`; `PATCH /api/articles/1/publication` — against real `server.js` | 401 | 401 `{"error":"Login required"}` on all 7; 0 DB queries, 0 Article calls | **PASS** |
| S2 | Function-level authz (T4) | Session role `author`: approve, publish, list reviews, list flags, resolve flag | 403 | 403 `{"error":"Reviewer permission required"}` on all 5; 0 DB/Article calls | **PASS** |
| S3a | BOLA — change article ID (T3) | Author #10 `POST /api/articles/42/submissions`; article 42 owned by #99 | 403 | 403 `{"error":"Only the author can submit"}`; Article status never transitioned; no workflow row written | **PASS** |
| S3b | Self-approval (T3) | Reviewer #20 approves article 42 authored by #20 | 403 | 403 `{"error":"Cannot review your own article"}`; no transition | **PASS** |
| S4 | CSRF (T5) | Reviewer `POST /api/articles/42/reviews` with: no token · `not-a-token` · wrong 64-hex token · `Origin: https://evil.example` · no Origin | 403 | 403 `Invalid CSRF token` (×3), 403 `Origin not allowed` (×2); 0 DB/Article calls | **PASS** |
| S5a | SQL injection in IDs (T1) | `1 OR 1=1`, `1; DROP TABLE editorial_reviews;--`, `1' OR '1'='1`, `0x1`, `-1` in `/history` and `/reviews` paths | 400 | 400 `{"error":"Invalid positive integer ID"}` for all 10 requests; **0 queries executed** | **PASS** |
| S5b | SQL injection in text (T1) | Flag reason `x'); DROP TABLE editorial_outdated_flags;--` | Treated as data | 201; SQL text contains `$3` and no payload; values `[42, 20, payload]`; payload returned verbatim | **PASS** |
| S5c | Dynamic SQL audit (T1) | Static scan of `services/`, `workers/`, `lambda/`, `controllers/`, `routes/` for `` .query(`…${…}`) `` | None found | None found | **PASS** |
| S6a | Stored XSS (T2) | Flag reason `<script>alert(1)</script><img src=x onerror=alert(2)>` | Stored/returned as inert text | 201, `Content-Type: application/json`, payload returned unchanged as a JSON string | **PASS** |
| S6b | XSS headers (T2) | Any response from real `server.js` | `nosniff`, CSP, no `X-Powered-By` | `X-Content-Type-Options: nosniff`; CSP `default-src 'self'… script-src 'self'`; `X-Powered-By` absent | **PASS** |
| S6c | Safe rendering (T2) | Source check `frontend/js/editorial.js` | No `innerHTML` | Only `textContent` used; no `innerHTML` / `insertAdjacentHTML` / `document.write` | **PASS** |
| S7a | Invalid / expired session (T9) | Session with no user (expired/logged out), id `"abc"`, `0`, `-5`, missing id | 401 | 401 for all 5 | **PASS** |
| S7b | Forged cookie (T9) | Real `server.js` with `supporthub.sid=s%3Aforged…invalidsignature`, unsigned value, empty value | 401 | 401 for all 3 | **PASS** |
| S8 | Rate limiting (T6/T7) | 305 sequential `GET /api/reviews` from one IP to real `server.js` | 429 after 300 | Requests 1–300 → 401; request **301** → **429** with `Retry-After` | **PASS** |

### Supporting unit tests already in the suite

| File | Covers |
|---|---|
| `tests/securityTest.js` (21 tests) | Every role vs `requireLogin` / `requireAuthor` / `requireReviewer`; invalid user IDs; Origin + CSRF middleware; cron secret missing / short / wrong / correct |
| `tests/csrfToken.test.js` (5) | Token is 32 random bytes hex, saved to session, `Cache-Control: no-store`, invalid tokens replaced, no token on save failure |
| `tests/validation.test.js` (7) | Strict ID parsing (rejects `0x1`, `1e3`, `" 1"`, `+1`, `01`, `1.0`), comment trimming/length, rejection needs explanation |
| `tests/reviewWorkflow.test.js` | Self-review blocked, invalid transitions, idempotent replay of `operationId` |
| `tests/articleEventService.test.js` / `articleEventConsumer.test.js` | Malformed and duplicate SQS events |

## 3. Secrets / repository audit (T8)

Run from the repository root and record the output:

```powershell
cd C:\Users\10\SupportHub_group12
git ls-files | Select-String -Pattern '\.env|secret|\.pem|\.key|credentials'
git log --all --name-only --format="" | Select-String -Pattern '\.env' | Sort-Object -Unique
git grep -I -n -E "postgres(ql)?://[^:@/]+:[^@/]+@" $(git rev-list --all) -- . ":!*.example" ":!*.md"
```

Expected: only `services/editorial-service/.env.example` (placeholders) is tracked; no `.env`, `.env.local` or backup file appears in history; no real connection string is found. If any real secret was ever committed, rotate it (Neon password, `SESSION_SECRET`, `SERVICE_SHARED_SECRET`, `CRON_SECRET`) — deleting the file does not remove it from history.

| Check | Result |
|---|---|
| Tracked env/secret files | .env.example files only; no actual secret files identified in the current tracked-file check |
| Env files in any commit | .env.example files found; full history audit remains unverified |
| Connection strings in history | Potential matches found in test files; not yet classified as real credentials or test fixtures |

## 4. Mapping to the group test plan (`docs/test-plan.md`)

| Group ID | Editorial evidence |
|---|---|
| S01 SQL injection | S5a, S5b, S5c |
| S03 BOLA | S3a (Editorial submit); article *editing* is Article Service |
| S04 Unauthorized editorial action | S2 |
| S05 CSRF | S4 |
| S06 Stored XSS | S6a–c (+ browser screenshot) |
| S08 Login rate limiting | Identity service; Editorial API limiter is S8 |
| S10 Editorial ownership separation | S3b |
| S02, S07, S09 | Article / Identity / Search owners |

## 5. Limitations

- Tests run against the real Express routes and middleware but with mocked database and Article Service; they prove Editorial's own enforcement, not the live cross-service deployment.
- The browser-rendered XSS check and the full browser CSRF flow should be shown once in the demo video.
- Login brute-force protection and Turnstile verification are owned by other services and must be evidenced there.
