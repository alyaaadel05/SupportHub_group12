#!/usr/bin/env bash
# =====================================================================
# SupportHub Group 12 - one-command Floci + Docker setup
# =====================================================================
# Starts Floci and PostgreSQL, creates/verifies every AWS resource, the
# per-component IAM identities and the shared Secrets Manager secrets,
# deploys the Editorial Lambda, starts all services, creates local demo
# accounts, runs health checks and IAM permission tests, then prints a
# PASS/FAIL summary.
#
# Usage (repository root, Git Bash / WSL / Linux / macOS):
#   bash infra/floci/setup-supporthub.sh            # full setup
#   bash infra/floci/setup-supporthub.sh --no-iam-tests
#   RATE_LIMIT_PROFILE=loadtest bash infra/floci/setup-supporthub.sh
#   bash infra/floci/setup-supporthub.sh --down     # stop (keeps data)
#
# Coexistence with existing local containers (Windows Docker Desktop):
#   - If a container named "supporthub-floci" exists (the team's Floci from
#     infra/floci/docker-compose.yml), it is REUSED: started if stopped and
#     attached to the network supporthub-int-net with the alias "floci".
#     It is never removed or recreated, and its existing resources are kept.
#   - Otherwise an own Floci (supporthub-int-floci) is started on port 4566.
#   - New containers are prefixed supporthub-int-, host ports 3105-3108/8088.
#   - Existing IAM access keys are never deleted.
#
# Optional environment variables (never committed):
#   SUPPORTHUB_DATABASE_URL  use Neon instead of the local Postgres container
#   TURNSTILE_SECRET_KEY     real Turnstile secret (default: Cloudflare's
#                            documented always-pass TEST secret)
#   STACK_EXCHANGE_KEY, HF_TOKEN   optional third-party keys
#   SUPPORTHUB_DEMO_PASSWORD password for local demo accounts (default:
#                            generated and stored in .generated/demo-accounts.txt)
#   SKIP_LAMBDA=true         skip Lambda deployment
#   SUPPORTHUB_NO_BUILD=true use already-built supporthub-int-* images (offline)
#
# Safe to run repeatedly: existing resources, secrets and keys are kept.
# Exit codes: 0 all checks passed, 1 a check failed, 2 missing prerequisite.
# =====================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1   # stop Git Bash rewriting /paths and file:// args

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

COMPOSE_FILE="infra/floci/docker-compose.supporthub.yml"
GEN="infra/floci/.generated"
IAM_DIR="infra/iam"
ENDPOINT="http://localhost:4566"
REGION="us-east-1"
ACCOUNT="000000000000"
RUN_IAM_TESTS=true

for arg in "$@"; do
  case "$arg" in
    --no-iam-tests) RUN_IAM_TESTS=false ;;
    --down) docker compose -f "$COMPOSE_FILE" stop; exit $? ;;
    -h|--help) sed -n 2,30p "$0"; exit 0 ;;
    *) echo "Unknown option: $arg"; exit 2 ;;
  esac
done

PASS=0; FAIL=0; RESULTS=()
ok()   { PASS=$((PASS+1)); RESULTS+=("PASS  $1"); echo "  [PASS] $1"; }
bad()  { FAIL=$((FAIL+1)); RESULTS+=("FAIL  $1"); echo "  [FAIL] $1"; }
step() { echo; echo "==> $1"; }
die()  { echo "ERROR: $1" >&2; exit "${2:-1}"; }

# ---------------------------------------------------------------------
# 0. Prerequisites
# ---------------------------------------------------------------------
step "Checking prerequisites"
command -v docker >/dev/null || die "docker is required" 2
docker info >/dev/null 2>&1 || die "Docker is not running (start Docker Desktop)" 2
docker compose version >/dev/null 2>&1 || die "docker compose v2 is required" 2
command -v openssl >/dev/null || die "openssl is required (included in Git Bash)" 2
command -v curl >/dev/null || die "curl is required" 2

if command -v aws >/dev/null; then
  AWS_MODE=local
else
  AWS_MODE=docker
  echo "  aws CLI not found: using the amazon/aws-cli Docker image"
fi

