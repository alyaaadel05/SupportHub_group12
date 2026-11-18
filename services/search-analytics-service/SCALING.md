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
| Pooled database connection (`DATABASE_URL_POOLED`, max 5 connections per instance) | Many instances share Neon's connection pooler instead of each opening many direct connections. |
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

## 5. Evidence
Scaling behaviour is measured with the k6 load tests in `load-tests/search-load-test.js` at low (5 users), moderate (25) and high (100) concurrent traffic. Results are recorded in the performance evidence.