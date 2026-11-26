# SupportHub Group 12: Evidence Index

Compiled 2026-11-26 on branch `integration/group12-final`. This index only reads the existing
evidence files. No test was re-run for it, and no infrastructure (Docker, Floci, workers,
Cloudflare, Vercel, Neon, production) was touched to write it.

Links are relative to this `evidence/` folder.

**Status key**

| Status | Meaning |
|---|---|
| ✅ DONE | Run and verified. The evidence file holds the output. |
| 🟡 PARTIAL | Part of the item is verified. The note says what is missing. |
| ⏳ PENDING | Not done yet. It needs a team action, an approval or an account. |
| 🧪 EMULATOR LIMIT | Floci 2.5.0 does not enforce this. It is configured correctly but only real AWS could prove it. |

Where an item was run several times, the **latest** run is cited. Earlier runs stay in the folders
for history (see [section 7](#7-superseded-and-stale-files)).

---

## 1. Instructor feedback: cloud architecture improvements

Source of the task list: [`cloud-architecture/FINAL_SUMMARY.txt`](cloud-architecture/FINAL_SUMMARY.txt),
with the later clarification in [`cloud-architecture/06-unified-architecture.txt`](cloud-architecture/06-unified-architecture.txt).

| # | Feedback item | Status | Evidence | Notes |
|---|---|---|---|---|
| F1 | Audit the architecture: what runs where, which copies are duplicates | ✅ DONE | [`cloud-architecture/01-architecture-audit.txt`](cloud-architecture/01-architecture-audit.txt) | 4 logical services and 3 workers. The Vercel APIs are the only production APIs. The Docker API containers are dev and test copies. |
| F2 | Remove the laptop dependency (production Floci and workers on a team laptop) | ✅ NOT REQUIRED (decision 2026-11-26) | [`cloud-architecture/06-unified-architecture.txt`](cloud-architecture/06-unified-architecture.txt) (update note), [`../infra/floci/start-supporthub.sh`](../infra/floci/start-supporthub.sh) | No remote host is needed: Floci runs on the host machine and is started by `start-supporthub.sh`. The remote rehearsal in [`05`](cloud-architecture/05-remote-deployment-preparation.txt) §E–H is kept for reference only. |
| F3 | Orchestrate the 3 background workers with ECS | ✅ DONE (isolated) / 🟡 PARTIAL (production) | [`cloud-architecture/02-ecs-on-floci.txt`](cloud-architecture/02-ecs-on-floci.txt), [`cloud-architecture/step1-floci-recreation/STEP1-REPORT.txt`](cloud-architecture/step1-floci-recreation/STEP1-REPORT.txt) | Isolated: real containers, 14/14 deploy, two full lifecycles 10/10 + 10/10, a killed task is replaced in about 10–16 s. Production: cluster `supporthub-workers` and 3 services exist at **desiredCount 0**. Not activated: the laptop workers still serve production. |
| F3b | Should the 4 APIs also move into ECS? | ✅ DONE (evaluated) | [`cloud-architecture/02-ecs-on-floci.txt`](cloud-architecture/02-ecs-on-floci.txt), [`../infra/floci/remote/README.md`](../infra/floci/remote/README.md) | Not recommended: keep the APIs on Vercel. The team still has to confirm this decision. |
| F4 | Communication between Vercel and Floci | 🟡 PARTIAL | [`cloud-architecture/03-vercel-floci-connectivity.txt`](cloud-architecture/03-vercel-floci-connectivity.txt) (6/6), [`cloud-architecture/05-remote-deployment-preparation.txt`](cloud-architecture/05-remote-deployment-preparation.txt) §C (gateway Worker 9/9) | Application side verified: SigV4 still works through the gate, requests without the token or with a wrong token get 403, and IAM is still enforced behind the gate. **Pending:** tunnel token, `wrangler` login, gateway deployment, Vercel environment variables (Article, Identity, Search) and a redeploy. |
| F5 | AWS services per student, counting only real application use | ✅ DONE (audit) | [`cloud-architecture/04-aws-services-per-student.txt`](cloud-architecture/04-aws-services-per-student.txt) | Alyaa 6 (Identity SNS alerts are PARTIAL), Salma 7, Nermeen 5. See [section 4](#4-aws-services-per-student). |
| F6 | Production architecture diagram | ✅ DONE | [`../docs/architecture/supporthub_production_architecture.png`](../docs/architecture/supporthub_production_architecture.png) (`.svg`, `.pdf`, source `.py`) | Re-rendered for the unified architecture ([`06`](cloud-architecture/06-unified-architecture.txt) §6). It shows the **target**, not today's state. |
| F7 | Public end-to-end verification of the new setup | ⏳ PENDING | — | Needs F4 deployed and the ECS cutover (pending items 2–4). The host machine must be running Floci during the test. |
| F8 | One unified application with no parallel deployments (instructor clarification) | ✅ DONE (design + rehearsal) | [`cloud-architecture/06-unified-architecture.txt`](cloud-architecture/06-unified-architecture.txt) | Frontend requests reach Vercel for every method and service (9/9 probes). One master script, [`../infra/floci/start-supporthub.sh`](../infra/floci/start-supporthub.sh), with approval guards. The production code path was rehearsed against the isolated Floci (AWS init 19/19, ECS 13/13). |
| F9 | Recreate the main Floci with ECS and Lambda support, bound to loopback only | ✅ DONE | [`cloud-architecture/step1-floci-recreation/STEP1-REPORT.txt`](cloud-architecture/step1-floci-recreation/STEP1-REPORT.txt), `inventory-*.txt`, `master-script-run.txt` | Backup taken first. The recreate diff is empty. Port is `127.0.0.1:4566`, unreachable from the LAN and Tailscale. Finding **S1** is resolved for the main Floci. The ECS and Lambda probes passed. |
| F10 | Does Floci have to run during the demo? | ✅ DONE (answered) | [`cloud-architecture/06-unified-architecture.txt`](cloud-architecture/06-unified-architecture.txt) §5 | **Yes.** The file lists which features need Floci and which work with Vercel and Neon alone. |
| — | Lab 10 | ⏳ SKIPPED | [`cloud-architecture/01-architecture-audit.txt`](cloud-architecture/01-architecture-audit.txt) header | The cloud-course Lab 10 is not on this machine. It was skipped on instruction. |

## 2. Instructor feedback: component and security follow-ups

| # | Feedback item | Status | Evidence | Notes |
|---|---|---|---|---|
| E1 | Editorial: outdated-article re-review lifecycle | ✅ DONE | [`editorial-aws/01-outdated-article-rereview.txt`](editorial-aws/01-outdated-article-rereview.txt) | 65/65 after fixes. D1 (duplicate re-reviews) and D2 (self re-review) are fixed. **Pending:** apply migration 008 to Neon (dev, then production) before deploying the new Editorial code. |
| E2 | Editorial: SNS configuration and IAM | ✅ DONE + 🧪 | [`editorial-aws/02-sns-configuration-and-iam.txt`](editorial-aws/02-sns-configuration-and-iam.txt) | 31/31. 14 unauthorised operations are denied. Floci does not verify SigV4. |
| E3 | Editorial: SNS publication notifications and recovery | ✅ DONE | [`editorial-aws/03-sns-publication-notifications.txt`](editorial-aws/03-sns-publication-notifications.txt) | D3 (failed events never retried) is fixed with `POST /internal/retry-publication-events`. No scheduler is configured for it yet. |
| E4 | Editorial: Lambda execution | ✅ DONE | [`editorial-aws/04-lambda-execution.txt`](editorial-aws/04-lambda-execution.txt) | 10/10 end-to-end and 10/10 invalid-payload checks. |
| E5 | Editorial: persistent Lambda receipts | ✅ DONE | [`editorial-aws/05-persistent-receipts.txt`](editorial-aws/05-persistent-receipts.txt) | Duplicate deliveries 5/5, persistence across restarts 8/8. 118 events and 118 receipts. |
| E6 | Editorial: Lambda IAM, failure and retry | ✅ DONE | [`editorial-aws/06-editorial-security-and-recovery.txt`](editorial-aws/06-editorial-security-and-recovery.txt) | IAM 18/18, retry 7/7. Summary: [`editorial-aws/FINAL_SUMMARY.txt`](editorial-aws/FINAL_SUMMARY.txt). |
| S1 | Search: dedicated IAM credential | ✅ DONE + 🧪 | [`search-aws/01-iam-credential-verification.txt`](search-aws/01-iam-credential-verification.txt) | 26/26. Floci ignores the `cloudwatch:namespace` condition. |
| S2 | Search: DynamoDB live counters | ✅ DONE | [`search-aws/02-dynamodb-live-counters.txt`](search-aws/02-dynamodb-live-counters.txt) | 17/17. |
| S3 | Search: CSV export to S3 (generate, verify, download) | ✅ DONE + 🧪 | [`search-aws/03-csv-export-generation.txt`](search-aws/03-csv-export-generation.txt), [`04-s3-object-verification.txt`](search-aws/04-s3-object-verification.txt), [`05-csv-download-validation.txt`](search-aws/05-csv-download-validation.txt), [`05-downloaded-export-sample.csv.txt`](search-aws/05-downloaded-export-sample.csv.txt) | 9/9, 12/13 and 30/30. The one failure is the emulator limit: Floci serves unsigned S3 GETs. Summary: [`search-aws/FINAL_SUMMARY.txt`](search-aws/FINAL_SUMMARY.txt). |
| S4 | Search: CSV export security and fast failure when S3 is unreachable | ✅ DONE + 🧪 | [`final-security-search/02-s3-csv-export-security.txt`](final-security-search/02-s3-csv-export-security.txt) | Returns 503 within 3–8 s. CSV export cannot work on Vercel until F4 is done. |
| S5 | Search: feedback sentiment and its recovery | ✅ DONE | [`final-security-search/03-feedback-sentiment-verification.txt`](final-security-search/03-feedback-sentiment-verification.txt) | 42/42 and 20/20 retests. D-S1 and D-S2 are fixed. The reprocess job is not scheduled. |
| S6 | Search: Article 21 in the backend index | ✅ DONE | [`final-security-search/04-article-21-backend-index.txt`](final-security-search/04-article-21-backend-index.txt) | 11/11. |
| P1 | Vercel services and Docker workers use restricted database roles | 🟡 PARTIAL | [`final-security-search/01-vercel-and-docker-configuration.txt`](final-security-search/01-vercel-and-docker-configuration.txt), [`security-automation/01-production-configuration-verification.txt`](security-automation/01-production-configuration-verification.txt) | 24/24 and 11/11. **Pending:** read the values stored in the Vercel dashboard. Finding F1: the stale project `supporthub-editorial-service.vercel.app` returns health 500. |
| P2 | Production integration (workers on the production database, separate queue and DLQ) | ✅ DONE | [`production-integration/production-integration-results.txt`](production-integration/production-integration-results.txt) | Live Article 21 run, creation through outdated flag: all PASS. |
| P3 | Rotate the database credential and move services to restricted roles | ✅ DONE | [`production-security/database-credential-rotation.txt`](production-security/database-credential-rotation.txt) | The old credential is rejected. 32/32 permission checks and 4/4 authentication checks. |
| P4 | Final repository secret scan | 🟡 PARTIAL | [`security-automation/02-final-repository-secret-scan.txt`](security-automation/02-final-repository-secret-scan.txt) | Tree and 13/13 remote branches are clean. **Pending:** GitHub Support must purge `refs/pull/1-8`, which still hold the revoked password. Do not push obsolete local refs (`git push --all` or `--tags`). |
| P5 | Startup automation for the production workers | ✅ DONE | [`security-automation/03-production-startup-script.txt`](security-automation/03-production-startup-script.txt) | `--verify-only` 29/29. |
| P6 | Floci and queue initialisation automation | ✅ DONE | [`security-automation/04-floci-queue-automation.txt`](security-automation/04-floci-queue-automation.txt) | 21/21. The paused-Floci defect is fixed. |
| P7 | Prevent duplicate containers and IAM keys | ✅ DONE | [`security-automation/05-idempotency-verification.txt`](security-automation/05-idempotency-verification.txt) | 21/21. Read the RESUMED section; it supersedes the "RUN STOPPED" note. |
| P8 | Safe startup and recovery | ✅ DONE | [`security-automation/06-startup-recovery-tests.txt`](security-automation/06-startup-recovery-tests.txt) | 38 pass, plus 1 failure that was fixed and re-run as PASS. A production restart was not tested, by restriction. Summary: [`security-automation/FINAL_SUMMARY.txt`](security-automation/FINAL_SUMMARY.txt). |
| P9 | Floci exposed on all interfaces (finding S1) | ✅ DONE | Fix: [`final-security-search/FINAL_SUMMARY.txt`](final-security-search/FINAL_SUMMARY.txt). Applied: [`STEP1-REPORT.txt`](cloud-architecture/step1-floci-recreation/STEP1-REPORT.txt) §6 | The loopback binding is now live on the main Floci. |
| L1 | Load test with about 1,000 requests, split into Author, Editor and Reader traffic, including write workflows | ✅ DONE | [`final/integration/load/workflow-20261125T193351Z-summary.md`](final/integration/load/workflow-20261125T193351Z-summary.md) (+ `.json`) | 1,001 requests, 0 unexpected failures. Author 440, Editor 300, Reader 250. p95 192.7 ms. The earlier read-only test is [`integration/load/LOAD_TEST_REPORT.md`](integration/load/LOAD_TEST_REPORT.md). |

## 3. Coursework brief (26CSCN29H) requirements

Base matrix: [`../docs/final/04-requirements-compliance-matrix.md`](../docs/final/04-requirements-compliance-matrix.md)
(2026-11-25). Statuses below include the evidence added on 2026-11-26.

| Requirement | Status | Evidence |
|---|---|---|
| S2 Browser frontend using real APIs | ✅ DONE | [`final/integration/screenshots/smoke-20261125T190715Z.txt`](final/integration/screenshots/smoke-20261125T190715Z.txt) (20/20), screenshots `final/integration/screenshots/01–08*.png`, before and after: `final/frontend/before-after/` |
| S2 Three components, each with 3+ functions | ✅ DONE | [`../docs/final/01-alyaa-completion.md`](../docs/final/01-alyaa-completion.md), [`02-salma-completion.md`](../docs/final/02-salma-completion.md), [`03-nermeen-completion.md`](../docs/final/03-nermeen-completion.md) |
| S2 HTTP/REST API and status codes | ✅ DONE | [`final/e2e/lifecycle-20261125T185609Z.txt`](final/e2e/lifecycle-20261125T185609Z.txt) (47/47) |
| S2 Persistent data store | ✅ DONE | e2e above, [`production-integration/production-integration-results.txt`](production-integration/production-integration-results.txt) |
| S2 Two or more roles, enforced in the backend | ✅ DONE | e2e §4, [`final/iam/`](final/iam/), 160 expected denials in the k6 run |
| S2 External API (Stack Exchange, Turnstile) | ✅ DONE | smoke and e2e above. A live production Turnstile success is in [`production-integration/production-integration-results.txt`](production-integration/production-integration-results.txt) ("Turnstile verification: PASS"). |
| S2/S4 Deployed cloud version | 🟡 PARTIAL | Live and healthy: [`final/integration/production-read-only-probe-20261125T193623Z.txt`](final/integration/production-read-only-probe-20261125T193623Z.txt), Vercel health 4/4 in [`STEP1-REPORT.txt`](cloud-architecture/step1-floci-recreation/STEP1-REPORT.txt). **The branch is not deployed** (no CSP header in production). |
| S3 Logs and monitoring | ✅ DONE | [`final/aws/aws-usage-20261125T193434Z.txt`](final/aws/aws-usage-20261125T193434Z.txt), Lambda CloudWatch Logs in [`cloud-architecture/04`](cloud-architecture/04-aws-services-per-student.txt) |
| S3 Secrets kept out of source code | 🟡 PARTIAL | Rotation: [`production-security/database-credential-rotation.txt`](production-security/database-credential-rotation.txt). Scan: [`security-automation/02-final-repository-secret-scan.txt`](security-automation/02-final-repository-secret-scan.txt). Shared Secrets Manager: [`final/aws/secrets-runtime-denial.txt`](final/aws/secrets-runtime-denial.txt). The revoked value remains in GitHub `refs/pull/1-8`. |
| S4 Testing of the integrated **deployed** application | 🟡 PARTIAL | The production lifecycle for Article 21 passed ([`production-integration`](production-integration/production-integration-results.txt)). The production SNS publication to Lambda receipt step was not run: 1 event is still pending because the publication worker is not running in production ([`05`](cloud-architecture/05-remote-deployment-preparation.txt) §B). |
| S5 Authentication, authorisation, ownership, validation | ✅ DONE | [`../docs/final/07-security-test-results.md`](../docs/final/07-security-test-results.md), [`security/`](security/), [`final/security/extra-security-checks.txt`](final/security/extra-security-checks.txt) |
| S5 Least privilege | ✅ DONE + 🧪 | [`final/iam/iam-permission-tests-20261125T190729Z.txt`](final/iam/iam-permission-tests-20261125T190729Z.txt) (47 pass, 1 emulator limit), [`final/iam/alyaa-iam-verification-20261125.txt`](final/iam/alyaa-iam-verification-20261125.txt) (15/15), [`search-aws/01`](search-aws/01-iam-credential-verification.txt), [`editorial-aws/02`](editorial-aws/02-sns-configuration-and-iam.txt), [`editorial-aws/06`](editorial-aws/06-editorial-security-and-recovery.txt) |
| S5 Shared responsibility, recovery and limitations (written) | 🟡 PARTIAL | [`../docs/final/02-technical-evidence-pack.md`](../docs/final/02-technical-evidence-pack.md). The students must check the wording. |
| S9.2 Threat model with 6+ threats | ✅ DONE | [`../docs/threat-model.md`](../docs/threat-model.md), evidence pack §24 (12 threats) |
| S9.2 Eight or more security tests | ✅ DONE | [`../docs/final/05-security-tests.md`](../docs/final/05-security-tests.md), [`../docs/final/07-security-test-results.md`](../docs/final/07-security-test-results.md) |
| S7.2 Responsibility matrix, demo plan, contribution statements | 🟡 PARTIAL (drafts) | [`../docs/final/06-contribution-statements.md`](../docs/final/06-contribution-statements.md) (counts are out of date, see §7), [`../docs/final/07-demo-plan.md`](../docs/final/07-demo-plan.md) |
| S9.3 Repository evidence per student | 🟡 PARTIAL | [`../docs/final/09-changed-files-and-ownership.md`](../docs/final/09-changed-files-and-ownership.md). Many changes are still uncommitted, and the owners must review and commit them. |
| S10 Live demonstration and discussion | ⏳ PENDING | Students only. Floci must run during the demo ([`06`](cloud-architecture/06-unified-architecture.txt) §5). |
| S11 AI-use rules and disclosure | ⏳ PENDING | Students must check the module rules. The evidence files record that Claude Code assisted. |

## 4. AWS services per student

From [`cloud-architecture/04-aws-services-per-student.txt`](cloud-architecture/04-aws-services-per-student.txt). Only real application use is counted.

| Student | Service | Status | Evidence |
|---|---|---|---|
| **Alyaa** (Article, Identity) | S3 version backups | ✅ | [`final/aws/aws-usage-20261125T193434Z.txt`](final/aws/aws-usage-20261125T193434Z.txt), screenshot [`aws-verification/01-s3-retrieval.png`](aws-verification/01-s3-retrieval.png) |
| | SQS outbox and DLQ | ✅ | [`integration/real-outbox-retry.txt`](integration/real-outbox-retry.txt), [`integration/isolated-floci-recovery-v2.txt`](integration/isolated-floci-recovery-v2.txt), [`aws-verification/07-automatic-sqs-delivery.png`](aws-verification/07-automatic-sqs-delivery.png), [`aws-verification/11-sqs-failure-recovery.png`](aws-verification/11-sqs-failure-recovery.png) |
| | IAM | ✅ | [`final/iam/alyaa-iam-verification-20261125.txt`](final/iam/alyaa-iam-verification-20261125.txt), [`aws-verification/02-iam-denied.png`](aws-verification/02-iam-denied.png) |
| | Secrets Manager | ✅ | [`final/aws/secrets-runtime-denial.txt`](final/aws/secrets-runtime-denial.txt), [`aws-verification/04-secrets-manager-iam.png`](aws-verification/04-secrets-manager-iam.png), [`05-secrets-config.png`](aws-verification/05-secrets-config.png) |
| | ECS (Article outbox worker) | ✅ | [`cloud-architecture/02-ecs-on-floci.txt`](cloud-architecture/02-ecs-on-floci.txt) |
| | SNS (Identity security alerts) | 🟡 PARTIAL | The code and topic exist. **Live alert delivery has not been re-verified.** |
| **Salma** (Editorial) | SQS consumer and inbox | ✅ | [`editorial-aws/01`](editorial-aws/01-outdated-article-rereview.txt), [`final/salma/`](final/salma/), [`integration/editorial-idempotency-postgres.txt`](integration/editorial-idempotency-postgres.txt) |
| | SNS | ✅ | [`editorial-aws/02`](editorial-aws/02-sns-configuration-and-iam.txt), [`03`](editorial-aws/03-sns-publication-notifications.txt) |
| | Lambda | ✅ | [`editorial-aws/04`](editorial-aws/04-lambda-execution.txt), [`05`](editorial-aws/05-persistent-receipts.txt), [`06`](editorial-aws/06-editorial-security-and-recovery.txt) |
| | IAM | ✅ | [`editorial-aws/02`](editorial-aws/02-sns-configuration-and-iam.txt), [`06`](editorial-aws/06-editorial-security-and-recovery.txt) |
| | Secrets Manager | ✅ | [`editorial-aws/`](editorial-aws/), [`cloud-architecture/02`](cloud-architecture/02-ecs-on-floci.txt) |
| | CloudWatch Logs | ✅ | [`cloud-architecture/04`](cloud-architecture/04-aws-services-per-student.txt) (read-only query recorded there) |
| | ECS (consumer and publication worker) | ✅ | [`cloud-architecture/02-ecs-on-floci.txt`](cloud-architecture/02-ecs-on-floci.txt) |
| **Nermeen** (Search, Analytics) | DynamoDB | ✅ | [`search-aws/02`](search-aws/02-dynamodb-live-counters.txt) |
| | S3 CSV export | ✅ + 🧪 | [`search-aws/03–05`](search-aws/), [`final-security-search/02`](final-security-search/02-s3-csv-export-security.txt) |
| | CloudWatch metrics | ✅ + 🧪 | [`final/aws/aws-usage-20261125T193434Z.txt`](final/aws/aws-usage-20261125T193434Z.txt) |
| | IAM | ✅ | [`search-aws/01`](search-aws/01-iam-credential-verification.txt), [`final/nermeen/team-floci-search-iam-20261125T193546Z.txt`](final/nermeen/team-floci-search-iam-20261125T193546Z.txt) (10/10) |
| | Secrets Manager | ✅ | [`search-aws/01`](search-aws/01-iam-credential-verification.txt) |

**Emulator limits that affect these items:** Floci does not enforce ECS task roles (this was
compensated), does not verify SigV4, serves unsigned S3 GETs, and ignores the `cloudwatch:namespace`
condition.

## 5. Final submission checklist

Source: [`../docs/final/10-final-submission-checklist.md`](../docs/final/10-final-submission-checklist.md).
Statuses below include the evidence added on 2026-11-26.

| Checklist item | Status | Evidence / note |
|---|---|---|
| Neon password rotated | ✅ DONE (2026-11-26) | [`production-security/database-credential-rotation.txt`](production-security/database-credential-rotation.txt) |
| All local changes reviewed by their owners | ⏳ PENDING | See `git status`: editorial, search, infra and evidence changes are uncommitted. |
| Commits made by the right student for their component | ⏳ PENDING | [`../docs/final/09-changed-files-and-ownership.md`](../docs/final/09-changed-files-and-ownership.md) |
| Final version deployed, CSP header visible in production | ⏳ PENDING | [`final/integration/production-read-only-probe-20261125T193623Z.txt`](final/integration/production-read-only-probe-20261125T193623Z.txt): CSP header = 0 |
| Production end-to-end demo with test accounts | 🟡 PARTIAL | Article 21 lifecycle in [`production-integration/production-integration-results.txt`](production-integration/production-integration-results.txt). The SNS and Lambda step is still pending in production. |
| Group technical report assembled | ⏳ PENDING | Start from [`../docs/final/02-technical-evidence-pack.md`](../docs/final/02-technical-evidence-pack.md) and this index. |
| Contribution statements corrected and signed | ⏳ PENDING | [`../docs/final/06-contribution-statements.md`](../docs/final/06-contribution-statements.md) |
| AI use disclosed | ⏳ PENDING | — |
| Repository link added to the report | ⏳ PENDING | — |
| Video of at most 5 minutes | ⏳ PENDING | [`../docs/final/07-demo-plan.md`](../docs/final/07-demo-plan.md), [`final-demo/02_DEMO_CHECKLIST.md`](final-demo/02_DEMO_CHECKLIST.md) |
| Submitted on e-learning | ⏳ PENDING | — |
| Each student rehearsed the demo, a rejected request, logs and limitations | ⏳ PENDING | — |
| Unit tests 370/370 | ✅ DONE | [`final/integration/unit-tests-20261125T193654Z.txt`](final/integration/unit-tests-20261125T193654Z.txt): Identity 32, Article 64, Editorial 175, Search 99. Later runs: Editorial 183/183 ([`editorial-aws/FINAL_SUMMARY.txt`](editorial-aws/FINAL_SUMMARY.txt)) and Search 110/110 ([`cloud-architecture/FINAL_SUMMARY.txt`](cloud-architecture/FINAL_SUMMARY.txt)), but there is no consolidated re-run file for them. |
| End-to-end 47/47, browser 20/20, resilience 60/60 | ✅ DONE | [`final/e2e/lifecycle-20261125T185609Z.txt`](final/e2e/lifecycle-20261125T185609Z.txt), [`final/integration/screenshots/smoke-20261125T190715Z.txt`](final/integration/screenshots/smoke-20261125T190715Z.txt), `final/{alyaa,salma,nermeen,integration}/resilience-security-*.txt` |
| IAM: 47 pass, 0 fail, 1 emulator limit | ✅ DONE | [`final/iam/iam-permission-tests-20261125T190729Z.txt`](final/iam/iam-permission-tests-20261125T190729Z.txt) |
| Load test 1,001 requests with role breakdown | ✅ DONE | [`final/integration/load/workflow-20261125T193351Z-summary.md`](final/integration/load/workflow-20261125T193351Z-summary.md) |
| Production rate limits 4/4 | ✅ DONE | [`final/rate-limits/production-limits-20261125T193434Z.txt`](final/rate-limits/production-limits-20261125T193434Z.txt) |

## 6. Pending items

Each item needs a team action, an approval or an account. Nothing here can be closed from the
repository alone.

| # | Item | Needed | Blocks |
|---|---|---|---|
| 1 | ~~Choose a remote Floci host~~ **NOT REQUIRED** (2026-11-26): Floci runs on the host machine, started by `infra/floci/start-supporthub.sh` | — | — |
| 2 | Cloudflare tunnel token, `wrangler` login, gateway Worker deployment | Cloudflare account access | F4, F7 |
| 3 | Set the Vercel environment variables for Article, Identity and Search, then redeploy | Approval and Vercel access | F4, S4 on Vercel |
| 4 | Cutover from the laptop workers to the ECS workers (`infra/floci/remote/cutover.sh`) | Approval. This writes production rows: the pending Article 21 publication event will be published once. | F3 (production), F7, S4 |
| 5 | Full public end-to-end test with per-student verification (host machine running Floci) | Items 2–4 | F7 |
| 6 | Confirm in the Vercel dashboard that the restricted database role is set per project | Vercel dashboard | P1 |
| 7 | Decide what to do with the stale project `supporthub-editorial-service.vercel.app` (health 500) and check `EDITORIAL_ORIGIN` in Pages | Cloudflare and Vercel dashboards | P1 |
| 8 | Ask GitHub Support to purge `refs/pull/1-8` | GitHub Support request | P4, S3 secrets |
| 9 | Apply migration 008 to Neon (dev, then production) **before** deploying the new Editorial code | Manual step with the safety gate | E1 in production |
| 10 | Deploy the final branch so the CSP header is served | Owners review, commit, deploy | Checklist, S2/S4 |
| 11 | Re-verify live delivery of the Identity SNS security alerts | One test run | Alyaa SNS (PARTIAL) |
| 12 | Optional: scheduler for `/internal/retry-publication-events` and `reprocess-sentiment.js`, a Lambda on-failure destination, a 14-day DLQ retention | Team decision | — |
| 13 | Owners review and commit, update and sign the contribution statements, disclose AI use, assemble the report, record the video, submit, rehearse | Students | Checklist, S7.2, S9.3, S10, S11 |
| 14 | Optional: one consolidated unit-test re-run (expected Identity 32, Article 64, Editorial 183, Search 110) | One run | Checklist accuracy |

## 7. Superseded and stale files

These files are kept for history. Do not cite them as the current status.

| File | Why |
|---|---|
| [`../docs/final/08-compliance-matrix.md`](../docs/final/08-compliance-matrix.md), [`final/README.md`](final/README.md) | 2026-11-24 cloud-sandbox run (351 unit tests, IAM 39/39). Replaced by the 2026-11-25 isolated-stack runs and by [`../docs/final/04-requirements-compliance-matrix.md`](../docs/final/04-requirements-compliance-matrix.md). |
| `final/e2e/lifecycle-20261124T*.txt`, `final/iam/iam-permission-tests-20261124T*` and the earlier `…20261125T185257Z…190410Z` runs, `final/load/workflow-20261124T021755Z-*`, `final/frontend/smoke-*.txt`, `final/unit-tests/all-services-20261124T022739Z.txt`, `final/aws/aws-usage-20261124T021842Z.txt`, `final/rate-limits/production-limits-20261124T021235Z.txt` | Earlier runs. The latest run of each is cited above. The `final/frontend/smoke-*` files were taken during a redesign attempt that was reverted. |
| [`final-demo/09_EVIDENCE_INDEX.md`](final-demo/09_EVIDENCE_INDEX.md) | Alyaa's earlier index. Its limitations ("Editorial SQS consumption not verified", "cross-service integration pending") are resolved by `final/e2e`, `editorial-aws/` and `production-integration/`. |
| [`integration/load/`](integration/load/), [`alyaa-final/load-tests/`](alyaa-final/load-tests/), [`load/identity-health-results.txt`](load/identity-health-results.txt) | Earlier read-only or health-only load tests. Replaced by the 1,001-request workflow test (L1). |
| [`../docs/final/06-contribution-statements.md`](../docs/final/06-contribution-statements.md) | Editorial test count updated to 183 on 2026-11-26. The phrase "optional sentiment analysis" in Nermeen's statement is still out of date (sentiment is now local). |
| [`cloud-architecture/06-unified-architecture.txt`](cloud-architecture/06-unified-architecture.txt) §1–2 | The main-Floci findings describe the state before Step 1. A dated update note at the top of the file now says so. |
| [`cloud-architecture/05-remote-deployment-preparation.txt`](cloud-architecture/05-remote-deployment-preparation.txt) | Remote-host rehearsal and hosting research. Kept for reference only: a remote host is not required (F2). |
| [`security-automation/05`](security-automation/05-idempotency-verification.txt), [`06`](security-automation/06-startup-recovery-tests.txt) | The "RUN STOPPED" notes are superseded by the RESUMED sections that follow them. |

## 8. Folder map

| Folder | Contents |
|---|---|
| [`cloud-architecture/`](cloud-architecture/) | Instructor-feedback architecture work: audit, ECS, Vercel to Floci, services per student, remote rehearsal, unified architecture, Step 1 Floci recreation |
| [`editorial-aws/`](editorial-aws/) | Salma: re-review, SNS, Lambda, receipts, IAM and recovery |
| [`search-aws/`](search-aws/) | Nermeen: IAM, DynamoDB, CSV export to S3 |
| [`final-security-search/`](final-security-search/) | Vercel and Docker database configuration, S3 export security, sentiment, Article 21 index |
| [`security-automation/`](security-automation/) | Production configuration, secret scan, startup and queue automation, idempotency, recovery |
| [`production-integration/`](production-integration/), [`production-security/`](production-security/) | Production worker integration and the database credential rotation |
| [`final/`](final/) | 2026-11-24 and 2026-11-25 integrated runs: unit, e2e, IAM, AWS usage, load, rate limits, smoke, resilience, per student |
| [`final-demo/`](final-demo/), [`integration/`](integration/), [`alyaa-final/`](alyaa-final/), [`security/`](security/), [`load/`](load/) | Alyaa's earlier Article and Identity evidence: outbox retry, idempotency, Floci recovery, security tests, early load tests |
| [`aws-verification/`](aws-verification/) | Screenshots: S3, IAM deny, SQS, Secrets Manager |
| `../services/search-analytics-service/evidence/`, `../services/editorial-service/docs/` | Service-level evidence kept inside the service folders |
