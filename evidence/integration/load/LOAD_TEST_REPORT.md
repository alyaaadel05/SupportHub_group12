# SupportHub Group 12 — Local Load-Test Report (Integration Branch)

**Date:** 2026-11-23
**Branch tested:** `integration/group12-final` (Alyaa + Salma + Nermeen merged, plus configurable rate limits)
**Environment:** isolated local Docker stack only — no Neon, AWS, Vercel, Cloudflare or existing SupportHub containers were used.

---

## 1. Summary

| Test | Goal | Result |
|---|---|---|
| Smoke | Every endpoint once (public, author, editor) | **PASS** — 16/16 endpoints HTTP 200 |
| Test A | Exactly 1,000 HTTP requests | **PASS** — 1,000 requests, 0 failures, 0 5xx, p95 418 ms |
| Test B (500 users, Search pool 5) | 500 concurrent users | **PASS** — 60,190 requests, 0 failures, 0 5xx; Search slowed at peak (p95 ≈ 2.9 s) |
| Test B (500 users, Search pool 15) | Same, with Search DB pool raised to 15 | **PASS (no errors) but slower** — 42,614 requests, 0 failures, 0 5xx; all services slowed (p95 5.7 s) |
| Test B (1,000 users) | 1,000 concurrent users | **NOT EXECUTED** — laptop never had the agreed 3.0 GB free RAM at start time |

No test produced an HTTP 5xx, 429 or network error. No safety stop triggered.

---

## 2. Test environment and isolation

### 2.1 Stack (`tests/load/stack/docker-compose.loadtest.yml`)

| Container | Image | Host port | Memory cap | CPU cap |
|---|---|---|---|---|
| `supporthub-loadtest-db` | `postgres:16-alpine` (tmpfs, SSL on) | none | 768 MB | 2 |
| `supporthub-loadtest-identity` | built from worktree | 127.0.0.1:13003 | 384 MB | 1.5 |
| `supporthub-loadtest-article` | built from worktree | 127.0.0.1:13001 | 384 MB | 1.5 |
| `supporthub-loadtest-editorial` | built from worktree | 127.0.0.1:13002 | 384 MB | 1.5 |
| `supporthub-loadtest-search` | built from worktree | 127.0.0.1:13004 | 384 MB | 1.5 |

- Own Compose project (`supporthub-loadtest`), names, images, networks and ports.
- Database on an `internal: true` network: no internet, no host port, data in RAM only.
- No `.env` files; all secrets are throwaway test values.
- AWS endpoints set to a dead end (`127.0.0.1:1`); CloudWatch, DynamoDB, S3, Hugging Face and the SQS/SNS workers disabled; Turnstile skipped in development mode (no Cloudflare call).
- `RATE_LIMIT_MAX=100000` in this stack only. Identity's login limit stayed fixed at 30 per 15 minutes; 8 logins were used in total.
- Throwaway TLS certificate (scratchpad only, 2-day expiry) trusted through `NODE_EXTRA_CA_CERTS`; no SSL code was changed.

### 2.2 Database

- Core tables (`users`, `categories`, `articles`, `article_versions`, `audit_logs`) were **reconstructed from the services' queries** (`tests/load/stack/db/00-core-schema.sql`), because their authoritative definitions exist only in Neon.
- All 11 team migrations ran unchanged.
- Synthetic seed (`tests/load/stack/db/90-seed.sql`): 2 users (`loadtest-author`, `loadtest-editor`), 4 categories, 75 articles with IDs 1001–1075 (60 published, 10 in review with pending Editorial reviews, 5 drafts).

### 2.3 Isolation checks (all passed before any load)

| # | Check | Result |
|---|---|---|
| 1 | Services connect only to `loadtest-db` | All 4 services; database saw exactly the 4 test-service IPs, all over SSL (verified before start and after start) |
| 2 | Only synthetic data | 2 users, 75 articles (1001–1075), 0 rows with IDs 7, 21 or 22 |
| 3 | Database has no internet | `neon.tech` and `1.1.1.1` unreachable from the DB container |
| 4 | Existing containers untouched | `supporthub-article`, `supporthub-identity`, `supporthub-article-outbox-worker`, `supporthub-floci`: identical ID, start time and state before and after every test |
| 5 | Health endpoints | All 4 HTTP 200 |

After all tests: still 75 articles, 0 rows with IDs 7/21/22, 0 error/timeout lines in any test container log.

### 2.4 Machine

