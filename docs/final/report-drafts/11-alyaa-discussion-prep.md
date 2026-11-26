# 11. Alyaa: Individual Discussion Prep (25 questions)

> Private preparation notes. Answer in your own words, and open the cited file during the
> discussion. Paths are relative to the repository root. `file:line` numbers are from the current
> branch, so check them once before the discussion.
>
> **Read before the session:** much of the integration, infrastructure and reliability work was
> AI-assisted. The examiner may ask you to explain any line, so read every cited function yourself.

---

## A. Article Management

**1. What does your Article Service do?**
It manages the article lifecycle for authors: create, edit and delete drafts, version history,
compare and restore, duplicate detection, Stack Exchange references and S3 backups. It also owns
categories. Status changes are allowed only along fixed paths, and only Editorial may move an
article beyond `in_review`.
Open: `services/article-service/services/articleService.js` (`create`, `update`, `remove`,
`transitionStatus`) and `services/article-service/routes/articleRoutes.js`.

**2. How do you stop one user editing another user's article?**
There are three layers. First, `requireRole("author","admin")` rejects guests with 401 and editors
with 403. Second, `canAccess` allows only an admin or the author whose ID matches `author_id`.
Third, `update` locks the row (`SELECT … FOR UPDATE`) inside a transaction, refuses anything that
isn't a draft, and the SQL itself filters on `author_id`.
Proved by ST-04 and ST-05: another author gets 403 (`evidence/final/e2e/lifecycle-20261125T185609Z.txt` §4).
Open: `services/article-service/middleware/security.js` (`requireRole`, `canAccess`),
`articleService.js` (`update`, `mine`: `WHERE author_id = $1`).

**3. How does versioning work, and what happens with concurrent edits?**
Each create or update inserts a row into `article_versions` in the same transaction as the article
change. `UNIQUE(article_id, version_number)` keeps the numbers distinct. Restore copies an old
version back as a new version, so history is never lost. In the test, 10 concurrent edits gave 11
versions with all numbers distinct (`evidence/final/alyaa/resilience-security-20261125T193131Z.txt`).
There is no optimistic locking yet, so the last write wins, but every edit is kept in the history.
Open: `services/article-service/services/versionService.js` (`list`, `restore`, `assertAuthorized`).

**4. How does duplicate detection work?**
`findDuplicates` breaks the title and content into word tokens. It computes a Jaccard similarity
for each and combines them as 65 % title and 35 % content. Results with a score of 25 or more are
returned, best first. It only compares against articles the user is allowed to see, so it can't
leak drafts.
Open: `services/article-service/services/duplicateService.js` (`tokens`, `jaccard`, `scoreArticle`, `findDuplicates`).

**5. How do Editorial and Article communicate safely?**
Editorial calls `PATCH /internal/articles/:id/status` with an HMAC-SHA256 signature over the
sender, timestamp, method, path and body hash. The timestamp must be within ±5 minutes. An
`operationId` stored in `article_transition_operations` makes a retried call idempotent, so a
retry can never apply the change twice. Unsigned, forged, expired or unknown-sender calls get 401
(ST-17, `evidence/final/alyaa/resilience-security-20261125T193131Z.txt`).
Open: `services/article-service/middleware/security.js` (`requireServiceSignature`),
`articleService.js` (`transitionEditorialStatus`).

## B. Outbox and SQS

**6. Why use the outbox instead of publishing to SQS directly?**
Publishing directly has a dual-write problem: the database commit could succeed while the SQS call
fails, or the other way round. Then the article would be `in_review` with no review, or a review
would exist for an unchanged article. With the outbox, `transitionStatus` writes the status change
**and** an `article_event_outbox` row in one transaction (`BEGIN … COMMIT`), so either both happen
or neither does. A separate worker publishes the row to SQS later and retries until it succeeds.
Open: `articleService.js` (`transitionStatus`, the `INSERT INTO article_event_outbox`),
`services/article-service/services/articleOutboxWorker.js` (`processOutbox`, `publishOne`).

