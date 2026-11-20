# SupportHub Group 12 — Alyaa Individual Technical Evidence

Date: 20 November 2026
Owner: Alyaa Adel
Services: Article Management and shared Identity Service

## 1. Article Management
- Article CRUD, validation, versioning and ownership checks
- Role-based access controls, CSRF and Origin protection
- Draft to in_review submission
- PostgreSQL transactional outbox
- S3 article-version backup and retrieval
- Signed internal Editorial API
- UUID operationId idempotency and duplicate prevention

## 2. Identity Service
- Registration, login and shared PostgreSQL sessions
- Password hashing, role protection, CSRF and rate limiting
- Docker deployment on host port 3006

## 3. Cloud Infrastructure
- Docker containers for Article, Identity and Outbox Worker
- Floci emulation of AWS S3, SQS and Secrets Manager
- Restricted IAM permissions
- Automatic outbox scheduler with five-second interval

## 4. Verified Testing

Article automated tests: 46/46 passed
Identity automated tests: 6/6 passed

Article health endpoint:
- 100 requests, 20 concurrent clients
- HTTP 200: 100
- Average latency: 351.13 ms
- P95 latency: 785.47 ms
- Throughput: 51.25 requests/sec

Identity health endpoint:
- 100 requests, 20 concurrent clients
- HTTP 200: 100
- Average latency: 358.55 ms
- P95 latency: 755.02 ms
- Throughput: 52.03 requests/sec

Concurrent Article-to-SQS test:
- Batch: a22cbdb7
- Articles: 11 through 18
- Concurrent submissions: 8
- Successful submissions: 8
- Failed submissions: 0
- Submission duration: 1.49 seconds
- Automatically published outbox events: 8/8
- Attempts: 1 per event
- Last error: null for all eight

## 5. Remaining Verification
- Editorial consumer receives and handles Article events
- Full signed Editorial-to-Article HTTP integration
- End-to-end Editorial duplicate and retry behaviour
- Real SQS outage and automatic recovery
- Fresh infrastructure bootstrap in an isolated environment
- Additional scaling and performance measurements

## 6. Evidence Files
- article-identity-health-load.txt
- concurrent-article-sqs.txt
- independent-test-audit.txt

## 7. Scope Clarification
Alyaa owns Article Management and the shared Identity Service.
Salma owns Editorial Review and Publishing.
Nermeen owns Search, Feedback and Analytics.

Successful SQS publishing does not establish successful
Editorial event consumption.