- CPU: Intel Core i7-12700H (14 cores / 20 threads); RAM 15.7 GB total
- Docker VM: 20 CPUs, 4.8 GB memory cap
- k6 v2.4.0 (runs on Windows, outside Docker); Docker 29.9.3; Compose v5.7.0
- The laptop ran k6, all test services, the test database, the team's existing containers and desktop applications at the same time.

---

## 3. Test design

### 3.1 Endpoint mix (`tests/load/k6/lib/supporthub.js`)

| Role | Service | Endpoints | Weight |
|---|---|---|---|
| Public | Search | `GET /api/public/articles?q=…`, `GET /api/public/articles/:id` | 20, 12 |
| Public | Article | `GET /api/categories` | 8 |
| Public | Identity | `GET /api/auth/csrf` | 4 |
| Public | all 4 | `GET /api/health` | 1 each |
| Author | Identity | `GET /api/auth/me` | 6 |
| Author | Article | `GET /api/articles/mine`, `/api/articles/:id`, `/api/articles/:id/versions` | 10, 6, 4 |
| Editor | Identity | `GET /api/auth/me` | 4 |
| Editor | Editorial | `GET /api/reviews?status=pending` (calls Article for each of 10 reviews), `GET /api/editorial/published` | 6, 4 |
| Editor | Search | `GET /api/analytics/overview` | 4 |

Approximate traffic share: public 61%, author 26%, editor 14%. All 1,000/500 virtual users share the same two synthetic sessions (author and editor), because the login limit is fixed at 30 per 15 minutes.

Public search and article-detail requests also **write** to the database (search log row, view row), as in production.

The k6 library refuses to run unless every target is `127.0.0.1` or `localhost` (verified: a Vercel URL and a private IP were both refused).

### 3.2 Scenarios

| Test | Script | Load |
|---|---|---|
| Smoke | `smoke.js` | 1 user, each endpoint once |
| Test A | `test-a-1000-requests.js` | 50 users share 996 iterations + 4 setup requests = **exactly 1,000 requests**; abort on any 5xx |
| Test B (500) | `test-b-500-concurrent-users.js` | 0 → 125 → 250 → 500 users (1 min ramp, 1 min hold; 2 min at 500), 1–3 s think time |
| Test B (1,000) | `test-b-1000-concurrent-users.js` | 0 → 250 → 500 → 1,000 users, same pattern — **NOT EXECUTED** |

Test B safety stops (after 30 s warm-up): 5xx > 5%, failed requests > 20%, p95 > 10 s.

---

## 4. Results

### 4.1 Overall

| Metric | Smoke | Test A | Test B 500 (pool 5) | Test B 500 (pool 15) |
|---|---|---|---|---|
| Virtual users (peak) | 1 | 50 | 500 | 500 |
| HTTP requests | 20 | **1,000** | 60,190 | 42,614 |
| Failed | 0.00% | 0.00% | 0.00% | 0.00% |
| 5xx / 429 / errors | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| Avg latency | 53 ms* | 124 ms | 129 ms | 1,004 ms |
| p95 latency | 348 ms* | 418 ms | 154 ms | 5,660 ms |
| Max latency | 376 ms* | 976 ms | 11,133 ms | 11,342 ms |
| Throughput | 17.8 req/s | 307.4 req/s | 132.8 req/s | 94.0 req/s |

\* Smoke figures include the 2 setup logins (bcrypt cost 12, ≈350 ms each by design). Excluding them, smoke endpoint latencies were 2–109 ms.

Test A throughput is higher than Test B because Test A has no think time; Test B users pause 1–3 s between requests.

### 4.2 By service (requests / p95)

| Service | Test A | Test B 500 (pool 5) | Test B 500 (pool 15) |
|---|---|---|---|
| Identity | 161 / 146 ms | 9,855 / 32 ms | 6,966 / 192 ms |
| Article | 323 / 539 ms | 19,107 / 71 ms | 13,351 / 7,607 ms |
| Editorial | 123 / 424 ms | 7,135 / 75 ms | 5,170 / 2,578 ms |
| Search & Analytics | 393 / 148 ms | 24,093 / **2,902 ms** | 17,127 / 3,522 ms |

Identity totals include the 4 setup requests of each run.

### 4.3 By role (requests / p95)

| Role | Test A | Test B 500 (pool 5) | Test B 500 (pool 15) |
|---|---|---|---|
| Public (unauthenticated) | 507 / 161 ms | 31,217 / 573 ms | 22,259 / 2,495 ms |
| Author | 286 / 479 ms | 17,234 / 68 ms | 12,026 / 7,725 ms |
| Editor | 203 / 296 ms | 11,735 / 114 ms | 8,325 / 3,922 ms |