**7. How does the outbox worker avoid double-publishing when there are several workers?**
`processOutbox` claims a pending row with `FOR UPDATE SKIP LOCKED`, so two workers never take the
same row. The row is marked `published` only after SQS accepts the message. On failure,
`attempts` and `last_error` are recorded and the row stays `pending`. Delivery is still
"at least once", so Editorial's inbox (`editorial_event_inbox`, with `event_id` as primary key)
acknowledges duplicates without side effects.
Open: `articleOutboxWorker.js`, `articleOutboxScheduler.js` (`runWorker`, which reschedules itself
with `setTimeout`).

**8. What happens if Floci is down?**
The Article API keeps working: the submission commits and the event stays `pending` in the outbox.
When Floci returns, the worker publishes it automatically, with no manual step. This was verified:
"HTTP 200, outbox pending" during the outage, then "published" after recovery
(`evidence/final/alyaa/resilience-security-20261125T193131Z.txt`). Features that call AWS
synchronously, such as the S3 backup, return 503 instead of crashing.
The bigger risk is the host: Floci must be running for the demo, and a restart takes about 4.5 min
(`evidence/cloud-architecture/02-ecs-on-floci.txt` §E).

**9. What is the DLQ for?**
If a message fails processing 5 times (`maxReceiveCount` 5), SQS moves it to the dead-letter queue,
so one bad message can't block the queue for ever. The consumer deletes a message only after its
database commit, so a crash means the message is redelivered, not lost.
Open: `infra/floci/floci-queues.sh`, which creates the queue, the DLQ and the redrive policy, and
`evidence/security-automation/FINAL_SUMMARY.txt` §9.

## C. Identity

**10. How does login work, and how are passwords stored?**
`registerUser` validates the password (12 to 72 bytes), hashes it with bcrypt cost 12, and always
stores the role `author`. Asking for `admin` still gives `author`. `loginUser` compares with bcrypt.
`authController.login` then calls `req.session.regenerate` to prevent session fixation and stores
the user in a PostgreSQL-backed session that all four services read.
Open: `services/identity-service/services/authService.js` (`registerUser`, `loginUser`),
`services/identity-service/controllers/authController.js` (`login`).

**11. How do you protect against brute force and bots?**
`sensitiveAuthLimiter` allows 30 login or registration attempts per 15 minutes, then returns 429.
This was verified against the production profile (`evidence/final/rate-limits/production-limits-20261125T193434Z.txt`).
Registration needs a Turnstile token checked server-side with Cloudflare's siteverify API, and
without one the request gets 400 (ST-14). Failed logins are written to `audit_logs` with the email
stored as a hash.
Open: `services/identity-service/server.js` (`sensitiveAuthLimiter`), `authController.js` (`verifyTurnstile`), `authService.js` (`auditLog`).

**12. How do you protect against CSRF and session theft?**
Every write needs a session-bound CSRF token, compared in constant time, and an allowed Origin;
otherwise it gets 403. The cookie `supporthub.sid` is HttpOnly, SameSite=Lax, Secure in production
and lasts 8 hours. Logout destroys the server-side session, so the cookie stops working on all four
services (ST-21).
Open: `services/identity-service/middleware/security.js` (`sessionMiddleware`, `requireCsrf`, `checkOrigin`).

## D. Cloud: Docker, Floci, ECS, Vercel

**13. Explain Docker vs Floci vs ECS vs Vercel.**
**Vercel** hosts the four APIs and is the only production API deployment. **Docker** is the
container runtime on the host machine; in production it runs Floci. **Floci** is an emulator of
the AWS APIs (S3, SQS, SNS, Lambda, DynamoDB, CloudWatch, Secrets Manager, IAM, ECS) with IAM
enforcement on. **ECS** is the AWS orchestrator inside Floci: it runs the three workers as real
containers and replaces them if they die. The local API containers are only for isolated testing.
Source: `evidence/cloud-architecture/06-unified-architecture.txt`.

