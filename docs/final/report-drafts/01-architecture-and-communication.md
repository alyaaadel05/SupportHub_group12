# 1. Architecture and Communication

> Draft for the group report. Every number cites its evidence file. Paths are relative to the
> repository root.

## 1.1 One unified deployment

SupportHub runs as **one** application. Every component has exactly one production deployment
(`evidence/cloud-architecture/06-unified-architecture.txt`, target section).

| Layer | Production deployment | Role |
|---|---|---|
| Frontend | Cloudflare Pages `supporthub-group12.pages.dev` | Static HTML/CSS/JS pages. The only production frontend. |
| Proxy | Pages Function `frontend/functions/api/[[path]].js` | Same-origin `/api/*` proxy. Picks one of four origins (`IDENTITY_ORIGIN`, `ARTICLE_ORIGIN`, `EDITORIAL_ORIGIN`, `SEARCH_ANALYTICS_ORIGIN`) from the path and method. |
| APIs | 4 Vercel projects: Identity, Article, Editorial, Search & Analytics | The only production API deployment. |
| Database | Neon PostgreSQL (production branch) | One restricted role per service. The owner role is not used by any service. |
| AWS layer | Floci 2.5.0 on the host machine, started by `infra/floci/start-supporthub.sh` | S3, SQS + DLQ, SNS, Lambda, DynamoDB, CloudWatch, Secrets Manager, IAM, ECS. |
| Workers | ECS cluster `supporthub-workers` in Floci | Article Outbox Worker, Editorial Article Consumer, Editorial Publication Worker. |
| Vercel → Floci | Cloudflare Worker gateway, Workers VPC, `cloudflared` tunnel | **Pending live deployment** (see §1.5). |

Every API request from the production site reaches Vercel. Probes through the Pages site, covering
all four services and the methods GET, POST, PATCH and DELETE, each returned an `x-vercel-id`
header: **9/9** (`evidence/cloud-architecture/06-unified-architecture.txt` §3).

Diagram: `docs/architecture/supporthub_production_architecture.png` (also `.svg` and `.pdf`, with the
source in `.py`). It shows the target architecture described here.

## 1.2 Docker, Floci, ECS and Vercel: what each one is

| Technology | What it is in SupportHub | Production use |
|---|---|---|
| **Vercel** | Serverless hosting for the 4 Express APIs | The only place the APIs serve production traffic. |
| **Docker** | The container runtime on the host machine. It runs the Floci container. | Hosts Floci. The local API containers (`supporthub-article/identity/editorial`, `supporthub-iso-*`) are development and isolated-test copies only (`evidence/cloud-architecture/01-architecture-audit.txt` §1). |
| **Floci** | A local emulator of the AWS APIs, with IAM enforcement turned on | Provides the AWS services listed in §1.1. It listens on `127.0.0.1:4566` only (`evidence/cloud-architecture/step1-floci-recreation/STEP1-REPORT.txt` §3, §6). |
| **ECS (in Floci)** | The AWS container orchestrator, emulated by Floci. Floci runs ECS tasks as real Docker containers through the mounted Docker socket. | Runs the 3 background workers as ECS services. A killed task was replaced in about 16 s (`evidence/cloud-architecture/02-ecs-on-floci.txt` §A). |

**Current production state (honest status):**
- The ECS services are deployed in the main Floci with **desiredCount 0**
  (`evidence/cloud-architecture/step1-floci-recreation/STEP1-REPORT.txt` §4).
- Until the cutover, the legacy worker containers on the host machine still process production
  events.
- The production publication worker is not running yet, so one production SNS publication event
  (Article 21) is still pending (`evidence/cloud-architecture/05-remote-deployment-preparation.txt` §B).

The full ECS lifecycle has been verified in the isolated Floci: **10/10** and **10/10**
(`evidence/cloud-architecture/02-ecs-on-floci.txt` §C–D).

## 1.3 Startup: one Bash script

`bash infra/floci/start-supporthub.sh --env production` runs these steps in order:

