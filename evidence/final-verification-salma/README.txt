SupportHub Group 12 - Salma final verification (Editorial Workflow & Publication)
Run by: Salma Osama (245536), Editorial owner
Date: 2026-11-27
Branch: salma/final-verification
Environment: local integrated stack (http://localhost:8088), Floci 2.4.0, Docker Desktop on Windows

Screenshots
- 00-sqs-consumer-log.png        : SQS consumer rejects a malformed event 5 times (no event ID) until SQS
                                   moves it to the dead-letter queue, then processes 3 real submissions
- 01-review-queue.png            : review queue filled through Article -> SQS -> Editorial consumer
- 02-approve-confirm.png         : approve confirmation for article 1
- 02b-approved.png               : "Review approved", article moves to Approved - Awaiting Publication
- 03-published.png               : publish (only approved articles get a Publish button)
- 04-editorial-history.png       : status timeline draft -> in_review -> approved -> published
- 05-reject-with-comment.png     : reject article 3 with the mandatory rejection reason
- 06-author-denied-page.png      : author opens review.html, frontend refuses the page
- 06b-author-denied-api.png      : author calls GET /api/reviews, Editorial backend refuses
                                   ("Reviewer permission required")
- 06c-author-denied-403.png      : same request in DevTools, status 403 Forbidden
- 07-unit-tests.png              : 183/183 Editorial unit tests pass
- 08-aws-services.png            : Editorial SQS, SNS, Lambda, Secrets Manager and IAM (names only, no values)
- 09-docker-running.png          : Editorial API and workers running in Docker
- 10-publication-worker-log.png  : SNS publication worker published the event

Other evidence from this run
- evidence/final/aws/aws-usage-20261127T163847Z.txt          : AWS usage run
- evidence/final/iam/iam-permission-tests-20261127T132351Z.txt : IAM tests, Editorial 11/11 PASS
                                                               (4 allowed, 7 denied as expected)

Notes
- Unit tests: in a fresh clone, 5 test files fail to load because db/pool.js requires DATABASE_URL.
  The unit tests mock the database, so they were run with a dummy value:
  DATABASE_URL=postgres://test:test@127.0.0.1:5999/test npm test
- Lambda receipts = 0 in this local run: the reused Floci 2.4.0 container cannot execute Lambdas
  (no Docker socket). Lambda execution evidence:
  evidence/cloud-architecture/step5-live-verification/03-live-aws-e2e.txt
  evidence/editorial-aws/05-persistent-receipts.txt
- No passwords, keys or secret values appear in any file.
- Checks were run with Claude assistance.