**14. Why run the workers in ECS instead of plain Docker containers?**
ECS keeps `desiredCount`: a killed task was replaced in about 16 s
(`evidence/cloud-architecture/02-ecs-on-floci.txt` §A). Task definitions declare the image, the
environment and the secrets in one versioned file, and it's the same model real AWS uses.
Honest status: in production the ECS services are deployed with desiredCount 0, and the legacy
worker containers still carry production traffic until the cutover
(`evidence/cloud-architecture/step1-floci-recreation/STEP1-REPORT.txt`).
Open: `infra/floci/ecs/task-definitions/article-outbox-worker.json`, `infra/floci/ecs/deploy-ecs-workers.sh`.

**15. How do the Vercel APIs reach Floci on your host machine?**
Through a gateway: Vercel → a Cloudflare Worker on `*.workers.dev` → Workers VPC → a `cloudflared`
tunnel → Floci. No inbound port is opened. `withFlociAccess` adds the service-token headers
**after** SigV4 signing, so the signature stays valid, and the Worker checks them in constant time.
It's verified locally (9/9: no token or wrong token gets 403, and IAM is still enforced behind it)
but is **pending live deployment**.
Open: `services/*/config/flociAccess.js` (`withFlociAccess`),
`infra/cloudflare/floci-gateway/src/index.js` (`handle`, `authorizeAws`, `sameSecret`),
`evidence/cloud-architecture/05-remote-deployment-preparation.txt` §C.

## E. IAM and Secrets Manager

**16. How is IAM least privilege applied to your components?**
Article and Identity each have their own IAM user with resource-scoped policies. Article can only
Get and Put objects under `articles/*` in its own bucket (no Delete), send to its own queue, and
read its own secrets. Identity can read its secrets and publish to the alert topic. The final run
passed 47 checks with 0 failures and 1 emulator limit, using each component's own key
(`evidence/final/iam/iam-permission-tests-20261125T190729Z.txt`).
Open: `infra/iam/article-s3-policy.json`, `article-sqs-policy.json`, `article-secrets-policy.json`,
`identity-secrets-policy.json`.

**17. How does Secrets Manager work in your services?**
`start.js` calls `loadSecrets` before the server starts. It fetches the configured secret IDs,
copies only allow-listed keys into the environment, and never logs values. With
`SECRETS_REQUIRED=true` it fails closed: when the Article key asked for the Editorial secret, it
got `AccessDenied` and the service exited with code 1 (`evidence/final/aws/secrets-runtime-denial.txt`).
Open: `services/article-service/config/secrets.js` (`loadSecrets`, `fetchSecret`, `applySecret`),
`services/article-service/start.js` (`main`).

**18. What are Floci's security limits, and how did you compensate?**
- Floci does not enforce ECS task roles; it injects admin keys. Compensation: each task gets its own
  component key from Secrets Manager, and the injected session token is overwritten with `""`.
- It doesn't verify SigV4 and accepts its default admin credentials. Compensation: it listens on
  `127.0.0.1` only, so the LAN and Tailscale can't reach it (Step 1, §6).
- It serves unsigned S3 GETs, and it ignores the `cloudwatch:namespace` condition. Compensation:
  the buckets are private with Block Public Access on, and the condition is written for real AWS.
- These limits are reported as limitations, not claimed as passes.

Sources: `evidence/cloud-architecture/02-ecs-on-floci.txt` §A–B,
`evidence/cloud-architecture/step1-floci-recreation/STEP1-REPORT.txt` §6,
`evidence/search-aws/04-s3-object-verification.txt`.

## F. Bash automation

**19. What does `start-supporthub.sh` do?**
It's one command for the whole AWS layer:
- check the private inputs;
- check Floci, or recreate it with loopback binding and the Docker socket, keeping the data volume;
- create the buckets, queue and DLQ, topics, table, secrets, IAM, Lambda and SNS subscription;
- deploy the ECS workers;
- optionally start the tunnel.

