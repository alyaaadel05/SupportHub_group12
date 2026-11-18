
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
