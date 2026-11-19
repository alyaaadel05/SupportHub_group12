# Search & Analytics Service – AWS Architecture (Floci)

## 1. Overview
```
Browser / other services
        │
        ▼
Search & Analytics Service (Express, port 3004)
   │            │                 │                 │
   ▼            ▼                 ▼                 ▼
 Neon       DynamoDB          CloudWatch            S3
(source   (live counters)   (custom metrics)  (private CSV reports)
of truth)
        └──────── all AWS calls use IAM user "search-analytics-service" ────────┘
```
All AWS resources run in **Floci** (local AWS emulator, `http://localhost:4566`, account `000000000000`, region `us-east-1`).
Region, endpoint and credentials come only from environment variables (`.env`), never from code.
Recreate everything with: `bash infra/setup-floci.sh` (safe to run twice).

## 2. The three AWS services
| Service | Resource | What the app does with it | Code |
|---|---|---|---|
| DynamoDB | Table `supporthub-search-counters` | +1 per search term / zero-result search / article view; reviewers read the top 10 (`GET /api/analytics/live-counters`) | `services/countersService.js` |
| CloudWatch | Namespace `SupportHub/Search` | Sends `Requests`, `LatencyMs`, `ClientErrors`, `ServerErrors`, `RateLimited`, `Searches`, `ZeroResultSearches` (batched every 10 s) | `services/metricsService.js`, `middleware/metrics.js` |
| S3 | Bucket `supporthub-search-analytics-exports` (public access blocked, AES256 encryption) | Reviewers create, list and download CSV analytics reports (`/api/analytics/exports`) | `services/exportService.js` |

Details: `AWS-DYNAMODB.md` (counters, Neon responsibility, failure test).

## 3. Why the CloudWatch metrics are meaningful
| Metric | What it tells us | Example action |
|---|---|---|
| `Requests` | Demand on the service | More traffic → plan scaling (see `SCALING.md`) |
| `LatencyMs` | How fast users get answers | Rising latency → check database / indexes |
| `ServerErrors` (5xx) | Something is broken | Investigate logs immediately |
| `ClientErrors` (4xx) | Bad input, missing login, forbidden access | A sudden spike can mean an attack or a broken frontend |
| `RateLimited` (429) | Clients sending too many requests | Possible abuse or a buggy client |
| `Searches` | How much people use search | Usage trends |
| `ZeroResultSearches` | Readers cannot find answers | Write the missing articles (knowledge gaps) |

Verified: 3 real searches → CloudWatch `Searches` Sum = 3.0.

## 4. S3 analytics export security
- Private bucket: public access blocked, default encryption AES256; each upload also requests AES256.
- Only `reviewer`, `editor`* and `admin` can create, list or download reports (others 401/403). Creating also requires Origin + CSRF checks.
- Reports contain only aggregate numbers, search terms and article titles – no user IDs, emails, sessions or feedback text.
- CSV-injection protection: cells starting with `=`, `+`, `-`, `@` are prefixed with `'` so Excel does not run them.
- Download names must match `analytics-YYYYMMDDTHHMMSSZ.csv` (blocks path tricks such as `../.env`).
- Verified: report values (19 searches, 7 zero-result, 5 views) matched Neon exactly.

\* `editor` allowed temporarily until the team renames it to `reviewer`.

## 5. IAM – least privilege
The service uses its own IAM user `search-analytics-service` (policy `infra/iam/search-analytics-policy.json`), not the Floci master keys.

| Allowed | On |
|---|---|
| `dynamodb:UpdateItem`, `dynamodb:Scan` | table `supporthub-search-counters` only |
| `cloudwatch:PutMetricData` | metrics (see Floci limitation below) |
| `s3:PutObject`, `s3:GetObject` | `supporthub-search-analytics-exports/exports/*` only |
| `s3:ListBucket` | that bucket, prefix `exports/` only |

**IAM test results (Floci with IAM enforcement on, 19 Nov 2026):**
| # | Action as `search-analytics-service` | Expected | Result |
|---|---|---|---|
| 1 | Scan own counters table | Allow | ✅ Allowed |
| 2 | Delete a DynamoDB table | Deny | ✅ AccessDenied (`dynamodb:DeleteTable`) |
| 3 | List own exports | Allow | ✅ Allowed |
| 4 | Delete an export file | Deny | ✅ AccessDenied (`s3:DeleteObject`) |
| 5 | List all buckets | Deny | ✅ AccessDenied (`s3:ListAllMyBuckets`) |
| 6 | Put metric in `SupportHub/Search` | Allow | ✅ Allowed |
| 7 | Service search + view + export using these keys | Allow | ✅ Counters, metrics and S3 report written |

## 6. Failure behaviour
- DynamoDB or CloudWatch down → search still returns 200; one safe log line (`... failed: <error name>`); recovers automatically (tested with `docker stop/start nermeen-floci`).
- S3 not configured → export returns 503; missing report → 404.

## 7. Floci limitations
- Floci does not evaluate the `cloudwatch:namespace` condition, so the metrics permission could not be limited to `SupportHub/Search` there. On real AWS add: `"Condition": {"StringEquals": {"cloudwatch:namespace": "SupportHub/Search"}}`.
- Floci runs only on the developer's laptop: a service hosted on Vercel cannot reach it, so the AWS demonstration is done locally.
- On real AWS only environment variables change: remove `AWS_ENDPOINT_URL`, use an IAM role instead of access keys, and use a globally unique bucket name.