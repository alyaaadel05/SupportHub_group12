# Search & Analytics Service – AWS Service 1: DynamoDB (Floci)

## 1. What DynamoDB does in this service
DynamoDB keeps **live usage counters**:
- **Per search term:** how many times it was searched, and how many of those searches returned no results.
- **Per article:** how many times it was viewed.

These counters are updated on every real search (`GET /api/public/articles`) and every article view (`GET /api/public/articles/:id`), and read by reviewers/admins through `GET /api/analytics/live-counters`.

## 2. Table design
| Setting | Value |
|---|---|
| Table name | `supporthub-search-counters` (from `DYNAMODB_COUNTERS_TABLE`) |
| Partition key | `pk` (String) |
| Capacity | On-demand (`PAY_PER_REQUEST`) |
| Item for a search term | `pk = TERM#<lowercased term>`, `searches`, `zeroResults`, `updatedAt` |
| Item for an article | `pk = ARTICLE#<article id>`, `views`, `updatedAt` |

Counters are increased atomically with `UpdateItem` and `ADD`, so many users at the same time cannot overwrite each other's counts.

## 3. Neon vs DynamoDB – who is responsible for what
| | Neon PostgreSQL | DynamoDB |
|---|---|---|
| Role | **Source of truth** – full history | **Fast running totals** |
| Stores | Every search (`search_query_logs`) and every view (`article_views`) with timestamps | One counter per term and per article |
| Used for | Accurate analytics, audits, reports, CSV exports | Quick live counters that stay fast under heavy traffic (e.g. a whole university) |
| If unavailable | Search returns an error (database required) | Search **keeps working**; the counter update is skipped and logged |

If the two ever differ (for example, a search made while DynamoDB was down), **Neon is correct**. DynamoDB counters are never used to change Neon data.

## 4. How the code uses it
- `services/awsClients.js` – creates the AWS SDK clients. Region, endpoint (`AWS_ENDPOINT_URL`) and credentials come only from environment variables.
- `services/countersService.js` – `recordSearch()`, `recordView()` (writes) and `liveCounters()` (read: top 10 terms and top 10 articles).
- `services/searchService.js` – calls the counters after a search is logged and after a view is recorded. The call does not block the response.
- `GET /api/analytics/live-counters` – protected by `requireReviewer` (reviewer, editor\*, admin; others 401/403).

## 5. Failure handling and test (performed 19 Nov 2026)
| Step | Action | Result |
|---|---|---|
| 1 | Counters before test | `TERM#password = 2`, `TERM#banana = 1`, `ARTICLE#1 = 2` |
| 2 | `docker stop nermeen-floci` (DynamoDB unavailable) | – |
| 3 | `GET /api/public/articles?q=password` | **HTTP 200**, correct result; search saved in Neon |
| 4 | Service log | `DynamoDB counter update failed: AggregateError` (one safe line, no secrets, no crash) |
| 5 | `docker start nermeen-floci` | Container healthy again |
| 6 | Same search again, then scan the table | `TERM#password = 3` – old counters kept (persistent storage) and counting resumed **without restarting the service** |

Automated tests (`tests/dynamodb-counters.test.js`, 8 tests) also cover: correct keys, zero-result counting, empty searches skipped, missing table configuration, write failure and read failure.

## 6. How to check the data
```
export AWS_PROFILE=floci MSYS_NO_PATHCONV=1
aws dynamodb scan --table-name supporthub-search-counters \
  --query "Items[].[pk.S, searches.N, zeroResults.N, views.N]" --output table
```
Or Floci Dash: `http://localhost:4566/_floci/ui` → DynamoDB → `supporthub-search-counters`.

## 7. Limitations
- Counters are approximate if DynamoDB is temporarily down (those events are only in Neon).
- `liveCounters()` scans up to 500 items, which is enough for this project; a larger system would keep a separate "top terms" item or use a secondary index.
- Floci emulates AWS locally; on real AWS only the environment variables change (no endpoint, real credentials, IAM role).