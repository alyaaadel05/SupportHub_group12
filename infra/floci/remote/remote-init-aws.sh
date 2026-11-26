#!/usr/bin/env bash
# =====================================================================
# SupportHub Group 12 - initialise the AWS layer on the REMOTE Floci host.
# Run ON THE VM from the repository root, after
#   docker compose -f infra/floci/remote/docker-compose.remote.yml up -d
#
#   SUPPORTHUB_REMOTE_HOST=true bash infra/floci/remote/remote-init-aws.sh
#
# Input (git-ignored, chmod 600, never printed):
#   infra/floci/.generated/remote/production.env
#     ARTICLE_DATABASE_URL=   Neon pooled URL, role supporthub_article_app
#     EDITORIAL_DATABASE_URL= Neon pooled URL, role supporthub_editorial_app
#     SERVICE_SHARED_SECRET=  same HMAC secret as the Vercel services
#
# Creates or REUSES (idempotent; nothing deleted, no key rotated):
#   S3 buckets (Block Public Access), SQS production queue + DLQ (redrive 5),
#   SNS topics, DynamoDB table, Secrets Manager secrets, IAM users + scoped
#   policies + one access key each (written to .generated/remote/*.aws.env, 600),
#   Lambda publication-outcome (+ role, SNS subscription).
# All AWS calls run in a short-lived amazon/aws-cli container on the private
# Docker network; Floci is never published on a host port.
# =====================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1
# Native path for Docker bind mounts (Git Bash on Windows rehearsal); plain path on Linux.
mp() { (cd -- "$1" && pwd -W 2>/dev/null) || (cd -- "$1" && pwd); }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"; cd "$ROOT" || exit 2
# Modes: remote (VM, Floci publishes NO port) or local (demo laptop, Floci published on loopback only).
FLOCI_MODE="${SUPPORTHUB_FLOCI_MODE:-remote}"
case "$FLOCI_MODE" in
  remote) [ "${SUPPORTHUB_REMOTE_HOST:-false}" = true ] || { echo "refusing: run on the remote Floci host with SUPPORTHUB_REMOTE_HOST=true"; exit 3; } ;;
  local)  [ "${SUPPORTHUB_LOCAL_APPROVED:-false}" = true ] || { echo "refusing: local mode changes the local Floci; set SUPPORTHUB_LOCAL_APPROVED=true"; exit 3; } ;;
  *) echo "SUPPORTHUB_FLOCI_MODE must be remote or local"; exit 2 ;;
esac
ARTICLE_WORKER_USER="${ARTICLE_WORKER_USER:-supporthub-prod-article-worker}"
EDITORIAL_WORKER_USER="${EDITORIAL_WORKER_USER:-supporthub-prod-editorial-worker}"
FLOCI="${SUPPORTHUB_FLOCI_CONTAINER:-supporthub-floci}"
NETWORK="${SUPPORTHUB_NETWORK:-supporthub-net}"
GEN="${SUPPORTHUB_GEN:-infra/floci/.generated/remote}"
ACC=000000000000; REGION=us-east-1
QUEUE=supporthub-article-events-production; DLQ=$QUEUE-dlq
TOPIC_PUB=supporthub-editorial-publication-events; TOPIC_ALERT=supporthub-identity-security-alerts
FN=supporthub-editorial-publication-outcome; FN_ROLE=$FN-role
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  [PASS] $1"; }
bad() { FAIL=$((FAIL+1)); echo "  [FAIL] $1"; }
die() { echo "ERROR: $1" >&2; exit "${2:-2}"; }
step() { echo; echo "==> $1"; }

# ---- safety preflight ---------------------------------------------------------
[ "$(docker inspect -f '{{.State.Running}}' "$FLOCI" 2>/dev/null)" = true ] || die "$FLOCI is not running" 4
if [ "$FLOCI_MODE" = remote ]; then
  [ -z "$(docker port "$FLOCI" 2>/dev/null)" ] || die "$FLOCI publishes host ports - refusing (remote Floci must stay private)" 3
else
  docker port "$FLOCI" 2>/dev/null | grep -vE '^[0-9]+/tcp -> (127.0.0.1|[::1]):' | grep -q . && die "$FLOCI is published beyond loopback - refusing" 3
