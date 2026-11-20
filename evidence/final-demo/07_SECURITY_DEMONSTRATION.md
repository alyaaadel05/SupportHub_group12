# SupportHub — Security Demonstration

## Article Service
- Author ownership and role-based authorization
- CSRF and Origin protection
- Signed internal Editorial API
- UUID operationId idempotency
- Duplicate and conflicting transition protection

## Identity Service
- User authentication and session management
- Password hashing
- CSRF protection
- Role-based access restrictions
- Login rate limiting

## AWS Security
- Floci IAM enforcement enabled in shared infrastructure
- Article SQS publishing restricted to SendMessage
- Unauthorized GetQueueAttributes operation previously denied
- S3 and Secrets Manager integration

## Reliability
- Transactional PostgreSQL outbox
- Docker automatic scheduler
- Failed SQS delivery remains pending
- Automatic retry after recovery verified

## Demonstration evidence
- 05_ARTICLE_TEST_RESULTS.txt
- 06_IDENTITY_TEST_RESULTS.txt
- evidence/integration/real-outbox-retry.txt
- evidence/integration/retry-idempotency-tests.txt

## Important notes
- Code-pattern checks alone do not establish security correctness.
- Signed API and IAM behavior must be demonstrated with actual tests.
- Editorial end-to-end integration remains pending.