### 4.4 By service and role (requests / p95)

| Service | Role | Test A | Test B 500 (pool 5) | Test B 500 (pool 15) |
|---|---|---|---|---|
| Identity | public | 52 / 20 ms | 3,251 / 18 ms | 2,320 / 105 ms |
| Identity | author | 63 / 140 ms | 3,948 / 39 ms | 2,820 / 202 ms |
| Identity | editor | 42 / 135 ms | 2,652 / 39 ms | 1,822 / 203 ms |
| Article | public | 100 / 410 ms | 5,821 / 46 ms | 4,145 / 2,727 ms |
| Article | author | 223 / 565 ms | 13,286 / 80 ms | 9,206 / 8,005 ms |
| Editorial | public | 6 / 47 ms | 681 / 16 ms | 466 / 104 ms |
| Editorial | editor | 117 / 446 ms | 6,454 / 82 ms | 4,704 / 2,618 ms |
| Search | public | 349 / 139 ms | 21,464 / 2,825 ms | 15,328 / 2,564 ms |
| Search | editor | 44 / 252 ms | 2,629 / 4,609 ms | 1,799 / 6,125 ms |

All requests in every row returned HTTP 2xx (0 4xx, 0 429, 0 5xx, 0 errors).

### 4.5 Test B by load level (requests / 5xx / p95)

| Level | Pool 5 | Pool 15 |
|---|---|---|
| ramp to 125 | 1,855 / 0 / 23 ms | 1,865 / 0 / 109 ms |
| hold 125 | 3,737 / 0 / 19 ms | 3,700 / 0 / 27 ms |
| ramp to 250 | 5,600 / 0 / 22 ms | 5,605 / 0 / 72 ms |
| hold 250 | 7,500 / 0 / 23 ms | 7,356 / 0 / 196 ms |
| ramp to 500 | 11,275 / 0 / 26 ms | 7,182 / 0 / 5,597 ms |
| hold 500 | 27,584 / 0 / 536 ms | 14,186 / 0 / 7,391 ms |
| ramp-down | 2,635 / 0 / 3,746 ms | 2,716 / 0 / 3,712 ms |

### 4.6 Smoke test — per endpoint

| Status | Role | Service | Endpoint | Time |
|---|---|---|---|---|
| 200 | public | search | `GET /api/public/articles?q` | 19 ms |
| 200 | public | search | `GET /api/public/articles/:id` | 7 ms |
| 200 | public | article | `GET /api/categories` | 25 ms |
| 200 | public | identity | `GET /api/auth/csrf` | 5 ms |
| 200 | public | identity / article / editorial / search | `GET /api/health` | 2 / 4 / 15 / 8 ms |
| 200 | author | identity | `GET /api/auth/me` | 7 ms |
| 200 | author | article | `GET /api/articles/mine` | 19 ms |
| 200 | author | article | `GET /api/articles/:id` | 7 ms |
| 200 | author | article | `GET /api/articles/:id/versions` | 10 ms |
| 200 | editor | identity | `GET /api/auth/me` | 6 ms |
| 200 | editor | editorial | `GET /api/reviews?status=pending` | 109 ms |
| 200 | editor | editorial | `GET /api/editorial/published` | 10 ms |
| 200 | editor | search | `GET /api/analytics/overview` | 38 ms |

---

## 5. Findings

### 5.1 Correctness under load

Across 103,804 load-test requests (Test A + both Test B runs) there were **no** HTTP 5xx, 429, 4xx or network errors. Shared sessions stayed valid throughout, the service-to-service calls (Editorial → Article) worked under load, and no service logged an error or timeout.

### 5.2 Test A (1,000 requests)

All services handled 1,000 requests at 50 concurrent users with p95 418 ms and 307 req/s. The slowest paths were author requests to Article (p95 565 ms; `GET /api/articles/mine` returns all 75 articles with full text) and the Editorial review queue (p95 446 ms; 10 internal Article calls per request).

### 5.3 Search & Analytics at 500 users (pool 5)

- Identity, Article and Editorial stayed fast (p95 ≤ 85 ms for every role).
- Search slowed during the 500-user hold: public search p95 2.8 s, analytics overview p95 4.6 s. Latency was flat (≈20 ms) up to 250 users and rose only after 500 users had been running for some time; the backlog was still draining during ramp-down (p95 3.7 s).
- Requests slowed rather than failed: 0 errors and no `503 Service busy` responses.
- Search's database pool was at its default size of 5. Each public search and article view also writes a row, so a small pool can make requests wait for a connection. **This is consistent with pool queueing but was not proven.**