fi
docker inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' "$FLOCI" | grep -q /var/run/docker.sock || die "$FLOCI has no Docker socket (Lambda/ECS cannot run)" 3
case "$GEN" in infra/floci/.generated/*) ;; *) die "SUPPORTHUB_GEN must be under infra/floci/.generated" ;; esac
mkdir -p -- "$GEN" && chmod 700 -- "$GEN"
ENVF="$GEN/production.env"
[ -f "$ENVF" ] || die "missing $ENVF (see header)"
chmod 600 -- "$ENVF"
for k in ARTICLE_DATABASE_URL EDITORIAL_DATABASE_URL SERVICE_SHARED_SECRET; do
  grep -q "^$k=." "$ENVF" || die "$k missing in $ENVF"
done

# ---- temporary files (dedicated directory, allow-listed names, exact deletes) --
TMP="$ROOT/$GEN/init-tmp"; TMP_NAMES=" secret.json lambda-env.json "
mkdir -p -- "$TMP" && chmod 700 -- "$TMP"
[ -d "$TMP" ] && [ ! -L "$TMP" ] || die "temporary directory missing or a symlink"
case "$(cd -- "$TMP" && pwd -P)" in "$(cd -- "$ROOT" && pwd -P)"/infra/floci/.generated/*/init-tmp) ;; *) die "unexpected temporary directory $TMP" ;; esac
# Repository-relative path (the script runs from $ROOT): valid for node on Linux and Windows.
tmpfile() { case "$TMP_NAMES" in *" $1 "*) echo "$GEN/init-tmp/$1" ;; *) die "temporary name $1 not allowed" ;; esac; }
cleanup_tmp() {
  local n; for n in $TMP_NAMES; do [ -f "$TMP/$n" ] && [ ! -L "$TMP/$n" ] && rm -f -- "$TMP/$n"; done
  rmdir -- "$TMP" 2>/dev/null || true
}
trap cleanup_tmp EXIT
umask 077

