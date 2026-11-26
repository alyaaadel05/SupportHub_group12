# 6. Demo Video Script (at most 5:00)

> Draft.
>
> **Prepare:**
> - Floci running on the host machine.
> - Three browser windows logged in as **author**, **editor** and **reader**, on the production
>   site `https://supporthub-group12.pages.dev`.
> - One unique keyword, for example `printer-demo-01`.
> - A terminal at the repository root (Git Bash).
>
> **Before recording, check** with the read-only command
> `bash infra/floci/start-supporthub.sh --env production --status`. Today the ECS workers are
> deployed at desiredCount 0, and the legacy worker containers process production events
> (`evidence/cloud-architecture/step1-floci-recreation/STEP1-REPORT.txt`).
> - If the cutover has **not** been approved and done before recording, show the ECS cluster as
>   deployed (§3:30) and say that the legacy workers carry production traffic.
> - Do **not** run `--start-workers` just for the video.

| Time | Speaker | On screen | What to say |
|---|---|---|---|
| 0:00–0:30 | Alyaa | Architecture diagram `docs/architecture/supporthub_production_architecture.png` | "One deployment: Cloudflare Pages, a Pages Function proxy, four Vercel APIs and Neon. The AWS layer is Floci on the host machine, with three ECS workers. The asynchronous flow is SQS to Editorial, then SNS to Lambda." |
| 0:30–1:30 | Alyaa | **Author** window: create an article with the keyword → edit once → Versions (compare v1/v2) → Check duplicates → **Submit for review** | "Ownership, version history and duplicate detection run in the Article Service. Submitting writes the status and an outbox event in one transaction." |
| 1:30–1:45 | Alyaa | Author opens `review.html` → refused | "Roles are enforced in the backend. The author gets 403." |
| 1:45–2:45 | Salma | **Editor** window: the review queue shows the article → **Approve** with a comment → **Publish** → Editorial History | "The consumer read the SQS event and created the review. Publishing writes an SNS outbox event. A Lambda stores a receipt for it." |
| 2:45–3:30 | Nermeen | **Reader** window: search the keyword → open the article → Helpful vote (Turnstile) → editor: Analytics dashboard | "Search only indexes published articles. Views and votes feed the analytics. Turnstile is checked on the server." |
| 3:30–4:15 | Alyaa | Terminal: `bash infra/floci/start-supporthub.sh --env production --status` (read-only), then `aws --endpoint-url http://127.0.0.1:4566 ecs list-services --cluster supporthub-workers` | "One Bash script starts the whole AWS layer: Floci, resources, IAM, Secrets Manager, Lambda and the ECS cluster. Here are the three worker services. In the isolated test, a killed task came back in about 16 seconds." Evidence: `evidence/cloud-architecture/02-ecs-on-floci.txt`. |
| 4:15–4:40 | each owner, about 8 s | Saved IAM result `evidence/final/iam/iam-permission-tests-20261125T190729Z.txt` (last line) | "Each component has its own IAM user: 47 checks pass, 0 fail, 1 is an emulator limit. One service cannot read another service's secrets." |
| 4:40–5:00 | Alyaa | `evidence/final/integration/load/workflow-20261125T193351Z-summary.md` per-role table | "The authenticated k6 workflow test ran 1,001 requests: Author 440, Editor 300, Reader 250, with zero unexpected failures. Known limits: Floci doesn't verify SigV4 signatures, and the Vercel-to-Floci gateway is still pending deployment." |

**Fallbacks:**
- If the SQS step is slow, refresh the queue once. In the ECS test, a submission reached the queue
  in 4–6 s (`evidence/cloud-architecture/02-ecs-on-floci.txt`).
- If Turnstile is blocked on the demo network, the vote fails safely. Say so and show the saved
  result instead.
- Do not run `tests/integration/rate-limit-production.mjs` before recording. It locks the client
  out for 15 minutes (`docs/final/07-demo-plan.md`).
- Do not show CSV export or live counters on the production site. They need the pending gateway,
  and today they return a 503.
