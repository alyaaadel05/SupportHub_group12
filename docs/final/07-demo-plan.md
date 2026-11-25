# SupportHub — 5-Minute Demo Plan

**Environment:** local integrated stack (`bash infra/floci/setup-supporthub.sh`, http://localhost:8088)
— everything shown here was executed successfully in rehearsal runs (`evidence/final/e2e/`).
Use three browser profiles (or one normal + two private windows) logged in as author, editor and
reader/admin. Prepare one unique keyword (e.g. `printer-demo-01`).

| Time | Who speaks | Action | What the audience sees |
|---|---|---|---|
| 0:00–0:25 | Alyaa | Architecture slide (`02-technical-evidence-pack.md` §6) | 3 student services + shared Identity, Floci AWS services, SQS/SNS, Neon/Postgres |
| 0:25–1:25 | Alyaa | Log in as `author@` → create article with the keyword → edit once → open Versions → compare v1/v2 → Check duplicates → (optional) Stack Overflow references → **Submit for review** | Draft saved, 2 versions, duplicate score, status `in_review` |
| 1:25–1:45 | Alyaa | Terminal: `docker logs supporthub-int-article-outbox-worker --tail 3` and `docker logs supporthub-int-editorial-article-worker --tail 3` | "Event published" → "Article event acknowledged: processed" (SQS async path) |
| 1:45–2:40 | Salma | Log in as `editor@` → Review queue shows the article (~1 s) → **Approve** with comment → **Publish** → open Editorial History for the ID | Status timeline draft → in_review → approved → published |
| 2:40–3:30 | Nermeen | Reader window: search the keyword → open article (view) → Helpful vote → admin: Analytics dashboard → Export to S3 | Article found, analytics counters, CSV export in S3 |
| 3:30–4:30 | each owner, 20 s each | Security + cloud: author opens `review.html` → refused (backend 403); show `bash infra/floci/verify-iam.sh` summary line (39/39) or the saved file; show `docker logs supporthub-int-identity | grep secrets` (secrets loaded from Secrets Manager, values never printed) | 403 enforcement, IAM deny, shared Secrets Manager |
| 4:30–5:00 | Alyaa | k6 summary table (`evidence/final/load/workflow-*-summary.md`): 1,001 requests — Author 440, Editor 300, Reader 250, 0 failures, p95 61 ms | Load evidence with role breakdown |

**Fallbacks:** if Turnstile is unreachable on the demo network, votes return a safe error —
say so and show the k6 vote results instead. If the SQS step is slow, refresh the queue once
(the consumer long-polls every 5 s). Do not run `rate-limit-production.mjs` before the demo (it
locks the client out for 15 minutes).
