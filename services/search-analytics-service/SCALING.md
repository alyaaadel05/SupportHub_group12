# Search & Analytics Service – Independent Service Scaling

## 1. What "independent scaling" means
SupportHub is split into separate services (Identity, Article, Editorial, Search & Analytics). Each runs as its own process / container / Vercel project with its own port and URL. Because of this, **each service can be given more copies (instances) on its own**, based on its own traffic, without changing or redeploying the others.

Example: during exam week, thousands of students search for help articles, but very few authors write articles. We scale only the Search & Analytics Service; the Article and Editorial services stay as they are.

## 2. Why this service can be scaled safely
| Design choice | Why it allows many copies |
|---|---|
| Stateless API (Express) | No important data is kept in the server's memory between requests. |
| Sessions stored in PostgreSQL (`user_sessions`, connect-pg-simple) | Any copy can read the logged-in user's session, so a user can be served by any instance. |
| All data in Neon PostgreSQL | Searches, views, votes and feedback are written to the shared database, not to local files. |
| Pooled database connection (`DATABASE_URL_POOLED`, `DB_POOL_MAX` connections per instance: 5 in Docker, 3 on Vercel) | Many instances share Neon's connection pooler instead of each opening many direct connections. |
| Batched AWS calls (DynamoDB counters every 5 s, CloudWatch metrics every 10 s) | A search never waits for AWS; many searches for the same term become one DynamoDB update. |
| Separate URL/port (3004) | Load balancers or Vercel can route traffic only to this service. |

## 3. How it scales in each environment
| Environment | How to add capacity |
|---|---|
| **Vercel (production)** | Serverless functions: Vercel automatically starts more instances when more requests arrive, and scales down when traffic drops. |
| **Docker (local / server)** | Run more containers of this service only, e.g. `docker compose up --scale search-analytics-service=3`, behind a load balancer. |
| **Database (Neon)** | Neon's pooled endpoint handles many client connections; compute size can be increased separately if the database becomes the bottleneck. |

## 4. What limits scaling (known limitations)
1. **Shared database** – all copies use the same Neon database. More copies means more queries; the database becomes the bottleneck first. Indexes (see `INDEXING-REVIEW.md`) and reading less data per search (see `PAGINATION-REVIEW.md`) reduce this load.
2. **Rate limiter is per instance** – `express-rate-limit` stores counts in memory, so each copy counts separately. With 3 copies, a user could make up to 3× the limit. A shared store (e.g. Redis) would fix this in a larger deployment.
3. **Search reads up to 1000 articles per request** – CPU and database cost grow with the number of articles (see `PAGINATION-REVIEW.md`).
4. **External APIs** – Cloudflare Turnstile and Hugging Face calls are limited by those providers; failures do not stop search, only votes/feedback features.
5. **Batched counters can lose a few seconds of counts** if an instance stops before its next flush. Neon remains the source of truth for analytics; DynamoDB holds live counters only.
6. **Floci is local only** – the AWS features run on the local emulator; on Vercel they are switched off safely (see `DEPLOYMENT.md`).

## 5. Results (k6, `load-tests/search-load-test.js`)
Profiles: low (5 users, 30 s), moderate (25 users, 1 min), high (100 users, 1 min). Thresholds: p95 < 800 ms and < 1 % failed requests. Raw outputs are in `load-tests/results/`.

### 5.1 Finding the bottleneck (19–20 Nov)
| Step | What happened | Conclusion |
|---|---|---|
| Moderate with the production rate limit | Most requests returned 429 | The limiter works; load tests need a separate copy with a higher limit (`RATE_LIMIT_MAX` is configurable). |
| High, original version | p95 ≈ 1.74 s, ≈ 38 req/s | Too slow under 100 users. |
| Bigger DB pool (`high-pool15.txt`) | No real improvement | The pool size was not the bottleneck. |
| Health endpoint only (`high-health.txt`) | Fast | The server itself is fine; the cost is in the search request. |
| Search with DynamoDB off (`high-no-dynamodb.txt`) | Fast again | One DynamoDB call per search was the bottleneck. |
| **Batched DynamoDB counters** (`high-batched.txt`) | **p95 ≈ 160 ms, ≈ 85 req/s** | Fixed: counters are queued in memory and written every 5 s. |

### 5.2 Final verification on the current version (21 Nov)
Run against a separate load-test container (port 3014, `RATE_LIMIT_MAX=100000`) so the real service on port 3004 kept its normal limit. Includes the new analytics features and the rotated Neon credentials.

| Profile | Requests | Failed | Median | p95 | Throughput | Result |
|---|---|---|---|---|---|---|
| Moderate (25 users) | 1250 | 0 (0.00 %) | 154 ms | 677 ms | 20.5 req/s | ✅ |
| High (100 users) | 4960 | 0 (0.00 %) | 149 ms | 452 ms | 81.1 req/s | ✅ |

Files: `load-tests/results/final-moderate.txt`, `load-tests/results/final-high.txt`.

The median stayed around 150 ms and throughput stayed close to the optimized result (~85 req/s), so the optimization still holds after the later changes. The higher p95 than in 5.1 comes from a few slow requests (max 1–2 s), most likely Neon pooler connection setup at the start of the run.

Note: load tests write real search logs, so they increase the search totals in analytics (visible as the 19 Nov spike in the 7-day activity).