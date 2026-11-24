# Individual Contribution Statements — SupportHub Group 12

Each statement is based on the Git history of `alyaaadel05/SupportHub_group12`
(all branches), the code and the evidence files. Students should read, correct and
sign their own statement before submission.

---

## Alyaa Adel (241261) — Article & Category Management Service and the shared Identity Service

**Article & Category Management (owner).** Implemented `services/article-service`
(20 of 21 commits on the folder, e.g. `eea4e20`, `b0e0f35`, `a33f26e`, `e81cd2a`):
article CRUD with validation and draft-only edit/delete; category management (in-use
categories protected); author ownership checks; version history, comparison and
restoration; Jaccard duplicate detection limited to accessible articles; Stack Exchange
related-question references; S3 article-version backup and retrieval; Secrets Manager
runtime configuration; restricted IAM policies (`infra/iam/article-*.json`); the
transactional PostgreSQL outbox, SQS publisher, automatic outbox scheduler and retry;
HMAC-protected internal endpoints with operation-ID idempotency for Editorial status
transitions; Docker image and Floci compose (`infra/floci/`); Article tests and k6 evidence.

**Shared Identity Service (designer, implementer and maintainer).** Implemented
`services/identity-service` (`f2eb4dd` "Complete Identity Service authentication and
security tests", `16d18af` "dockerize Identity Service and integrate with Floci stack",
`4b5147a`): registration, login, logout, bcrypt hashing, PostgreSQL-backed sessions
shared by all services, authentication and role middleware, CSRF tokens, Origin checks,
login/registration rate limiting (brute-force protection), Turnstile verification on
registration, audit logging, Docker integration and Identity security tests. Salma and
Nermeen **use** this shared service; its implementation is Alyaa's.

**Integration and coordination.** Merged the three feature branches into
`integration/group12-final`, built the frontend same-origin proxy and the editorial
frontend integration (`77c0fe6`, `40662f0`, `f536018`), configurable rate limits
(`bcf711c`) and the isolated load-test stack (`4708d08`).

## Salma Osama (245536) — Editorial Workflow & Publication Service

Implemented `services/editorial-service` (commits `c6102d7`, `a3cf090` "Complete editorial
workflow and publication integration" — 43 files, `3d97c20` "Complete Editorial service
security and integration" — 33 files): review queue, approve/reject with comments and
self-review prevention, publication management with idempotent workflow operations and
reconciliation, editorial history (status events), outdated-content flags with mandatory
resolution, SQS article-event consumer with a durable inbox for idempotency, HMAC service
client for Article and Search, publication notification outbox, SNS publication events and
the publication-outcome Lambda handler, migration runner with checksum and advisory locks,
Editorial threat model and HTTP-level security test evidence
(`services/editorial-service/docs/`), and the Editorial Docker setup. Her test suite
(169 tests) passes on the integration branch.

## Nermeen Mostafa (239814) — Knowledge Search, Feedback & Analytics Service

Implemented `services/search-analytics-service` (56 of 58 commits on the folder): published-only
search with category filter, ranking and pagination; article views and click tracking;
Turnstile-protected helpfulness votes (one per user) and feedback with optional sentiment
analysis; analytics overview (success rate, zero-result searches, unhelpful articles,
click-through rate) with caches and single-flight loading; DynamoDB live counters, CloudWatch
custom metrics and S3 CSV exports with a least-privilege IAM user
(`services/search-analytics-service/infra/`); signed Editorial → Search indexing; load tests up
to 1,000 users with bottleneck analysis and fixes (`SCALING.md`, `c3c6a46`, `b18352a`); Vercel
deployment and extensive evidence (`services/search-analytics-service/evidence/`). Her own
statement is preserved in `services/search-analytics-service/CONTRIBUTION.md`.

---

## Final integration work (2026-11-24) and AI-use disclosure

The final integration phase was carried out with the help of an AI coding assistant working
on `integration/group12-final` under the team's direction. Its commits are authored under the
assistant's own Git identity, not under any student's name, and are **not** claimed as any
student's independent work. It added: the integrated Floci stack and one-command setup script,
per-component IAM identities and policies for Editorial and Identity, the shared Secrets Manager
loader in all four services, rate-limit profiles and security-event logging, the outbox batch fix,
the end-to-end, browser, rate-limit and k6 workflow tests, frontend polish (existing design kept),
the security finding in `backend/.env.example`, and these documents. All results quoted were
produced by executed runs (`evidence/final/`). Students must follow the university's AI-use
disclosure rules when submitting.
