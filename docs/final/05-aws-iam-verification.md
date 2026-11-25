# AWS and IAM verification

Verified 2026-11-25 on Windows / Docker Desktop, in the isolated stack (`supporthub-iso-*`:
own Floci 2.5.0 and own PostgreSQL) unless a line says otherwise. Neon, Vercel and Cloudflare were
not changed. Statuses: PASS (run and verified), IMPLEMENTED / NOT VERIFIED, FAIL, BLOCKED, OPTIONAL.

Evidence: `evidence/final/iam/iam-permission-tests-20261125T190729Z.txt` (final run). Every line used the component's own access key.

| Component (IAM user) | AWS services used | Result |
|---|---|---|
| Article, Alyaa (`supporthub-article-service`) | S3, SQS, Secrets Manager | 14/14 |
| Identity, Alyaa (`supporthub-identity-service`) | Secrets Manager, SNS | 8/8 |
| Editorial, Salma (`supporthub-editorial-service`) | SQS, SNS, Lambda, Secrets Manager | 11/11 |
| Search, Nermeen (`search-analytics-service`) | DynamoDB, CloudWatch, S3, Secrets Manager | 14/14 + 1 LIMIT |
| **Total** | | **47 pass, 0 fail, 1 not enforceable in Floci** |

## Finding and fix
A new test showed Search could write metrics to another CloudWatch namespace.

1. `...185257Z`: foreign namespace ALLOWED (FAIL). The policy had no condition.
2. `...185658Z`: with `StringEquals`, the service's own metrics were DENIED (FAIL). The likely cause is
   that Floci does not provide the `cloudwatch:namespace` key.
3. `...190053Z` onward: `StringEqualsIfExists`, meant to restrict the namespace on real AWS and keep
   Floci working. Floci still allows the foreign write, so it is reported as LIMIT, not PASS. It has
   not been tested on real AWS.

All five runs are kept, including the failing ones.

## Team Floci (`supporthub-floci`)
Existing resources were kept. Created because they were missing: bucket
`supporthub-search-analytics-exports`, user `search-analytics-service` with two inline policies, and
topic `supporthub-editorial-publication-events`. A temporary key was used for 10 checks (10/10 PASS) and
deleted. The test left one empty object, `exports/iam-probe.csv`, and one `IamProbe` metric.
Nothing else was tested there, because its queues feed workers that use Neon. It still has no
Editorial secrets, Lambda or dead-letter queue. The full AWS evidence is from the isolated stack.

## Runtime use
`evidence/final/aws/aws-usage-20261125T193434Z.txt`: 136 outbox events published and consumed, 105 SNS events and 105 Lambda receipts,
30 DynamoDB items, 7 application metrics, 5 CSV exports.
