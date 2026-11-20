
# Editorial Service Security and Threat Model

## 1. Overview

The Editorial Service is an independent Express.js backend responsible for article review workflows, publication management, editorial flags, notifications, and processing Article Service events through Amazon SQS.

It communicates with the shared Identity Service for authenticated sessions, the Article Service for article information and status transitions, and the Search Service for publication notifications.

This document identifies the security assets, trust boundaries, potential threats, implemented controls, security testing, and remaining verification requirements for the Editorial Service.

## 2. Security Objectives

The Editorial Service aims to provide:

- Authentication of users before accessing protected editorial operations.
- Role-based authorization for authors, reviewers, and administrators.
- Protection against cross-site request forgery (CSRF).
- Secure communication between internal services.
- Protection of scheduled internal operations.
- Reliable processing of incoming Article Service events.
- Database access protection and transaction consistency.
- Auditability of editorial decisions and publication operations.
- Protection against unauthorized access to sensitive application data.

## 3. Assets Requiring Protection

| Asset                      | Security importance                                 |
| -------------------------- | --------------------------------------------------- |
| User sessions              | Prevent unauthorized account access                 |
| Editorial review records   | Preserve review confidentiality and integrity       |
| Article status information | Prevent unauthorized workflow transitions           |
| Reviewer decisions         | Preserve decision integrity and accountability      |
| Editorial flags            | Prevent unauthorized creation or resolution         |
| Publication records        | Prevent unauthorized publication changes            |
| Database credentials       | Prevent unauthorized database access                |
| Service shared secret      | Protect internal service authentication             |
| Session secret             | Protect session integrity                           |
| Cron secret                | Restrict scheduled internal operations              |
| SQS messages               | Preserve event integrity and processing reliability |
| Editorial event inbox      | Prevent duplicate event processing                  |

## 4. Trust Boundaries

### 4.1 Browser to Editorial Service

Browser requests are subject to session authentication, role authorization, CORS configuration, Origin validation, and CSRF protection for state-changing requests.

The complete browser-to-Editorial request flow must be verified through integration testing.

### 4.2 Identity Service to Editorial Service

The Editorial Service uses the shared PostgreSQL session store and the `supporthub.sid` session cookie.

The session secret, cookie configuration, and session table must remain consistent with the Identity and Article Services for shared authentication to work correctly.

Live cross-service session behavior remains subject to integration verification.

### 4.3 Editorial Service to Article Service

The Editorial Service retrieves article information and requests article status transitions through internal HTTP endpoints.

Outgoing requests use HMAC-SHA256 signatures containing the sender, timestamp, HTTP method, request path, and request-body hash.

The receiving Article Service must independently validate these signatures and enforce timestamp freshness and replay protection.

### 4.4 Editorial Service to Search Service

The Editorial Service sends publication notifications to the Search Service using the shared service-authentication mechanism.

The receiving Search Service must independently validate the authentication information before accepting internal requests.

### 4.5 Article Service to Editorial SQS Consumer

Article events are delivered through the SQS queue.

The Editorial consumer validates incoming event data, processes eligible events, and acknowledges successfully processed or confirmed duplicate messages.

Failed processing leaves messages eligible for redelivery. The configured dead-letter queue provides a separate destination for messages that exceed the permitted receive count.

Full integration with the actual Article event publisher remains subject to verification.

## 5. Threat Analysis

| Threat                          | Potential impact                             | Mitigation                                                      |
| ------------------------------- | -------------------------------------------- | --------------------------------------------------------------- |
| Unauthorized access             | Exposure or modification of editorial data   | Session authentication                                          |
| Privilege escalation            | Unauthorized review or publication decisions | Role-based authorization                                        |
| CSRF attacks                    | Unauthorized state-changing requests         | Origin and CSRF token validation                                |
| Session compromise              | Impersonation of authenticated users         | HTTP-only cookies and secure session configuration              |
| Internal service impersonation  | Unauthorized service requests                | HMAC-SHA256 request signatures                                  |
| Replay of internal requests     | Repeated execution of valid requests         | Timestamp-based signatures and receiver-side replay enforcement |
| Unauthorized scheduled requests | Abuse of notification retry operations       | Separate cron bearer secret                                     |
| SQL injection                   | Unauthorized database access or modification | Parameterized database queries                                  |
| Duplicate event delivery        | Duplicate editorial workflow records         | Event inbox and idempotent processing                           |
| Malformed SQS messages          | Processing errors or unexpected behavior     | Message validation and failure handling                         |
| Message processing failure      | Lost or delayed editorial events             | SQS visibility timeout, retries, and dead-letter queue          |
| Credential exposure             | Unauthorized database or service access      | Environment-based configuration and Git secret protection       |
| Denial of service               | Reduced service availability                 | Express rate limiting and request-size limits                   |