# awsx: AWS CLI against Floci. Uses whatever AWS_ACCESS_KEY_ID /
# AWS_SECRET_ACCESS_KEY are set when called (admin by default).
awsx() {
  if [ "$AWS_MODE" = local ]; then
    aws --endpoint-url "$ENDPOINT" --region "$REGION" "$@"
  else
    docker run --rm -i --network supporthub-int-net \
      -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION="$REGION" \
      -v "$ROOT:/repo" -w /repo amazon/aws-cli \
      --endpoint-url http://floci:4566 --region "$REGION" "$@"
  fi
}
as_admin() { export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION="$REGION"; }
as_admin

rand_hex() { openssl rand -hex "${1:-32}"; }

# ---------------------------------------------------------------------
# 1. Local generated material (git-ignored)
# ---------------------------------------------------------------------
step "Preparing $GEN (certificates, database password)"
mkdir -p "$GEN/certs"
chmod 700 "$GEN" 2>/dev/null || true
if [ ! -f "$GEN/certs/server.crt" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=SupportHub Local CA" \
    -keyout "$GEN/certs/ca.key" -out "$GEN/certs/ca.crt" >/dev/null 2>&1
  openssl req -newkey rsa:2048 -nodes -subj "/CN=postgres" \
    -keyout "$GEN/certs/server.key" -out "$GEN/certs/server.csr" >/dev/null 2>&1
  printf "subjectAltName=DNS:postgres,DNS:localhost\nextendedKeyUsage=serverAuth\n" > "$GEN/certs/san.ext"
  openssl x509 -req -in "$GEN/certs/server.csr" -CA "$GEN/certs/ca.crt" -CAkey "$GEN/certs/ca.key" \
    -CAcreateserial -days 825 -extfile "$GEN/certs/san.ext" -out "$GEN/certs/server.crt" >/dev/null 2>&1 \
    && ok "local Postgres TLS certificate created" || bad "certificate creation"
else
  ok "local Postgres TLS certificate exists"
fi
[ -f "$GEN/certs/db-password" ] || { rand_hex 24 > "$GEN/certs/db-password"; }
chmod 644 "$GEN/certs/"*.crt "$GEN/certs/db-password" 2>/dev/null || true
chmod 644 "$GEN/certs/server.key" 2>/dev/null || true   # copied and re-permissioned inside the container
DB_PASSWORD="$(cat "$GEN/certs/db-password")"
for c in identity article editorial search; do [ -f "$GEN/$c.aws.env" ] || : > "$GEN/$c.aws.env"; done

# ---------------------------------------------------------------------
# 2. Floci and PostgreSQL
# ---------------------------------------------------------------------
step "Starting Floci and PostgreSQL"
docker network inspect supporthub-int-net >/dev/null 2>&1 || docker network create supporthub-int-net >/dev/null
if docker container inspect supporthub-floci >/dev/null 2>&1; then
  FLOCI_MODE=reuse
  [ "$(docker inspect -f '{{.State.Running}}' supporthub-floci)" = true ] || docker start supporthub-floci >/dev/null
  if ! docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' supporthub-floci | grep -qw supporthub-int-net; then
    docker network connect --alias floci supporthub-int-net supporthub-floci
  fi
  ok "reusing existing Floci container supporthub-floci (attached to supporthub-int-net as 'floci')"
  docker inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' supporthub-floci | grep -q docker.sock \
    && FLOCI_DOCKER_SOCKET=true || FLOCI_DOCKER_SOCKET=false
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' supporthub-floci | grep -q 'IAM_ENFORCEMENT_ENABLED=true' \
    || echo "  WARNING: existing Floci does not have FLOCI_SERVICES_IAM_ENFORCEMENT_ENABLED=true; IAM deny tests will fail"
else
  FLOCI_MODE=own; FLOCI_DOCKER_SOCKET=true
  docker compose -f "$COMPOSE_FILE" --profile own-floci up -d floci >/dev/null 2>&1 \
    || die "could not start Floci (is something else using port 4566?)"
  ok "started own Floci container supporthub-int-floci"
fi
docker compose -f "$COMPOSE_FILE" up -d postgres >/dev/null 2>&1 || die "could not start PostgreSQL"

for i in $(seq 1 60); do
  curl -fsS "$ENDPOINT/_floci/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "$ENDPOINT/_floci/health" >/dev/null 2>&1 && ok "Floci healthy at $ENDPOINT" || die "Floci did not become healthy"

for i in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' supporthub-int-postgres 2>/dev/null)" = healthy ] && break
  sleep 2
done
[ "$(docker inspect -f '{{.State.Health.Status}}' supporthub-int-postgres 2>/dev/null)" = healthy ] \
  && ok "PostgreSQL healthy (TLS on, no host port)" || die "PostgreSQL did not become healthy"

awsx sts get-caller-identity --query Account --output text >/dev/null 2>&1 \
  && ok "AWS CLI connectivity to Floci" || die "AWS CLI cannot reach Floci"

# ---------------------------------------------------------------------
# 3. AWS resources
# ---------------------------------------------------------------------
step "S3 buckets"
for bucket in supporthub-article-backups supporthub-search-analytics-exports; do
  if awsx s3api head-bucket --bucket "$bucket" >/dev/null 2>&1; then
    ok "S3 bucket $bucket exists"
  else
    awsx s3api create-bucket --bucket "$bucket" >/dev/null 2>&1 && ok "S3 bucket $bucket created" || bad "S3 bucket $bucket"
  fi
  awsx s3api put-public-access-block --bucket "$bucket" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true >/dev/null 2>&1 || true
done

step "SQS queues (article events + dead-letter queue)"
awsx sqs create-queue --queue-name supporthub-article-events-dlq >/dev/null 2>&1
DLQ_ARN="arn:aws:sqs:$REGION:$ACCOUNT:supporthub-article-events-dlq"
REDRIVE="{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\",\"VisibilityTimeout\":\"30\"}"
if awsx sqs get-queue-url --queue-name supporthub-article-events >/dev/null 2>&1; then
  awsx sqs set-queue-attributes --queue-url "$ENDPOINT/$ACCOUNT/supporthub-article-events" --attributes "$REDRIVE" >/dev/null 2>&1
  ok "SQS supporthub-article-events exists (redrive to DLQ after 5 receives)"
else
  awsx sqs create-queue --queue-name supporthub-article-events --attributes "$REDRIVE" >/dev/null 2>&1 \
    && ok "SQS supporthub-article-events created (redrive to DLQ after 5 receives)" || bad "SQS article events queue"
fi
awsx sqs create-queue --queue-name supporthub-article-events-demo >/dev/null 2>&1   # kept for earlier evidence

step "SNS topic"
TOPIC_ARN="arn:aws:sns:$REGION:$ACCOUNT:supporthub-editorial-publication-events"
awsx sns create-topic --name supporthub-editorial-publication-events >/dev/null 2>&1 \
  && ok "SNS topic supporthub-editorial-publication-events" || bad "SNS topic"

step "DynamoDB table"
if awsx dynamodb describe-table --table-name supporthub-search-counters >/dev/null 2>&1; then
  ok "DynamoDB supporthub-search-counters exists"
else
  awsx dynamodb create-table --table-name supporthub-search-counters \
    --attribute-definitions AttributeName=pk,AttributeType=S --key-schema AttributeName=pk,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST >/dev/null 2>&1 && ok "DynamoDB supporthub-search-counters created" || bad "DynamoDB table"
fi

# ---------------------------------------------------------------------
# 4. Shared Secrets Manager (values generated here, never printed)
# ---------------------------------------------------------------------
step "Secrets Manager"
ensure_secret() { # name json
  if awsx secretsmanager describe-secret --secret-id "$1" >/dev/null 2>&1; then
    ok "secret $1 exists (value kept)"
  else
    awsx secretsmanager create-secret --name "$1" --secret-string "$2" >/dev/null 2>&1 \
      && ok "secret $1 created" || bad "secret $1"
  fi
}
DB_URL="${SUPPORTHUB_DATABASE_URL:-postgresql://supporthub:${DB_PASSWORD}@postgres:5432/supporthub}"
TS_KEY="${TURNSTILE_SECRET_KEY:-1x0000000000000000000000000000000AA}"
ensure_secret supporthub/shared/session      "{\"SESSION_SECRET\":\"$(rand_hex 32)\"}"
ensure_secret supporthub/shared/service-hmac "{\"SERVICE_SHARED_SECRET\":\"$(rand_hex 32)\"}"
ensure_secret supporthub/shared/database     "{\"DATABASE_URL\":\"$DB_URL\"}"
if [ -n "${SUPPORTHUB_DATABASE_URL:-}" ]; then
  awsx secretsmanager put-secret-value --secret-id supporthub/shared/database \
    --secret-string "{\"DATABASE_URL\":\"$DB_URL\"}" >/dev/null 2>&1 \
    && ok "secret supporthub/shared/database updated from SUPPORTHUB_DATABASE_URL" || bad "update database secret"
fi
ensure_secret supporthub/article/runtime-config "{\"feature\":\"article-backup\",\"enabled\":true,\"STACK_EXCHANGE_KEY\":\"${STACK_EXCHANGE_KEY:-}\"}"
ensure_secret supporthub/editorial/runtime   "{\"CRON_SECRET\":\"$(rand_hex 32)\"}"
ensure_secret supporthub/search/runtime      "{\"TURNSTILE_SECRET_KEY\":\"$TS_KEY\",\"HF_TOKEN\":\"${HF_TOKEN:-}\"}"
ensure_secret supporthub/identity/runtime    "{\"TURNSTILE_SECRET_KEY\":\"$TS_KEY\"}"
unset DB_URL TS_KEY

# ---------------------------------------------------------------------
# 5. Per-component IAM identities (least privilege)
# ---------------------------------------------------------------------
step "IAM identities and policies"
ensure_user() { # component user policy-name=file ...
  local comp="$1" user="$2"; shift 2
  awsx iam get-user --user-name "$user" >/dev/null 2>&1 || awsx iam create-user --user-name "$user" >/dev/null 2>&1
  local spec name file
  for spec in "$@"; do
    name="${spec%%=*}"; file="${spec#*=}"
    awsx iam put-user-policy --user-name "$user" --policy-name "$name" \
      --policy-document "file://$file" >/dev/null 2>&1 || { bad "$user policy $name"; return; }
  done
  if ! grep -q AWS_ACCESS_KEY_ID "$GEN/$comp.aws.env" 2>/dev/null; then
    # Existing keys (for example in a teammate's .env) are NEVER deleted:
    # an additional key is created and written only to the git-ignored file.
    local pair
    pair="$(awsx iam create-access-key --user-name "$user" --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text 2>/dev/null)"
    [ -n "$pair" ] || { bad "$user access key"; return; }
    umask 077
    printf "AWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\n" "$(echo "$pair" | awk '{print $1}')" "$(echo "$pair" | awk '{print $2}')" > "$GEN/$comp.aws.env"
    umask 022
  fi
  ok "IAM user $user ($# policies, key in $GEN/$comp.aws.env)"
}
ensure_user identity  supporthub-identity-service \
  SupportHubIdentitySecrets=$IAM_DIR/identity-secrets-policy.json
ensure_user article   supporthub-article-service \
  SupportHubArticleS3Policy=$IAM_DIR/article-s3-policy.json \
  SupportHubArticleSQSPublisher=$IAM_DIR/article-sqs-policy.json \
  SupportHubArticleSecrets=$IAM_DIR/article-secrets-policy.json
ensure_user editorial supporthub-editorial-service \
  SupportHubEditorialSQSConsumer=$IAM_DIR/editorial-sqs-consumer-policy.json \
  SupportHubEditorialSNSPublisher=$IAM_DIR/editorial-sns-publish-policy.json \
  SupportHubEditorialSecrets=$IAM_DIR/editorial-secrets-policy.json
ensure_user search    search-analytics-service \
  SearchAnalyticsLeastPrivilege=services/search-analytics-service/infra/iam/search-analytics-policy.json \
  SupportHubSearchSecrets=$IAM_DIR/search-secrets-policy.json

# ---------------------------------------------------------------------
# 6. Editorial publication-outcome Lambda (SNS subscriber)
# ---------------------------------------------------------------------
step "Editorial Lambda"
if [ "${SKIP_LAMBDA:-false}" = true ]; then
  echo "  skipped (SKIP_LAMBDA=true)"
else
  ROLE=supporthub-editorial-publication-outcome-role
  FN=supporthub-editorial-publication-outcome
  awsx iam get-role --role-name "$ROLE" >/dev/null 2>&1 || awsx iam create-role --role-name "$ROLE" \
    --assume-role-policy-document file://services/editorial-service/lambda/publicationOutcome/trust-policy.json >/dev/null 2>&1
  awsx iam put-role-policy --role-name "$ROLE" --policy-name LambdaOwnLogGroup \
    --policy-document "file://$IAM_DIR/editorial-lambda-logs-policy.json" >/dev/null 2>&1
  if [ ! -d services/editorial-service/node_modules/pg ]; then
    if command -v npm >/dev/null; then (cd services/editorial-service && npm ci --omit=dev --silent >/dev/null 2>&1); fi
  fi
  if command -v node >/dev/null; then
    node infra/floci/lambda/build-lambda-zip.js "$GEN/publication-outcome.zip" "$GEN/certs/ca.crt" >/dev/null
  else
    docker run --rm -v "$ROOT:/repo" -w /repo node:22-alpine \
      node infra/floci/lambda/build-lambda-zip.js "$GEN/publication-outcome.zip" "$GEN/certs/ca.crt" >/dev/null
  fi
  # The Lambda receives its DB URL as a function environment variable
  # (encrypted at rest by Lambda/KMS on real AWS); read with admin access, never printed.
  LAMBDA_DB_URL="$(awsx secretsmanager get-secret-value --secret-id supporthub/shared/database --query SecretString --output text \
    | sed -E 's/.*"DATABASE_URL" *: *"([^"]+)".*/\1/')"
  LAMBDA_ENV="Variables={DATABASE_URL=$LAMBDA_DB_URL,NODE_EXTRA_CA_CERTS=/var/task/ca.crt}"
  if awsx lambda get-function --function-name "$FN" >/dev/null 2>&1 && \
     ! awsx lambda list-tags --resource "arn:aws:lambda:$REGION:$ACCOUNT:function:$FN" --output text 2>/dev/null | grep -q setup-supporthub; then
    ok "Lambda $FN already exists and was not created by this script: left unchanged"
  elif awsx lambda get-function --function-name "$FN" >/dev/null 2>&1; then
    awsx lambda update-function-code --function-name "$FN" --zip-file "fileb://$GEN/publication-outcome.zip" >/dev/null 2>&1
    awsx lambda update-function-configuration --function-name "$FN" --environment "$LAMBDA_ENV" >/dev/null 2>&1
    ok "Lambda $FN updated"
  else
    awsx lambda create-function --function-name "$FN" --runtime nodejs22.x --handler index.handler \
      --role "arn:aws:iam::$ACCOUNT:role/$ROLE" --timeout 30 --zip-file "fileb://$GEN/publication-outcome.zip" \
      --environment "$LAMBDA_ENV" --tags managed-by=setup-supporthub >/dev/null 2>&1 && ok "Lambda $FN created" || bad "Lambda $FN"
  fi
  unset LAMBDA_DB_URL LAMBDA_ENV
  [ "$FLOCI_DOCKER_SOCKET" = true ] || echo "  NOTE: Floci has no Docker socket mounted, so it cannot RUN Lambda functions (deployment only)."
  FN_ARN="arn:aws:lambda:$REGION:$ACCOUNT:function:$FN"
  if awsx sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" --output text 2>/dev/null | grep -q "$FN_ARN"; then
    ok "SNS -> Lambda subscription exists"
  else
    awsx sns subscribe --topic-arn "$TOPIC_ARN" --protocol lambda --notification-endpoint "$FN_ARN" >/dev/null 2>&1 \
      && ok "SNS -> Lambda subscription created" || bad "SNS -> Lambda subscription"
  fi
fi

# ---------------------------------------------------------------------
# 7. Application services
# ---------------------------------------------------------------------
step "Building and starting services (RATE_LIMIT_PROFILE=${RATE_LIMIT_PROFILE:-production})"
BUILD_FLAG="--build"; [ "${SUPPORTHUB_NO_BUILD:-false}" = true ] && BUILD_FLAG="--no-build"
docker compose -f "$COMPOSE_FILE" up -d $BUILD_FLAG 2>&1 | tail -5 \
  ; [ "${PIPESTATUS[0]}" -eq 0 ] && ok "docker compose up (all services)" || bad "docker compose up"

wait_http() { # name url
  for i in $(seq 1 60); do
    curl -fsS "$2" >/dev/null 2>&1 && { ok "$1 healthy ($2)"; return 0; }
    sleep 2
  done
  bad "$1 health ($2)"; return 1
}
step "Health checks"
wait_http "Identity"           http://127.0.0.1:3106/api/health
wait_http "Article"            http://127.0.0.1:3105/api/health
wait_http "Editorial"          http://127.0.0.1:3107/api/health
wait_http "Search & Analytics" http://127.0.0.1:3108/api/health
wait_http "Frontend proxy"     http://127.0.0.1:8088/index.html
wait_http "Proxy -> Identity CSRF" http://127.0.0.1:8088/api/auth/csrf
for w in supporthub-int-article-outbox-worker supporthub-int-editorial-article-worker supporthub-int-editorial-publication-worker; do
  [ "$(docker inspect -f '{{.State.Running}}' "$w" 2>/dev/null)" = true ] && ok "worker $w running" || bad "worker $w running"
done

# ---------------------------------------------------------------------
# 8. Local demo accounts (password generated, stored git-ignored)
# ---------------------------------------------------------------------
step "Demo accounts (local database only)"
if [ -z "${SUPPORTHUB_DEMO_PASSWORD:-}" ]; then
  if [ -f "$GEN/demo-accounts.txt" ]; then
    SUPPORTHUB_DEMO_PASSWORD="$(sed -n 's/^password=//p' "$GEN/demo-accounts.txt")"
  else
    SUPPORTHUB_DEMO_PASSWORD="Demo-$(rand_hex 8)"
  fi
fi
HASH="$(docker exec -e P="$SUPPORTHUB_DEMO_PASSWORD" supporthub-int-identity \
  node -e 'console.log(require("bcryptjs").hashSync(process.env.P, 12))' 2>/dev/null)"
if [ -n "$HASH" ]; then
  docker exec -i supporthub-int-postgres psql -q -U supporthub -d supporthub -v ON_ERROR_STOP=1 -v h="$HASH" >/dev/null <<'SQL' \
    && ok "demo accounts present (author, author2, editor, editor2, admin @supporthub.test)" || bad "demo accounts"
INSERT INTO users (name, email, password_hash, role) VALUES
  ('Demo Author',   'author@supporthub.test',  :'h', 'author'),
  ('Demo Author 2', 'author2@supporthub.test', :'h', 'author'),
  ('Demo Editor',   'editor@supporthub.test',  :'h', 'editor'),
  ('Demo Editor 2', 'editor2@supporthub.test', :'h', 'editor'),
  ('Demo Admin',    'admin@supporthub.test',   :'h', 'admin')
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role;
SQL
  umask 077
  printf "# Local demo accounts - git-ignored, local database only\nemails=author@supporthub.test,author2@supporthub.test,editor@supporthub.test,editor2@supporthub.test,admin@supporthub.test\npassword=%s\n" \
    "$SUPPORTHUB_DEMO_PASSWORD" > "$GEN/demo-accounts.txt"
  umask 022
else
  bad "demo accounts (could not hash password)"
fi

# ---------------------------------------------------------------------
# 9. IAM permission tests
# ---------------------------------------------------------------------
if [ "$RUN_IAM_TESTS" = true ]; then
  step "IAM permission tests (allowed and denied operations per component)"
  if AWS_MODE="$AWS_MODE" bash infra/floci/verify-iam.sh; then
    ok "IAM permission tests (see evidence/final/iam)"
  else
    bad "IAM permission tests (see evidence/final/iam)"
  fi
fi

# ---------------------------------------------------------------------
# 10. Summary
# ---------------------------------------------------------------------
echo
echo "====================================================================="
echo " SupportHub setup summary: $PASS passed, $FAIL failed"
echo "====================================================================="
printf '  %s\n' "${RESULTS[@]}" | grep FAIL || true
echo
echo " Frontend:            http://localhost:8088   (Floci mode: $FLOCI_MODE)"
echo " Floci:               $ENDPOINT"
echo " Demo accounts file:  $GEN/demo-accounts.txt (password not printed)"
echo " Logs:                docker compose -f $COMPOSE_FILE logs -f <service>"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