1. Check the private inputs.
2. Check Floci, or recreate it: loopback-only binding, Docker socket mounted, data volume kept.
3. Create the AWS resources with `remote-init-aws.sh`: buckets, queue and DLQ, topics, table,
   secrets, IAM users and roles, Lambda, and the SNS → Lambda subscription.
4. Deploy ECS with `deploy-ecs-workers.sh`.
5. Optionally start `cloudflared`.

The script refuses production changes without explicit approval (exit 3). It reuses existing keys
and never prints secrets.

| Run | Result | Evidence |
|---|---|---|
| Production run (Step 1) | AWS init **16/16** PASS, ECS **13/13** PASS | `evidence/cloud-architecture/step1-floci-recreation/STEP1-REPORT.txt` §4, `master-script-run.txt` |
| Floci recreation | Resource inventory identical before and after (empty diff) | `inventory-diff-recreate.txt` |
| Approval guards | 3 refusal cases verified | `evidence/cloud-architecture/06-unified-architecture.txt` §1 |

## 1.4 Asynchronous flow: SQS, SNS and Lambda

```
Author submits ─► Article API (Vercel) ─► Neon: article status + article_event_outbox row (one transaction)
                                              │
                   Article Outbox Worker (ECS) ┘─► SQS supporthub-article-events-production ──(5 receives)──► DLQ
                                                        │
                   Editorial Article Consumer (ECS) ◄───┘  inbox dedupe ─► HMAC GET Article ─► create review
                                                           delete message only after commit
Editor publishes ─► Editorial API (Vercel) ─► Neon: editorial_publication_event_outbox row
                                                 │
                   Editorial Publication Worker (ECS) ─► SNS supporthub-editorial-publication-events
                                                           │
                   Lambda supporthub-editorial-publication-outcome ◄─┘ ─► Neon: idempotent receipt
```

| Measurement | Value | Evidence |
|---|---|---|
| Submission visible in the editor queue | 1.1 s | `docs/final/02-technical-evidence-pack.md` §15 |
| Submission visible in the queue (with ECS workers) | 4.1–6.3 s | `evidence/cloud-architecture/02-ecs-on-floci.txt` §C–D, `05-remote-deployment-preparation.txt` §E |
| Outbox events published and consumed | 136 | `evidence/final/aws/aws-usage-20261125T193434Z.txt` |
| Published events and Lambda receipts | 118 and 118, 0 missing | `evidence/editorial-aws/FINAL_SUMMARY.txt` |

## 1.5 Every service-to-service call