### 5.1 Required Editorial Threat Assessment

| ID | Threat scenario | Implemented mitigation and evidence | Status |
|---|---|---|---|
| S1 | Unauthorized review decisions | Authentication and reviewer/admin role middleware protect review operations. Automated tests cover unauthenticated access and author, reviewer, and administrator permissions. | Implemented; automated tests available |
| S2 | Author self-approval | The review workflow prevents an author from reviewing their own article. The automated test `decide prevents authors from reviewing their own articles` verifies this restriction. | Implemented; automated test available |
| S3 | Invalid review and publishing transitions | Workflow state validation prevents invalid decisions and publication without an approved review. Automated workflow tests cover review decisions, publication prerequisites, and transition failures. | Implemented; automated tests available |
| S4 | Duplicate SQS event delivery | The Editorial event inbox and idempotent processing prevent duplicate events from creating duplicate workflow records. Automated tests cover duplicate event handling; local Floci tests cover queue consumption and acknowledgement. | Implemented; local tests available |
| S5 | Forged internal Article requests | Editorial signs outgoing internal requests using HMAC-SHA256, including request details and a timestamp. Automated tests verify signature generation and signed transition requests. Verification by the receiving Article Service and full cross-service replay protection still require integration evidence. | Outgoing protection implemented; receiver integration pending |
| S6 | Malicious review comments and cross-site scripting (XSS) | Backend validation trims and limits comments to 2,000 characters and requires a non-empty explanation for rejection. The frontend renders review comments through `textContent`, not `innerHTML`, so supplied markup is treated as text. Validation tests cover required explanations and length limits. A browser-based malicious-payload test has not yet been recorded. | Input validation and safe rendering verified in source; browser test pending |

The status descriptions distinguish implemented Editorial controls from checks that depend on other services or a browser-based integration test. Local tests do not establish production or cross-service security.
## 6. Implemented Security Controls

### 6.1 Authentication

The `requireLogin` middleware validates the user information stored in the Express session.

Invalid or missing user IDs are rejected with HTTP 401.

Protected routes use authentication middleware before allowing access to their operations.

### 6.2 Role-Based Access Control

The Editorial Service uses role-based middleware:

- Authors can submit eligible articles for review.
- Reviewers can access review and editorial operations.
- Administrators have reviewer access and author permissions.
- Unauthorized roles are rejected with HTTP 403.

The `editor` role remains temporarily supported for compatibility until the existing privileged account is migrated to `reviewer`.

This compatibility allowance should be removed after the account migration is confirmed.

### 6.3 CSRF Protection

State-changing browser requests must provide:

- An Origin matching `FRONTEND_ORIGIN`.
- A valid session CSRF token.
- A matching `X-CSRF-Token` request header.

CSRF tokens must contain 64 hexadecimal characters and are compared using `crypto.timingSafeEqual`.

GET, HEAD, and OPTIONS requests do not require CSRF tokens.

Automated middleware tests cover valid and invalid Origin and CSRF token scenarios. The complete browser token-generation and submission flow still requires integration verification.

### 6.4 Internal Cron Authentication

The `/internal/retry-notifications` endpoint is protected by `requireCronSecret`.

The endpoint requires a bearer secret of at least 32 characters. The comparison uses constant-time comparison.

The example configuration specifies a separate cron secret. Deployment configuration must ensure that it is different from the session and service shared secrets.

### 6.5 Service-to-Service Authentication

The Editorial Service signs internal requests using HMAC-SHA256.

The signature payload includes:

- Service identity.
- Timestamp.
- HTTP method.
- Request path.
- SHA-256 hash of the request body.

The `SERVICE_SHARED_SECRET` must match the corresponding service configuration.

