# SupportHub Group 12 — Individual Contribution Statement

**Student Name:** Alyaa Adel  
**Student ID:** 241261  
**Project:** SupportHub — Cloud Computing & Security  
**Individual Responsibilities:** Article Management Service, Shared Identity Service, AWS/Floci Integration, Docker Infrastructure, Security, Reliability, Testing, and Frontend/API Integration.

## 1. Article Management Service

- Developed an independent Article Management backend using Node.js, Express, and Neon PostgreSQL.
- Implemented article creation, retrieval, updating, deletion, input validation, and status restrictions.
- Developed category management, including category creation, retrieval, updating, deletion, and validation.
- Implemented article ownership checks and role-based access control to prevent unauthorized access or modifications.
- Developed article version history, version comparison, and restoration of previous versions.
- Implemented duplicate detection using title and content similarity, with warnings before saving.
- Integrated the Stack Exchange API to retrieve real related technical questions and external references.
- Implemented the Submit for Review workflow, changing article status from `draft` to `in_review`.
- Added secure article backup and version retrieval using Amazon S3.
- Implemented protected internal APIs to support communication with Editorial and Search services.

## 2. Shared Identity and Authentication Service

- Developed the shared Identity Service using Node.js, Express, and PostgreSQL.
- Implemented user registration, login, logout, and authenticated user retrieval.
- Implemented secure password hashing using bcrypt.
- Configured shared PostgreSQL-backed sessions for authentication across services.
- Implemented role-based authorization and session validation.
- Added CSRF token generation and verification, Origin validation, and secure session handling.
- Implemented login and registration rate limiting to reduce automated abuse.
- Integrated Cloudflare Turnstile verification during registration.
- Implemented authentication audit events and verified shared login sessions between Identity and Article services.

## 3. AWS Cloud Services and Floci Integration

Implemented and tested three AWS services through Floci, satisfying the instructor's cloud requirement:

**Amazon S3**
- Implemented article version backups and retrieval.
- Tested successful retrieval, missing objects, and backup failures.
- Configured restricted IAM permissions and verified unauthorized operations were denied.

**Amazon SQS**
- Implemented asynchronous `article.submitted` event publishing.
- Created and configured article event queues.
- Integrated automatic delivery through a persistent PostgreSQL Outbox Worker.
- Tested queue unavailability, failed delivery, retry, and successful recovery.
- Configured least-privilege publishing permissions.

**AWS Secrets Manager**
- Implemented retrieval of runtime article backup configuration.
- Tested authorized and unauthorized secret access.
- Verified safe failure when Secrets Manager was unavailable or backup was disabled.

Also developed repeatable PowerShell scripts to configure Floci resources, S3, SQS, Secrets Manager, and IAM policies.

## 4. Docker, Database, and Infrastructure

- Created Docker configurations for the Article and Identity services.
- Dockerized the persistent Article Outbox Worker.
- Integrated Article, Identity, and Outbox Worker into the shared Docker Compose environment.
- Configured container networking, environment variables, and connectivity to Neon PostgreSQL and Floci.
- Implemented PostgreSQL database operations, transactions, article version storage, and event persistence.
- Created database migration `002` for idempotent Editorial status transitions.
- Verified worker restart behavior, automatic scheduling, and service connectivity.
- Prepared Development-specific configuration to isolate synthetic integration tests from existing events.

## 5. Microservice Communication and Reliability

- Implemented the PostgreSQL transactional outbox pattern to prevent article submission events from being lost.
- Developed automatic SQS event delivery, retry handling, and failure recovery.
- Implemented HMAC-signed internal APIs for authenticated service-to-service communication.
- Implemented UUID-based `operationId` idempotency, PostgreSQL advisory locking, and HTTP 409 conflict handling.
- Verified repeated operations do not create duplicate status transitions.
- Tested simultaneous requests and retry behavior using PostgreSQL.
- Prepared Article-to-Editorial API contracts, event formats, and technical integration documentation.
- Verified successful delivery of Article submission events without modifying unrelated messages.

## 6. Security, Threat Modeling, and Monitoring

