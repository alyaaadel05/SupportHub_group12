# 9. Cost, Recovery and Limitations

> Draft for the group report.

## 9.1 Cost and resources: $0

| Component | Plan | Cost | Evidence |
|---|---|---|---|
| Cloudflare Pages (frontend and Pages Function) | Free | $0 | `docs/final/02-technical-evidence-pack.md` §32 |
| Vercel (4 APIs) | Hobby | $0 | same |
| Neon PostgreSQL | Free | $0 | same |
| Floci (all AWS services, plus ECS) | Runs locally on the host machine | $0. No real AWS account is used. | same; `evidence/cloud-architecture/FINAL_SUMMARY.txt` ("no paid resource created") |
| Cloudflare Worker gateway + Tunnel (pending deployment) | Workers Free: 100,000 requests per day, 10 ms CPU. Tunnel is available on all plans. | $0 | `evidence/cloud-architecture/05-remote-deployment-preparation.txt` §H |
| Workers VPC (pending deployment) | Free on all plans **while in beta**. **Post-beta pricing is not stated** by Cloudflare. | $0 today; may change | same |
| Remote VM | **Not used.** Floci runs on the host machine. | $0 | `evidence/cloud-architecture/06-unified-architecture.txt` (update note) |

**Resource awareness** (`docs/final/02-technical-evidence-pack.md` §32):
- AWS calls are batched: DynamoDB counters every 5 s, CloudWatch every 5–10 s.
- Database pools use 5–10 connections.
- Search and analytics responses are cached.
- The outbox batch is limited to 25 events.

**Measured footprint:** Floci uses about 100 MiB and each worker 26–33 MiB
(`evidence/cloud-architecture/05-remote-deployment-preparation.txt` §A).

## 9.2 Recovery

| Mechanism | How it works | Verified result | Evidence |
|---|---|---|---|
| Floci volume backup | Floci is stopped gracefully, then the `floci_floci-data` volume is archived. The container's configuration is saved for rollback. | Backup of 315 files (23.7 MB). Resource inventory identical after the recreate (empty diff). | `evidence/cloud-architecture/step1-floci-recreation/STEP1-REPORT.txt` §2–3, `inventory-diff-recreate.txt` |
| Floci restart recovery | State is replayed from the volume. ECS services are recreated automatically. | Restart took about 4.5 min. 3 new worker containers. Services 1/1/1. | `evidence/cloud-architecture/02-ecs-on-floci.txt` §E |
| Startup script recovery | `start-production-workers.sh` and `start-supporthub.sh` start a stopped Floci, wait for health, and check queues and IAM. A paused Floci is reported as "not ready" (exit 4). | 38 PASS + 1 FAIL, fixed and re-run as PASS. Data preserved. | `evidence/security-automation/06-startup-recovery-tests.txt` |
| ECS task auto-replacement | ECS keeps desiredCount: a killed task is replaced | Back to 1/1 after about 16 s | `evidence/cloud-architecture/02-ecs-on-floci.txt` §A |
| Outbox retry | Events are written to the database in the same transaction. The worker retries until SQS is back. | Event kept pending during the outage, then published automatically | `evidence/integration/real-outbox-retry.txt`, `evidence/final/alyaa/resilience-security-20261125T193131Z.txt` |
| DLQ | After 5 failed receives, a message moves to the DLQ | Redrive configured with `maxReceiveCount` 5 | `evidence/security-automation/FINAL_SUMMARY.txt` §9, `evidence/cloud-architecture/05-remote-deployment-preparation.txt` §E |
| Consumer idempotency | The message is deleted only after the commit. Duplicates are acknowledged through the inbox. | A replayed event was acknowledged as "duplicate", with 1 inbox row | `evidence/security-automation/06-startup-recovery-tests.txt` (T6.5) |
| SNS requeue | `POST /internal/retry-publication-events` requeues events whose retries were exhausted | Retested PASS (D3) | `evidence/editorial-aws/03-sns-publication-notifications.txt` |
| Lambda retry | Floci's asynchronous platform retry, then an idempotent receipt | 7/7 | `evidence/editorial-aws/06-editorial-security-and-recovery.txt` |
| Secrets Manager fail-closed | Required mode: a new container refuses to start without its secrets | Exit 1 on `AccessDenied` | `evidence/final/aws/secrets-runtime-denial.txt` |

## 9.3 Honest limitations

- **The Floci host must be online.** SQS submission, SNS → Lambda, S3, DynamoDB, CloudWatch and the
  Identity alerts all need Floci running on the host machine during the demo. While it is down,
  events wait in the PostgreSQL outboxes (`evidence/cloud-architecture/06-unified-architecture.txt` §5).
  A Floci restart takes about 4.5 min.
- **The gateway is not deployed yet.** Until then, the Vercel APIs cannot reach Floci. CSV export
  returns a fast 503 in production (`evidence/final-security-search/02-s3-csv-export-security.txt`).
- **ECS workers are idle in production.** They are deployed with desiredCount 0, and the legacy
  worker containers still process production events. One production SNS event (Article 21) is
  pending (`evidence/cloud-architecture/step1-floci-recreation/STEP1-REPORT.txt`,
  `evidence/cloud-architecture/05-remote-deployment-preparation.txt` §B).
- **Emulator security gaps:** no SigV4 verification, unsigned S3 GETs served, `cloudwatch:namespace`
  ignored, ECS task roles not enforced (compensated with per-task keys), default admin credentials
  accepted (mitigated by binding Floci to loopback only), no SNS delivery log. Only real AWS could
  prove these controls are enforced (`docs/final/report-drafts/03-security.md` §3.7).
- **18 development-queue messages were consumed before 26 Nov.**
  - On 2026-11-22, 18 messages were recorded in the **development** queue `supporthub-article-events`
    (`evidence/alyaa-final/Alyaa_Individual_Evidence.txt` §4).
  - That queue held 0 messages before Step 1 on 2026-11-26. The Step 1 work never received or
    purged messages.
  - Floci does not log SQS calls, so the consumer cannot be determined. Most likely it was the
    integrated stack's editorial worker on 2026-11-25. The production queue was not affected
    (`evidence/cloud-architecture/step1-floci-recreation/STEP1-REPORT.txt` §1).
- **Gaps in automatic recovery:** no scheduler is configured for the SNS requeue or for
  sentiment reprocessing. There is no Lambda on-failure destination and no automatic
  reconciliation of published events that lack a receipt; the gap can be found with SQL
  (`evidence/editorial-aws/FINAL_SUMMARY.txt`).
- **Rate limits are per instance.** The counters are held in memory, so each Vercel instance
  counts separately (`docs/final/02-technical-evidence-pack.md` §33).
