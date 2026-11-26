
# SupportHub — Docker & Floci Infrastructure

## Services

- Article Service (Docker): http://127.0.0.1:3005
- Article Service (local): http://127.0.0.1:3001
- Identity Service (local): http://127.0.0.1:3003
- Floci AWS emulator: http://127.0.0.1:4566

## Requirements

- Docker Desktop
- Node.js dependencies
- Private environment variables configured locally

Do not commit .env files or secret credentials.

## Start Docker Infrastructure

From the project root:

docker compose -f infra/floci/docker-compose.yml up -d --build

## Check Running Containers

docker compose -f infra/floci/docker-compose.yml ps

## Test Article Service

Invoke-WebRequest http://127.0.0.1:3005/api/health -UseBasicParsing

## Test Floci

Invoke-WebRequest http://127.0.0.1:4566/_localstack/health -UseBasicParsing

## View Article Logs

docker logs supporthub-article --tail 50

## Stop Containers

docker compose -f infra/floci/docker-compose.yml stop

Do not use docker compose down -v because it removes persistent S3 data.

## Docker Networking

The Article Service connects to Floci using:

AWS_ENDPOINT_URL=http://floci:4566

The Article Service accesses Neon PostgreSQL through its configured database connection.

## Security

- Environment variables are provided at runtime.
- Private .env files are excluded from the Docker image.
- S3 operations use a restricted IAM identity.
- GetObject and PutObject are allowed under articles/.
- DeleteObject is not permitted.

## Verified Tests

- Article Service Docker image build: PASS
- Private .env excluded from image: PASS
- Article Service health: HTTP 200
- Floci S3 backup retrieval: HTTP 200
- Neon PostgreSQL query: PASS
- Shared Docker network: PASS

## Team Integration

Editorial and Search/Analytics services are owned by other team members.

Their service implementations should be integrated through reviewed Git feature branches and pull requests.

## Integrated stack (all services, final submission)

`docker-compose.supporthub.yml` runs Floci, PostgreSQL, Identity, Article, Editorial,
Search & Analytics, their workers and the frontend proxy. It coexists with the
containers above (names `supporthub-int-*`, ports 3105-3108 and 8088) and reuses an
existing `supporthub-floci` container. Start it with:

    bash infra/floci/setup-supporthub.sh

Then verify with `bash infra/floci/verify-iam.sh` and `bash infra/floci/verify-aws-usage.sh`.
Full guide: `docs/final/03-local-windows-runbook.md`.

## Production workers and queues (automated startup)

Run from the repository root in **Git Bash**. No AWS CLI command has to be typed by hand.

    # start or reuse main Floci, the production queue + DLQ and both production workers
    bash infra/floci/start-production-workers.sh

    # show what would happen, change nothing
    bash infra/floci/start-production-workers.sh --dry-run

    # non-disruptive check: exit 1 if anything is not already running correctly
    bash infra/floci/start-production-workers.sh --verify-only

    # Floci + queue/DLQ/redrive/IAM initialisation only (idempotent)
    bash infra/floci/floci-queues.sh --env production [--verify-only]
    bash infra/floci/floci-queues.sh --env isolated   [--verify-only]

Private configuration is read from `%LOCALAPPDATA%\SupportHub\production-workers\`
(`article.restricted.env`, `editorial.restricted.env`, `article.aws.env`, `editorial.aws.env`)
and is never copied into the repository (override with `SUPPORTHUB_WORKER_CONFIG_DIR`).

Safety rules built into both scripts:

- production = main Floci `http://localhost:4566`, queue `supporthub-article-events-production`;
  isolated = `http://localhost:4567`, queue `supporthub-article-events`. The script checks that
  the endpoint port belongs to the expected Floci container and refuses to mix them.
- existing containers, queues, IAM users, policies and access keys are reused; nothing is
  recreated, deleted or rotated. A new access key is only created with `--allow-new-key`.
- an existing worker or queue whose configuration differs, or a second container consuming
  the same queue, stops the script with exit code 3 instead of being changed.
- workers are started only after Floci is healthy and the queue, DLQ, redrive policy and
  queue keys are verified; restart policy `unless-stopped` is used and checked.
- values are never printed (only variable names, roles and pass/fail results).

Exit codes: `0` ok, `1` check failed (or action needed in `--verify-only`), `2` missing
prerequisite/configuration, `3` conflicting configuration, `4` Floci not ready,
`5` worker failed to start.