- Implemented backend role-based access control, article ownership restrictions, CSRF protection, and Origin validation.
- Protected private articles, article versions, and sensitive operations from unauthorized access.
- Used parameterized PostgreSQL queries and secure request validation.
- Implemented HMAC authentication and replay-resistant internal operations.
- Applied least-privilege IAM policies to AWS resources.
- Developed a SupportHub-specific security threat model covering **9 threats**: SQL injection, XSS, broken object-level authorization, broken function-level authorization, CSRF, credential attacks, automated abuse, sensitive data exposure, and session hijacking. Documented their risks and corresponding mitigations, including parameterized queries, safe content rendering, backend authorization, CSRF protection, bcrypt, rate limiting, Turnstile, secret protection, and secure sessions.
- Implemented Article and Identity audit logging and backend error logging.
- Documented logging and monitoring in the architecture and data-model documentation.
- Captured Docker worker logs, SQS delivery logs, AWS failure-and-recovery evidence, health checks, and performance results.
- Performed Git security scanning using Gitleaks.

## 7. Testing, Performance, and Failure Recovery

Completed and documented the following tests:

| Test | Verified Result |
|---|---|
| Article Service automated tests | **46/46 passed** |
| Identity Service automated tests | **6/6 passed** |
| Focused Article security tests | **15 passed** |
| Concurrent authenticated logins | **10/10 successful** |
| Concurrent Article submissions | **8/8 successful** |
| Automatic SQS deliveries during concurrency testing | **8/8 successful** |
| Article health-load test | **100/100 passed** |
| Identity health-load test | **100/100 passed** |
| Load-test concurrency | **20 clients per service** |
| PostgreSQL idempotency and conflict handling | Passed |
| SQS failure, retry, and recovery | Passed |
| IAM allowed/denied operation tests | Passed |
| Signed internal API security tests | Passed |
| Docker worker restart and recovery | Passed |

**Performance measurements — November 22, 2026**

- **Article Service:** Average response 318.24 ms; P95 603.26 ms.
- **Identity Service:** Average response 311.93 ms; P95 578.53 ms.
- Both services completed 100 health-check requests with zero failures and 20 concurrent clients.

These measurements represent health-endpoint performance rather than complete transaction throughput.

## 8. Final Article-to-SQS Integration Demonstration

On November 22, 2026, successfully demonstrated the Article Service event-production workflow using Floci and Neon Development:

- Authenticated using an authorized author account.
- Created Development Article **21**.
- Submitted the article from `draft` to `in_review`.
- Verified creation of exactly one PostgreSQL `article.submitted` outbox event.
- Started the dedicated Article Outbox Worker.
- Verified automatic delivery to the Development SQS demo queue.
- Confirmed the event's outbox status changed to `published`.
- Verified that the demo queue contained one message while the original queue retained all 18 existing messages.
- Safely stopped the Outbox Worker after successful delivery.

**Event ID:** `fe8d6799-7ac3-4787-bdd7-c73507800bd3`

This confirmed reliable integration between Article Management, Neon PostgreSQL, the transactional outbox, and Floci SQS. The article itself remained `in_review` pending Editorial processing.

## 9. Frontend, GitHub, and Documentation

- Integrated frontend authentication and Article Management workflows with the backend APIs.
- Contributed frontend/API routing integration for Editorial review, publication, and Search/Analytics functionality.
- Worked using individual Git feature branches, commits, and Pull Requests.
- Prepared API documentation, architecture diagrams, database information, security evidence, AWS configuration documentation, and integration handoff instructions.
- Created automated test logs, performance results, screenshots, and failure-recovery evidence.
- Organized supporting technical evidence for the final group report and demonstration.
- Prepared my Individual Contribution Statement and technical evidence audit.

Some recent frontend changes and final GitHub cleanup remain subject to review and deployment verification.

## 10. Individual Contribution Summary

I was responsible for developing and testing the **Article Management Service and shared Identity Service**, including their database operations, authentication, security controls, AWS/Floci integrations, Docker infrastructure, asynchronous event processing, and reliability testing.

I also contributed to frontend/API integration, technical documentation, performance testing, threat modeling, and security verification.

My Article-to-SQS producer integration has been successfully demonstrated. The final Editorial event consumption and review workflow belong to **Salma**, while Search, Feedback, and Analytics belong to **Nermeen**. The complete deployed end-to-end demonstration remains a shared group responsibility.