# SupportHub - Test Evidence Index

## Verified Results
- Article automated tests: 46/46 passed
- Identity automated tests: 6/6 passed
- Article health load: 100/100 HTTP 200
- Identity health load: 100/100 HTTP 200
- Concurrent Identity logins: 10/10 authenticated
- Concurrent Article submissions: 8/8 successful
- Automatic SQS publishing: 8/8 published
- Isolated SQS outage and recovery: passed
- Real Outbox automatic retry: passed

## Evidence Files
- article-identity-health-load.txt
- concurrent-article-sqs.txt
- identity-real-login-load.txt
- real-outbox-retry.txt
- isolated-floci-recovery-v2.txt
- retry-idempotency-tests.txt
- article-signed-http-verification.txt
- editorial-idempotency-postgres.txt
- article-deployment-verification.txt

## Missing Optional Evidence

## Limitations
- Health load tests do not measure full business operations.
- Current outbox publishing is sequential.
- Editorial SQS consumption is not yet verified.
- Full cross-service integration remains pending.
