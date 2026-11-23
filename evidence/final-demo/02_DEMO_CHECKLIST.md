# SupportHub — Demonstration Checklist

## Infrastructure
- [ ] Show Docker Compose services
- [ ] Show healthy Floci
- [ ] Show Neon PostgreSQL connectivity

## Article Management
- [ ] Demonstrate CRUD and versioning
- [ ] Demonstrate article submission
- [ ] Show automatic outbox-to-SQS publishing

## Identity and Security
- [ ] Demonstrate login and sessions
- [ ] Explain CSRF, RBAC and IAM
- [ ] Show signed internal API and operationId idempotency

## Performance
- [ ] Present Article and Identity health load tests
- [ ] Present 10 concurrent authenticated logins
- [ ] Present 8 concurrent article submissions

## Failure Recovery
- [ ] Show pending event after SQS failure
- [ ] Show automatic retry and published status

## Final Integration
- [ ] Verify Editorial SQS consumption
- [ ] Verify Editorial-to-Article transitions
- [ ] Verify duplicate handling and recovery
- [ ] Show end-to-end workflow

## Submission
- [ ] Organize evidence
- [ ] Prepare individual contribution report
- [ ] Merge approved changes with teammates