| # | From → To | Protocol | Authentication | Evidence |
|---|---|---|---|---|
| 1 | Browser → Cloudflare Pages | HTTPS | Session cookie `supporthub.sid` (HttpOnly, SameSite=Lax, Secure). CSRF token and Origin allow-list on every write. | `docs/final/02-technical-evidence-pack.md` §14, `evidence/final/e2e/lifecycle-20261125T185609Z.txt` §4 |
| 2 | Pages Function → 4 Vercel APIs | HTTPS, same-origin `/api/*` routing | Forwards the user's cookie and CSRF header. The API authenticates. | `evidence/cloud-architecture/06-unified-architecture.txt` §3 (9/9) |
| 3 | Vercel APIs → Neon | PostgreSQL over TLS (`sslmode=verify-full`, `channel_binding=require`) | One restricted role per service (`supporthub_{article,identity,editorial,search}_app`) | `evidence/final-security-search/01-vercel-and-docker-configuration.txt`, `evidence/production-security/database-credential-rotation.txt` |
| 4 | Editorial → Article (status transitions) | HTTPS REST | HMAC-SHA256 over sender, timestamp (±5 min), method, path and body hash. `operationId` makes retries idempotent. | `docs/final/02-technical-evidence-pack.md` §15, `evidence/final/alyaa/resilience-security-20261125T193131Z.txt` |
| 5 | Editorial → Search (index a published article) | HTTPS REST | HMAC-SHA256 | `docs/final/02-technical-evidence-pack.md` §15, `evidence/final-security-search/04-article-21-backend-index.txt` |
| 6 | Search → Article | HTTPS REST | HMAC-SHA256 | `docs/final/02-technical-evidence-pack.md` §15 |
| 7 | Editorial consumer (ECS) → Article API `GET /internal/articles/:id` | HTTPS. Plain HTTP is refused in production. | HMAC-SHA256 | `evidence/cloud-architecture/05-remote-deployment-preparation.txt` §E |
| 8 | Article Outbox Worker → SQS | AWS API, SigV4 | Worker IAM user, `sqs:SendMessage` on the production queue only | `infra/iam/production-article-sqs-publish-policy.json`, `evidence/security-automation/01-production-configuration-verification.txt` |
| 9 | Editorial consumer → SQS | AWS API, SigV4 | Receive, Delete and ChangeVisibility on the production queue only | `infra/iam/production-editorial-sqs-consumer-policy.json` |
| 10 | Publication Worker → SNS | AWS API, SigV4 | `sns:Publish` on the publication topic only | `infra/iam/editorial-worker-task-policy.json`, `evidence/editorial-aws/02-sns-configuration-and-iam.txt` |
| 11 | SNS → Lambda → Neon | SNS subscription, then PostgreSQL over TLS | Lambda role trusts `lambda.amazonaws.com` only and can write only to its own log group | `evidence/editorial-aws/06-editorial-security-and-recovery.txt` |
| 12 | ECS tasks → Secrets Manager | AWS API, SigV4 | Execution role reads `supporthub/ecs/*`. Each task receives its own component key. | `infra/iam/ecs-execution-secrets-policy.json`, `evidence/cloud-architecture/02-ecs-on-floci.txt` §B |
| 13 | Article API → S3 backups. Search → DynamoDB, S3 exports, CloudWatch. Identity → SNS alerts. | AWS API, SigV4, through the gateway | Component IAM key, plus Cloudflare service-token headers added **after** signing | `evidence/cloud-architecture/03-vercel-floci-connectivity.txt` (6/6), `05-remote-deployment-preparation.txt` §C (9/9). **Pending live deployment.** |
| 14 | Identity and Search → Cloudflare Turnstile siteverify | HTTPS | Server-side secret key | `evidence/production-integration/production-integration-results.txt` ("Turnstile verification: PASS") |
| 15 | Article → Stack Exchange API | HTTPS | Optional API key | `evidence/final/integration/screenshots/smoke-20261125T190715Z.txt` |

**Gateway (row 13): pending live deployment.**
- Design: Vercel function → Cloudflare Worker on `*.workers.dev` (checks the service token in
  constant time) → Workers VPC → `cloudflared` tunnel → Floci. There is no open inbound port.
- Verified locally with the real SDK clients: **9/9** (`evidence/cloud-architecture/05-remote-deployment-preparation.txt` §C).
  - Requests without the token, or with a wrong secret, get 403.
  - IAM is still enforced behind the gateway.
  - A binary body survives the round trip unchanged.
- Not yet done: the tunnel token, the Worker deployment, and the Vercel environment variables.
- Until then, the features that need the Vercel APIs to reach Floci are unavailable on Vercel: S3
  backups, DynamoDB counters, CSV export and CloudWatch metrics. CSV export returns a fast 503
  (`evidence/final-security-search/02-s3-csv-export-security.txt`).

## 1.6 Does Floci have to run during the demonstration?

Yes (`evidence/cloud-architecture/06-unified-architecture.txt` §5).

- **Needs Floci:** SQS submission, SNS → Lambda receipts, S3, DynamoDB, CloudWatch, Identity SNS
  alerts, and Secrets Manager for the workers.
- **Works without Floci:** login, article CRUD, search, feedback and the analytics overview.
- **While Floci is down:** events stay in the PostgreSQL outboxes and are delivered after it
  restarts (`evidence/final/alyaa/resilience-security-20261125T193131Z.txt`).