Production changes need `SUPPORTHUB_PRODUCTION_APPROVED=true`, or it exits with code 3. It reuses
keys and never prints secrets. The production run passed AWS init 16/16 and ECS 13/13
(`evidence/cloud-architecture/step1-floci-recreation/STEP1-REPORT.txt` §4).
Open: `infra/floci/start-supporthub.sh` (`step`, `wait_healthy`).

**20. How do the scripts avoid creating duplicates or breaking production?**
They are idempotent: they check before creating (`queue_exists`, `ensure_secret`, `ensure_user`,
`policy_equal`). `start-production-workers.sh` refuses to start a second consumer on the same queue
(`other_consumers`, exit 3) and refuses risky configuration, such as the owner database role or
`sslmode=disable` (exit 2). The repeated-start test passed 21/21 with container, key and secret
counts unchanged (`evidence/security-automation/05-idempotency-verification.txt`).
Open: `infra/floci/start-production-workers.sh`, `infra/floci/floci-queues.sh`, `infra/floci/setup-supporthub.sh`.

## G. Security, testing and recovery

**21. Which security tests prove your controls?**
- ST-01: no session gets 401.
- ST-04 and ST-05: another user's article gets 403.
- ST-06 and ST-07: a forged CSRF token or foreign Origin gets 403.
- ST-08: SQL in an ID gets 400.
- ST-10: stored XSS comes back as inert text.
- ST-14: no Turnstile token gets 400.
- ST-15: login gets 429 after 30 attempts.
- ST-17: an HMAC forgery gets 401.
- ST-19: reading another component's secret is denied.
- ST-21: a session reused after logout gets 401.

All are listed with evidence in `docs/final/report-drafts/03-security.md` §3.2.

**22. What tests did you run, and what do they show?**
- Unit tests: Article 64/64 and Identity 32/32 (`evidence/final/integration/unit-tests-20261125T193654Z.txt`).
- End-to-end: 47/47.
- Resilience: Alyaa 18/18, part of 60/60.
- The k6 workflow test made 1,001 **authenticated** requests (Author 440, Editor 300, Reader 250)
  with 0 unexpected failures (`evidence/final/integration/load/workflow-20261125T193351Z-summary.md`).
- My earlier health-endpoint baselines were read-only. The first one showed 207 failures, caused
  by rate limiting, which is why I made the limits configurable per profile
  (`evidence/alyaa-final/load-tests/alyaa-baseline-diagnosis.txt`).

**23. How is the system recovered after a failure?**
- Events wait in the outbox and are retried. A bad message goes to the DLQ after 5 receives.
- ECS replaces dead tasks. After a Floci restart, the services come back and the startup script
  checks health, queues and IAM.
- Before recreating Floci in Step 1, I stopped it and archived its data volume (315 files, 23.7 MB).
  The resource inventory was identical afterwards
  (`evidence/cloud-architecture/step1-floci-recreation/STEP1-REPORT.txt` §2–3).

**24. What went wrong, and what did you learn?**
- My first load test failed 20.7 % of requests because the production rate limits applied to it.
  I added a separate load-test profile that production refuses.
- The production workers were first connected to the **development** database. I separated them,
  with their own queue, DLQ and IAM users (`evidence/production-integration/production-integration-results.txt`).
- An old database password was in Git history. It was rotated, and the old credential is rejected
  (`evidence/production-security/database-credential-rotation.txt`).
- Floci was exposed on all interfaces. Its port is now bound to loopback only.

**25. What is still not finished, or is limited?**
- The gateway and the Vercel environment variables are not deployed, so S3 backups from Vercel
  aren't available yet.
- The ECS cutover hasn't been done.
- The production CSP header isn't deployed.
- The revoked password is still in GitHub `refs/pull/1-8`.
- Identity SNS alert delivery has unit tests but hasn't been re-verified live.
- Rate-limit counters are per Vercel instance.
- About AI: I used Claude Code for much of the integration, infrastructure and reliability work. I
  directed and reviewed it, and the results come from the runs saved in `evidence/`.

All of these are listed in `evidence/INDEX.md` §6.
