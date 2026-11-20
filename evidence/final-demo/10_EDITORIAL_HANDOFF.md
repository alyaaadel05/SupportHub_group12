# SupportHub - Article to Editorial Integration Handoff

## Component ownership
Alyaa: Article Management, shared Identity, Article outbox publisher and signed Article API.
Salma: Editorial SQS consumer, review workflow and calls back to Article.

## Article service
Local Docker host URL: http://127.0.0.1:3005
Container service port: 3001
Remote testing previously succeeded through an authenticated Tailscale connection.
Do not assume localhost on another laptop reaches Alyaa's laptop.

## Article event publishing
Queue name: supporthub-article-events
Floci endpoint inside Docker: http://floci:4566
Local Floci endpoint: http://localhost:4566
Event type: article.submitted
Submitted Article status: in_review
Article outbox publisher: automatic Docker scheduler
Article publishing and recovery: verified

## Editorial integration requirements
1. Editorial needs its own configured SQS consumer and permissions.
2. Editorial must receive and parse article.submitted events.
3. Editorial must handle duplicate SQS deliveries safely.
4. Editorial must call the signed Article internal API.
5. Editorial must supply a valid UUID operationId for each transition.
6. A retry of the same logical transition must reuse its operationId.
7. Both services must agree on the exact signing contract and request body.
8. Article state must be verified in PostgreSQL after an Editorial action.

## Security
Never share session cookies, IAM secret keys or .env contents in GitHub.
Use individually configured local environment files.
Do not grant Editorial the Article publisher's IAM identity automatically.
Verify the required permissions separately.

## Integration tests pending
- Editorial SQS consumer receives a real submitted event.
- Duplicate delivery is handled correctly.
- Signed Editorial-to-Article request succeeds.
- Failed response is reconciled using the same operationId.
- Approved/rejected/published workflow is verified.
- End-to-end outage and recovery is verified.

## Important
Publishing to SQS is verified.
Editorial consumption and full workflow are NOT verified yet.
Do not enable automatic Editorial retries until the live integration checks pass.