### 5.4 Raising Search's pool to 15

Changing only `DB_POOL_MAX` from 5 to 15 (test stack only) did **not** make Search faster and made **every** service slower:

- Search public p95: 2,825 → 2,564 ms (about the same); analytics overview: 4,609 → 6,125 ms.
- Article author p95: 80 → 8,005 ms; Editorial editor: 82 → 2,618 ms; Identity: 39 → ≈200 ms.
- Degradation started earlier (hold-250 p95 23 → 196 ms) and throughput fell 29% (133 → 94 req/s).

**Hypothesis (not verified):** with a pool of 5, Search may have been limiting how many of its queries reached the single shared test database at once. With 15, Search could send roughly three times as many concurrent queries, mostly writes, to a PostgreSQL container limited to 2 CPU cores, which could slow every service sharing that database. This fits the observation that all services degraded together, but **database and service CPU were not measured during the runs**, so this explanation is unconfirmed. Other possible contributors are listed in §6 (limitations 4, 6 and 7).

**Conclusion supported by the data:** on this setup, increasing Search's pool size alone did not improve Search latency and coincided with worse latency for all other services.

### 5.5 1,000 concurrent users — NOT EXECUTED

The 1,000-user script (`test-b-1000-concurrent-users.js`) was written and validated with `k6 inspect` but never executed. The agreed safety gate required at least 3.0 GB of free Windows RAM at start time for k6; checks returned 2.5, 1.75, 1.46, 2.42, 2.45 and 2.42 GB. (One later check showed 3.01 GB; the 500-user test was chosen instead.) **This report does not demonstrate 1,000 concurrent users.**

---

## 6. Limitations

1. **Laptop, not cloud.** k6, all services, the database and other applications shared one laptop. Results describe this machine's capacity, not Vercel/Neon production capacity.
2. **Reconstructed core schema.** `users`, `articles`, `categories`, `article_versions` and `audit_logs` were rebuilt from code queries; indexes and constraints may differ from Neon.
3. **Small synthetic dataset.** 75 articles and 2 users; production data volume and distribution differ.
4. **Shared sessions.** All virtual users reuse one author and one editor session (login limit fixed at 30 per 15 minutes). This limits realism: real users would each have their own session. Because every authenticated request refreshes its session in the shared `user_sessions` table, concentrating all traffic on two sessions may cause contention on the same two database rows, which could add latency that separate real sessions would not. This effect was not measured.
5. **Read-heavy mix.** No article create/edit/submit, review decisions, votes or feedback were sent; only the writes caused by public search and article views.
6. **No resource sampling.** CPU and memory of the database and services were not recorded during runs, so bottlenecks cannot be attributed with certainty.
7. **Unequal starting state.** The pool-15 run started with ≈13,000 extra search-log and ≈7,900 view rows from the pool-5 run, and free RAM differed (2.86 GB vs 2.55 GB at start). Other desktop applications and the team's existing `supporthub-article-outbox-worker` (≈12% CPU) were running during both runs.
8. **Disabled integrations.** DynamoDB counters, CloudWatch metrics, S3 exports, SQS/SNS workers, Hugging Face sentiment and Turnstile were off, so their cost is not included.
9. **Cumulative safety stops.** k6 thresholds are evaluated over the run so far; a short late spike may not trigger a stop (the per-level table shows such spikes).

## 7. Suggested follow-up (not done)

- Re-run the 500-user test (pool 5 and pool 15) with database and service CPU sampled every few seconds, from the same fresh database state, to confirm or rule out database contention.
- Run the 1,000-user test on a machine with more free RAM, or with k6 on a separate machine.
- Add write-heavy scenarios (create/edit/submit, review decisions, votes) on the disposable database.

---

## 8. Evidence files (this folder)

| File | Content |
|---|---|
| `smoke-20261123-203549-summary.txt` / `.json` | Smoke test |
| `test-a-20261123-204612-summary.txt` / `.json` | Test A — 1,000 requests |
| `test-b-500-20261123-211140-summary.txt` / `.json` | Test B 500 users, Search pool 5 |
| `test-b-500-pool15-20261123-212721-summary.txt` / `.json` | Test B 500 users, Search pool 15 |
| `LOAD_TEST_REPORT.md` | This report |

Existing evidence was not modified: Alyaa's `evidence/alyaa-final/load-tests/` and Nermeen's `services/search-analytics-service/load-tests/results/`.
