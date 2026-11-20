# SupportHub Group 12 — Alyaa Contribution

Student: Alyaa Adel (241261)

## Article Management Service
- Article CRUD, validation and version history
- Ownership checks, RBAC and CSRF
- Draft submission and transactional outbox
- S3 backup and retrieval
- Signed Editorial-to-Article endpoint
- PostgreSQL operationId idempotency

## Identity Service
- Registration and login
- Password hashing and sessions
- CSRF and role-based authorization
- Rate limiting

## AWS and Docker
- Floci S3, SQS and Secrets Manager
- Least-privilege IAM
- Dockerized Article, Identity and Outbox Worker
- Automatic SQS publishing and failure recovery

## Verified tests
- Article: 46/46
- Identity: 6/6
- Concurrent logins: 10/10
- Concurrent Article submissions: 8/8
- Automatic SQS publishing: 8/8
- Actual outbox failure and retry: PASS

## Remaining team integration
- Salma: Editorial consumer and review workflow
- Nermeen: Search, Feedback and Analytics
- Shared end-to-end integration still requires testing