# AWS CLI against the private Floci (admin identity of the emulator, never exposed).
A() { timeout 90 docker run --rm -i --network "$NETWORK" -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test \
        -e AWS_DEFAULT_REGION=$REGION -e AWS_PAGER= -v "$(mp "$ROOT"):/repo:ro" -w /repo \
        amazon/aws-cli --cli-connect-timeout 5 --cli-read-timeout 60 --endpoint-url http://floci:4566 "$@"; }
A sts get-caller-identity >/dev/null 2>&1 && ok "Floci reachable on $NETWORK (no host port)" || die "Floci not reachable on $NETWORK" 4

step "S3 buckets"
for b in supporthub-article-backups supporthub-search-analytics-exports; do
  A s3api head-bucket --bucket "$b" >/dev/null 2>&1 || A s3api create-bucket --bucket "$b" >/dev/null 2>&1
  A s3api put-public-access-block --bucket "$b" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true >/dev/null 2>&1 \
    && ok "bucket $b (Block Public Access on)" || bad "bucket $b"
done

step "SQS production queue + DLQ"
A sqs get-queue-url --queue-name "$DLQ" >/dev/null 2>&1 || A sqs create-queue --queue-name "$DLQ" >/dev/null 2>&1
REDRIVE="{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"arn:aws:sqs:$REGION:$ACC:$DLQ\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\",\"VisibilityTimeout\":\"30\"}"
if A sqs get-queue-url --queue-name "$QUEUE" >/dev/null 2>&1; then
  # Existing queue: never change its attributes (visibility timeout, messages) if the
  # redrive policy already targets the DLQ; only add the redrive when it is missing.
  if ! A sqs get-queue-attributes --queue-url "http://floci:4566/$ACC/$QUEUE" --attribute-names RedrivePolicy --output text 2>/dev/null | grep -q "$DLQ"; then
    A sqs set-queue-attributes --queue-url "http://floci:4566/$ACC/$QUEUE" --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"arn:aws:sqs:$REGION:$ACC:$DLQ\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\"}" >/dev/null 2>&1
  fi
else
  A sqs create-queue --queue-name "$QUEUE" --attributes "$REDRIVE" >/dev/null 2>&1
fi
A sqs get-queue-attributes --queue-url "http://floci:4566/$ACC/$QUEUE" --attribute-names RedrivePolicy --output text 2>/dev/null | grep -q "$DLQ" \
  && ok "queue $QUEUE -> DLQ $DLQ after 5 receives" || bad "queue/redrive"

step "SNS topics and DynamoDB table"
for t in "$TOPIC_PUB" "$TOPIC_ALERT"; do A sns create-topic --name "$t" >/dev/null 2>&1 && ok "topic $t" || bad "topic $t"; done
A dynamodb describe-table --table-name supporthub-search-counters >/dev/null 2>&1 \
  || A dynamodb create-table --table-name supporthub-search-counters --attribute-definitions AttributeName=pk,AttributeType=S \
       --key-schema AttributeName=pk,KeyType=HASH --billing-mode PAY_PER_REQUEST >/dev/null 2>&1
A dynamodb describe-table --table-name supporthub-search-counters >/dev/null 2>&1 && ok "table supporthub-search-counters" || bad "dynamodb table"

step "Secrets Manager (values from $ENVF, never printed)"
put_secret() { # secret-name json-key env-var
  local f; f="$(tmpfile secret.json)"
  node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8");const v=(t.match(new RegExp("^"+process.argv[3]+"=(.+)$","m"))||[])[1];if(!v){process.exit(3)}require("fs").writeFileSync(process.argv[4],JSON.stringify({[process.argv[2]]:v.trim()}),{mode:0o600})' \
    "$ENVF" "$2" "$3" "$f" || { bad "secret $1 (value $3 missing)"; return; }
  if A secretsmanager describe-secret --secret-id "$1" >/dev/null 2>&1; then
    ok "secret $1 exists (kept; set SUPPORTHUB_UPDATE_SECRETS=true to update)"
    [ "${SUPPORTHUB_UPDATE_SECRETS:-false}" = true ] && A secretsmanager put-secret-value --secret-id "$1" --secret-string "file:///repo/$GEN/init-tmp/secret.json" >/dev/null 2>&1 && ok "secret $1 updated"
  else
    A secretsmanager create-secret --name "$1" --secret-string "file:///repo/$GEN/init-tmp/secret.json" >/dev/null 2>&1 && ok "secret $1 created" || bad "secret $1"
  fi
  rm -f -- "$f"
}
put_secret supporthub/article/database DATABASE_URL ARTICLE_DATABASE_URL
put_secret supporthub/editorial/database DATABASE_URL EDITORIAL_DATABASE_URL
put_secret supporthub/shared/service-hmac SERVICE_SHARED_SECRET SERVICE_SHARED_SECRET

step "IAM users (scoped policies, one key each, keys never rotated or printed)"
ensure_user() { # user key-file policy-name=file ...
  local user="$1" keyfile="$GEN/$2"; shift 2
  A iam get-user --user-name "$user" >/dev/null 2>&1 || A iam create-user --user-name "$user" >/dev/null 2>&1
  local spec
  for spec in "$@"; do
    A iam put-user-policy --user-name "$user" --policy-name "${spec%%=*}" --policy-document "file:///repo/${spec#*=}" >/dev/null 2>&1 \
      || { bad "$user policy ${spec%%=*}"; return; }
  done
  if ! grep -q '^AWS_ACCESS_KEY_ID=' "$keyfile" 2>/dev/null; then
    local pair; pair="$(A iam create-access-key --user-name "$user" --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text 2>/dev/null)"
    [ -n "$pair" ] || { bad "$user access key"; return; }
    printf 'AWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\n' "$(echo "$pair" | awk '{print $1}')" "$(echo "$pair" | awk '{print $2}')" > "$keyfile"
    chmod 600 -- "$keyfile"; unset pair
  fi
  ok "IAM user $user ($# policies, key in $keyfile)"
}
# ECS workers (keys injected into the tasks via Secrets Manager by deploy-ecs-workers.sh)
ensure_user "$ARTICLE_WORKER_USER" article.aws.env \
  ProductionArticleSqsPublish=infra/iam/production-article-sqs-publish-policy.json \
  ArticleWorkerSecrets=infra/iam/remote-article-worker-secrets-policy.json
ensure_user "$EDITORIAL_WORKER_USER" editorial.aws.env \
  ProductionEditorialSqsConsume=infra/iam/production-editorial-sqs-consumer-policy.json \
  EditorialSnsPublish=infra/iam/editorial-sns-publish-policy.json \
  EditorialWorkerSecrets=infra/iam/remote-editorial-worker-secrets-policy.json
# Vercel APIs (keys handed to the operator for the Vercel environment - approval required).
# SUPPORTHUB_SKIP_VERCEL_USERS=true leaves these users and their keys completely untouched.
if [ "${SUPPORTHUB_SKIP_VERCEL_USERS:-false}" = true ]; then
  echo "  Vercel-facing IAM users skipped (SUPPORTHUB_SKIP_VERCEL_USERS=true): no policy change, no new key"
else
ensure_user supporthub-article-service vercel-article.aws.env SupportHubArticleS3Policy=infra/iam/article-s3-policy.json
ensure_user search-analytics-service vercel-search.aws.env SearchAnalyticsLeastPrivilege=services/search-analytics-service/infra/iam/search-analytics-policy.json
ensure_user supporthub-identity-service vercel-identity.aws.env SupportHubIdentitySNSPublisher=infra/iam/identity-sns-policy.json
fi

step "Lambda publication-outcome (SNS subscriber, writes receipts to Neon)"
LTRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
A iam get-role --role-name "$FN_ROLE" >/dev/null 2>&1 || A iam create-role --role-name "$FN_ROLE" --assume-role-policy-document "$LTRUST" >/dev/null 2>&1
A iam put-role-policy --role-name "$FN_ROLE" --policy-name LambdaOwnLogGroup --policy-document file:///repo/infra/iam/editorial-lambda-logs-policy.json >/dev/null 2>&1 \
  && ok "role $FN_ROLE (own log group only)" || bad "lambda role"
ZIP="$GEN/publication-outcome.zip"
if [ ! -d services/editorial-service/node_modules/pg ]; then
  timeout 600 docker run --rm -v "$(mp "$ROOT/services/editorial-service"):/svc" -w /svc node:22-alpine npm ci --omit=dev --silent >/dev/null 2>&1 \
    && ok "editorial production dependencies installed (for the Lambda package)" || bad "npm ci for Lambda package"
fi
# Neon uses a public CA. Only a private-CA database (rehearsal) bundles $GEN/certs/ca.crt.
CA_ARG=""; [ -f "$GEN/certs/ca.crt" ] && CA_ARG="$GEN/certs/ca.crt"
node infra/floci/lambda/build-lambda-zip.js "$ZIP" $CA_ARG >/dev/null && chmod 600 -- "$ZIP" \
  && ok "Lambda package built ($ZIP$([ -n "$CA_ARG" ] && echo ', private CA bundled' || echo ', public CA'))" || bad "Lambda package"
LENV="$(tmpfile lambda-env.json)"
node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8");const v=t.match(/^EDITORIAL_DATABASE_URL=(.+)$/m)[1].trim();const vars={DATABASE_URL:v};if(process.argv[3])vars.NODE_EXTRA_CA_CERTS="/var/task/ca.crt";require("fs").writeFileSync(process.argv[2],JSON.stringify({Variables:vars}),{mode:0o600})' "$ENVF" "$LENV" "$CA_ARG"
if A lambda get-function --function-name "$FN" >/dev/null 2>&1; then
  A lambda update-function-code --function-name "$FN" --zip-file "fileb:///repo/$ZIP" >/dev/null 2>&1 \
    && A lambda update-function-configuration --function-name "$FN" --environment "file:///repo/$GEN/init-tmp/lambda-env.json" >/dev/null 2>&1 \
    && ok "Lambda $FN updated" || bad "Lambda update"
else
  A lambda create-function --function-name "$FN" --runtime nodejs22.x --handler index.handler --timeout 30 \
    --role "arn:aws:iam::$ACC:role/$FN_ROLE" --zip-file "fileb:///repo/$ZIP" \
    --environment "file:///repo/$GEN/init-tmp/lambda-env.json" --tags managed-by=remote-init-aws >/dev/null 2>&1 \
    && ok "Lambda $FN created" || bad "Lambda create"
fi
rm -f -- "$LENV"
FN_ARN="arn:aws:lambda:$REGION:$ACC:function:$FN"; TOPIC_ARN="arn:aws:sns:$REGION:$ACC:$TOPIC_PUB"
if A sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" --output text 2>/dev/null | grep -q "$FN_ARN"; then ok "SNS -> Lambda subscription exists"
else A sns subscribe --topic-arn "$TOPIC_ARN" --protocol lambda --notification-endpoint "$FN_ARN" >/dev/null 2>&1 && ok "SNS -> Lambda subscription created" || bad "subscription"; fi

step "Summary"
echo "  $PASS passed, $FAIL failed. Key files (600, never commit): $(ls "$GEN" | grep -E 'aws\.env$' | tr '\n' ' ')"
[ "$FAIL" -eq 0 ]
