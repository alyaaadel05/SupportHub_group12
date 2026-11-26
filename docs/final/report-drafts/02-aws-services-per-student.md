# 2. AWS Services per Student

> Draft for the group report.

- Only services with real application use are counted. No resource was added just to raise the
  count (`evidence/cloud-architecture/04-aws-services-per-student.txt`).
- All services run in Floci 2.5.0 with IAM enforcement turned on.
- Policies are in `infra/iam/` and `services/search-analytics-service/infra/iam/`.
- Each component has its own IAM user. Final allow/deny run: **47 pass, 0 fail, 1 not enforceable
  in Floci** (`evidence/final/iam/iam-permission-tests-20261125T190729Z.txt`).

## 2.1 Alyaa Adel: Article & Category Management and the shared Identity Service

| AWS service | What it is used for | IAM policy (actions → resource) | Evidence |
|---|---|---|---|
| S3 | Article version backups `articles/<id>/versions/<v>.json`, plus retrieval | `article-s3-policy.json`: `s3:GetObject`, `s3:PutObject` → `supporthub-article-backups/articles/*`; `s3:ListBucket` → the bucket. No Delete. | `evidence/final/aws/aws-usage-20261125T193434Z.txt`, `evidence/aws-verification/01-s3-retrieval.png` |
| SQS | Transactional outbox → `article.submitted` events, with a DLQ after 5 receives | `article-sqs-policy.json`, `production-article-sqs-publish-policy.json`: `sqs:SendMessage` → the article-events queue only | `evidence/integration/real-outbox-retry.txt`, `evidence/integration/isolated-floci-recovery-v2.txt`, `evidence/aws-verification/07-automatic-sqs-delivery.png` |
| Secrets Manager | Database URL, session secret, HMAC secret and runtime configuration, loaded at start-up (only names are logged) | `article-secrets-policy.json`, `identity-secrets-policy.json`: `secretsmanager:GetSecretValue` → own ARNs only | `evidence/final/aws/secrets-runtime-denial.txt` (cross-component read denied, service refuses to start) |
| IAM | Users `supporthub-article-service` and `supporthub-identity-service` with scoped policies | — | Article 14/14, Identity 8/8 (`docs/final/05-aws-iam-verification.md`), `evidence/final/iam/alyaa-iam-verification-20261125.txt` (15/15) |
| ECS | The Article Outbox Worker runs as an ECS service | `article-worker-task-policy.json`: `sqs:SendMessage`, `GetQueueUrl`, `GetQueueAttributes` → the article queues; `GetSecretValue` → `shared/database` | `evidence/cloud-architecture/02-ecs-on-floci.txt` (deploy 14/14, lifecycle 10/10) |
| SNS (partial) | Identity security-alert topic | `identity-sns-policy.json`: `sns:Publish` → `supporthub-identity-security-alerts` | 7 unit tests (`docs/final/01-alyaa-completion.md`). **Live delivery has not been re-verified** (`evidence/cloud-architecture/04-aws-services-per-student.txt`). |

## 2.2 Salma Osama: Editorial Workflow & Publication

