# SupportHub — Local Run & Verification Guide (Windows 11, Docker Desktop, Git Bash)

This guide runs the **integrated stack** (`infra/floci/docker-compose.supporthub.yml`)
next to the containers you already have. Nothing existing is deleted or recreated.

## 1. Where things run

| Environment | What runs there | Verified by |
|---|---|---|
| **Cloud sandbox (Claude Code session)** | Own Floci 2.5.0, Postgres 16 (TLS), all 4 services + 3 workers + Lambda, k6, Playwright | Evidence in `evidence/final/` (all runs dated 2026-11-24) |
| **Your Windows machine** | Your existing `supporthub-floci`, `supporthub-article`, `supporthub-identity`, `supporthub-editorial`, Postgres, plus the new `supporthub-int-*` stack | **You**, with the commands below (not verifiable from the cloud sandbox) |
| **Vercel / Cloudflare Pages / Neon** | Production backends, frontend, database | **You**, see `04-deployment-verification.md` |

## 2. How the new stack coexists with your containers

| Your existing container | New stack behaviour |
|---|---|
| `supporthub-floci` (port 4566) | **Reused**: started if stopped, attached to network `supporthub-int-net` with alias `floci`. Never removed. Its existing buckets/queues/secrets/users are kept. |
| `supporthub-article` (3005), `supporthub-identity` (3006), `supporthub-editorial` (3007) | Untouched. New services use `supporthub-int-*` names and ports **3105–3108**, frontend **8088**. |
| Your PostgreSQL container | Untouched. The new stack uses its own `supporthub-int-postgres` (no host port), or Neon if `SUPPORTHUB_DATABASE_URL` is set. |
| IAM users `supporthub-article-service`, `search-analytics-service` | Existing access keys are **never deleted**; an additional key is created for the new stack (AWS allows 2 per user). |
| Existing Lambda `supporthub-editorial-publication-outcome` | Left unchanged if it was not created by the script (tag check). |

Notes for a reused Floci:
- IAM deny tests need `FLOCI_SERVICES_IAM_ENFORCEMENT_ENABLED=true` (your `infra/floci/docker-compose.yml` already sets it).
- Your existing Floci has **no Docker socket mounted**, so it can store the Lambda but cannot *run* it. To run the Lambda locally, stop your Floci and let the script start `supporthub-int-floci`, or add `- /var/run/docker.sock:/var/run/docker.sock` to your Floci service.
- Do not run Salma's old `editorial-service/docker-compose.yml` **workers** profile at the same time: it would consume the same `supporthub-article-events` queue.

## 3. Start (Git Bash, repository root)

```bash
cd ~/SupportHub_group12
```

```bash
git fetch origin integration/group12-final && git checkout integration/group12-final && git pull
```

```bash
bash infra/floci/setup-supporthub.sh
```

The script prints `[PASS]/[FAIL]` per step and ends with `SupportHub setup summary: N passed, 0 failed` (exit code 0).
Demo account password: `infra/floci/.generated/demo-accounts.txt` (git-ignored).

Optional variants:

```bash
SUPPORTHUB_DATABASE_URL='postgresql://...neon...' bash infra/floci/setup-supporthub.sh
```

```bash
RATE_LIMIT_PROFILE=loadtest bash infra/floci/setup-supporthub.sh
```

## 4. Inspect

```bash
docker compose -f infra/floci/docker-compose.supporthub.yml ps
```

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

```bash
docker compose -f infra/floci/docker-compose.supporthub.yml logs -f article editorial-article-worker
```

```bash
docker logs supporthub-int-search 2>&1 | grep security_event
```

```bash
docker network inspect supporthub-int-net --format "{{range .Containers}}{{.Name}} {{end}}"
```

## 5. Test

```bash
bash infra/floci/verify-iam.sh
```

```bash
bash infra/floci/verify-aws-usage.sh
```

```bash
node tests/integration/lifecycle-e2e.mjs
```

```bash
node tests/integration/frontend-smoke.cjs
```

(`frontend-smoke.cjs` needs `npm i -g playwright` and `npx playwright install chromium` on Windows.)

Production rate limits (locks the test client out for 15 min; restart containers afterwards):

```bash
node tests/integration/rate-limit-production.mjs
```

k6 workflow test (restart the app containers with the load-test profile first):

```bash
RATE_LIMIT_PROFILE=loadtest REQUIRE_TURNSTILE_FOR_VOTES=false docker compose -f infra/floci/docker-compose.supporthub.yml up -d --force-recreate identity article article-outbox-worker editorial editorial-article-worker editorial-publication-worker search
```

```bash
MSYS_NO_PATHCONV=1 docker run --rm --network supporthub-int-net -v "$(pwd -W)/tests/load/k6:/scripts" -e BASE_URL=http://frontend:8080 -e ORIGIN=http://localhost:8088 -e PASSWORD="$(sed -n 's/^password=//p' infra/floci/.generated/demo-accounts.txt)" grafana/k6 run /scripts/workflow-1000-requests.js
```

Unit tests (each service):

```bash
cd services/article-service && npm ci && npm test
```

Open the app: http://localhost:8088 (log in as `author@supporthub.test`, `editor@supporthub.test`, `admin@supporthub.test`).

## 6. Verify against your EXISTING containers

```bash
docker ps --filter name=supporthub- --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

```bash
curl -s http://127.0.0.1:3005/api/health; echo; curl -s http://127.0.0.1:3006/api/health; echo; curl -s http://127.0.0.1:3007/api/health
```

```bash
docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' supporthub-floci
```

Expected: your three existing services still answer on 3005/3006/3007, and `supporthub-floci` is on both `floci_default` and `supporthub-int-net`.

The original frontend dev proxy (`cd frontend && node dev-server.js`, port 8080) now targets your **existing** ports by default (identity 3006, article 3005, editorial 3007, search 3004) and can be pointed elsewhere with `IDENTITY_URL`, `ARTICLE_URL`, `EDITORIAL_URL`, `SEARCH_URL` — no Tailscale IPs are hard-coded any more.

## 7. Stop (keeps data)

```bash
bash infra/floci/setup-supporthub.sh --down
```

Do **not** use `docker compose down -v`: it deletes the Floci and Postgres volumes.

## 8. Windows troubleshooting

| Symptom | Fix |
|---|---|
| `port is already allocated` on 4566 | Another Floci/LocalStack is running under a different name; stop it or rename it `supporthub-floci` so it is reused. |
| Paths like `C:/Program Files/Git/...` in AWS errors | Run from Git Bash; the scripts set `MSYS_NO_PATHCONV=1`. |
| `aws: command not found` | Not required: the scripts fall back to the `amazon/aws-cli` Docker image. |
| Lambda `Failed to start Lambda container` | Floci needs the Docker socket (see section 2). |
| Health check FAIL for one service | `docker logs supporthub-int-<service>`; a `[secrets] ... AccessDeniedException` line means its IAM policy was not applied — re-run the setup script. |