The receiving services must independently validate signatures and enforce timestamp freshness and replay protection.

Outgoing signature generation is implemented in the Editorial Service. Successful authentication against the receiving services must be confirmed through integration testing.

### 6.6 HTTP Security

The Express application uses Helmet, disables the `X-Powered-By` header, restricts JSON request bodies to 100 KB, and applies API rate limiting.

Session cookies are configured as HTTP-only with SameSite=Lax.

Secure cookies are enabled in production or when `COOKIE_SECURE=true`.

Production deployment must use HTTPS to protect session cookies and application traffic.

### 6.7 Database Security

Database credentials are loaded from environment variables.

The PostgreSQL connection pool uses TLS with certificate verification enabled through `rejectUnauthorized: true`.

Database operations should use parameterized queries to reduce SQL injection risk.

Transactions are used where multiple related database operations must remain consistent.

The event inbox migration must be applied to the shared database before relying on that database for event inbox processing.

### 6.8 Event Processing Reliability

The Editorial SQS consumer validates event messages and uses an event inbox to support duplicate detection.

Messages are acknowledged only after successful processing or confirmed duplicate handling.

Failed messages remain eligible for redelivery.

The local Floci environment was used to verify SQS message sending, receiving, consumer handling, acknowledgement, retry behavior, and dead-letter queue redrive.

The local redrive configuration uses a maximum receive count of five and a visibility timeout of 60 seconds.

These results demonstrate local queue behavior. They do not establish successful live integration with the Article Service publisher or production AWS infrastructure.

## 7. Security Testing

The current automated Editorial Service security tests cover:

- Missing authentication.
- Author and reviewer permissions.
- Administrator permissions.
- Invalid user IDs.
- Case-insensitive role handling.
- Missing and incorrect Origin headers.
- Missing and malformed CSRF tokens.
- Incorrect CSRF tokens.
- Valid CSRF requests.
- Safe HTTP methods.
- Missing, short, and incorrect cron secrets.
- Valid cron-secret authentication.

The latest complete Editorial Service test run reported:

**114 tests passed, 0 failed.**

These are automated test results. They do not independently establish production security, successful live integration, or complete deployment readiness.

## 8. Remaining Security Verification

The following activities require additional verification or completion:

1. Confirm that the receiving Article and Search Services validate HMAC signatures, timestamps, and replay protection.
2. Verify that the shared session works across Identity, Article, and Editorial Services in a live environment.
3. Confirm that the legacy `editor` role is migrated before removing compatibility.
4. Test the complete browser-to-Editorial CSRF flow, including token generation, delivery, and submission.
5. Verify production HTTPS and secure cookie behavior.
6. Confirm that `.env` and other secret-bearing files are excluded from Git and that no secrets have been committed.
7. Verify SQS message delivery, redelivery, and dead-letter behavior with the actual Article event publisher.
8. Apply and verify migration `005_editorial_event_inbox.sql` against the shared database after coordinating with the team.
9. Review dependency vulnerabilities regularly.
10. Confirm that internal service endpoints cannot be accessed without valid service authentication.
11. Verify the deployed environment variables and ensure that session, service, and cron secrets meet their required lengths and separation requirements.
12. Perform integration tests for publication notifications, article status transitions, and event processing across the participating services.

## 9. Security Limitations

Passing automated tests does not prove that all security controls are correctly enforced across deployed services.

The shared session configuration, service signatures, event contracts, database migrations, queue permissions, and production deployment must be verified through integration testing.

Local Floci testing demonstrates local SQS behavior but does not replace testing against the actual Article Service publisher or a production AWS environment.

The Editorial Service depends on the correct security configuration and behavior of the Identity, Article, and Search Services. Its security therefore cannot be assessed independently of those integration points.

Security controls must be reviewed whenever authentication, role definitions, service communication, or editorial workflow behavior changes.

## 10. Conclusion

The Editorial Service implements multiple layers of security, including session authentication, role-based access control, CSRF protection, Origin validation, internal cron authentication, signed outgoing service requests, HTTP security headers, database TLS, and reliable event-processing mechanisms.

Automated tests currently pass, and local SQS queue behavior has been tested using Floci.

Further integration, database, and deployment verification is required before claiming that the complete system is secure and production-ready.