| AWS service | What it is used for | IAM policy (actions → resource) | Evidence |
|---|---|---|---|
| SQS | Consumes article events. Inbox deduplication. Deletes the message only after the database commit. | `editorial-sqs-consumer-policy.json`, `production-editorial-sqs-consumer-policy.json`: `ReceiveMessage`, `DeleteMessage`, `ChangeMessageVisibility`, `GetQueueAttributes`, `GetQueueUrl` → the article-events queue | `evidence/editorial-aws/01-outdated-article-rereview.txt` (65/65), `evidence/integration/editorial-idempotency-postgres.txt` |
| SNS | Publication events, with retry and requeue of failed events | `editorial-sns-publish-policy.json`: `sns:Publish` → `supporthub-editorial-publication-events` | `evidence/editorial-aws/02-sns-configuration-and-iam.txt` (31/31), `03-sns-publication-notifications.txt` |
| Lambda | `supporthub-editorial-publication-outcome`, triggered by SNS. Writes a persistent, idempotent receipt. | Lambda role trusts `lambda.amazonaws.com`. `editorial-lambda-logs-policy.json`: `logs:CreateLogGroup/Stream`, `PutLogEvents` → its own log group only. | `evidence/editorial-aws/04-lambda-execution.txt` (10/10 + 10/10), `05-persistent-receipts.txt` (118 events, 118 receipts) |
| IAM | User `supporthub-editorial-service` (3 scoped policies) and the Lambda role | — | 14 unauthorised operations denied (`evidence/editorial-aws/02-sns-configuration-and-iam.txt`). Lambda IAM 18/18 (`06-editorial-security-and-recovery.txt`). Editorial 11/11 (`docs/final/05-aws-iam-verification.md`). |
| Secrets Manager | HMAC, database, session and cron secrets at start-up | `editorial-secrets-policy.json`: `GetSecretValue` → own ARNs only | `evidence/editorial-aws/FINAL_SUMMARY.txt`, `evidence/cloud-architecture/02-ecs-on-floci.txt` §B |
| CloudWatch Logs | Lambda log group `/aws/lambda/supporthub-editorial-publication-outcome` (22 streams, ERROR events for invalid payloads) | Same Lambda logs policy | `evidence/cloud-architecture/04-aws-services-per-student.txt` |
| ECS | Editorial Article Consumer and Publication Worker run as ECS services | `editorial-worker-task-policy.json`: SQS consume → the article queues; `sns:Publish` → the publication topic; `GetSecretValue` → `shared/database` and `shared/service-hmac` | `evidence/cloud-architecture/02-ecs-on-floci.txt` |

## 2.3 Nermeen Mostafa: Knowledge Search, Feedback & Analytics

| AWS service | What it is used for | IAM policy (actions → resource) | Evidence |
|---|---|---|---|
| DynamoDB | Live search-term and article-view counters, batched every 5 s | `search-analytics-policy.json`: `dynamodb:UpdateItem`, `dynamodb:Scan` → `table/supporthub-search-counters` | `evidence/search-aws/02-dynamodb-live-counters.txt` (17/17) |
| S3 | Analytics CSV export, listing and download | `s3:PutObject`, `s3:GetObject` → `supporthub-search-analytics-exports/exports/*`; `s3:ListBucket` with prefix `exports/*` | `evidence/search-aws/03-csv-export-generation.txt` (9/9), `04-s3-object-verification.txt` (12/13, emulator limit), `05-csv-download-validation.txt` (30/30) |
| CloudWatch | Metrics in `SupportHub/Search`: requests, errors, latency, searches, zero-result searches | `cloudwatch:PutMetricData` with `StringEqualsIfExists cloudwatch:namespace = SupportHub/Search` | `evidence/final/aws/aws-usage-20261125T193434Z.txt`. The namespace condition is not enforced by Floci (`docs/final/05-aws-iam-verification.md`). |
| IAM | User `search-analytics-service` with least privilege | — | `evidence/search-aws/01-iam-credential-verification.txt` (26/26 + 1 limit), `evidence/final/nermeen/team-floci-search-iam-20261125T193546Z.txt` (10/10) |
| Secrets Manager | Turnstile, database, session and HMAC secrets | `search-secrets-policy.json`: `GetSecretValue` → own ARNs only | `evidence/search-aws/01-iam-credential-verification.txt` |

## 2.4 Summary

| Student | Services counted | Evidence |
|---|---|---|
| Alyaa | 6: S3, SQS, Secrets Manager, IAM, ECS, plus SNS (partial) | `evidence/cloud-architecture/04-aws-services-per-student.txt` |
| Salma | 7: SQS, SNS, Lambda, IAM, Secrets Manager, CloudWatch Logs, ECS | same |
| Nermeen | 5: DynamoDB, S3, CloudWatch, IAM, Secrets Manager | same |

**Emulator limits:** Floci does not enforce ECS task roles. This is compensated by giving each task
its own component key. Floci also does not verify SigV4 signatures, serves unsigned S3 GETs, and
ignores the `cloudwatch:namespace` condition (`evidence/cloud-architecture/04-aws-services-per-student.txt`).
