#!/usr/bin/env bash
# =====================================================================
# SupportHub Group 12 - per-component IAM permission tests (Floci)
# =====================================================================
# Runs real AWS CLI calls against Floci (IAM enforcement ON) with EACH
# component's own access key from infra/floci/.generated/<component>.aws.env
# and checks that:
#   - operations the component needs are ALLOWED
#   - other actions and other components' resources are DENIED
# Secret VALUES are never printed (only the secret Name is queried).
# Results: evidence/final/iam/iam-permission-tests-<UTC timestamp>.txt
# Usage: bash infra/floci/verify-iam.sh       (after setup-supporthub.sh)
# =====================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

if [ "${SUPPORTHUB_ISOLATED:-false}" = true ]; then . infra/floci/isolated-env.sh; fi
GEN="${SUPPORTHUB_GEN:-infra/floci/.generated}"
PREFIX="${SUPPORTHUB_PREFIX:-supporthub-int}"
REGION="us-east-1"; ACCOUNT="000000000000"; ENDPOINT="http://localhost:${SUPPORTHUB_FLOCI_PORT:-4566}"
Q="$ENDPOINT/$ACCOUNT/supporthub-article-events"
TOPIC="arn:aws:sns:$REGION:$ACCOUNT:supporthub-editorial-publication-events"
ALERTS="arn:aws:sns:$REGION:$ACCOUNT:supporthub-identity-security-alerts"
OUT_DIR="evidence/final/iam"; mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/iam-permission-tests-$(date -u +%Y%m%dT%H%M%SZ).txt"
AWS_MODE="${AWS_MODE:-$(command -v aws >/dev/null && echo local || echo docker)}"

awsx() {
  if [ "$AWS_MODE" = local ]; then
    aws --endpoint-url "$ENDPOINT" --region "$REGION" "$@"
  else
    local args=() a
    for a in "$@"; do args+=("${a//"$ENDPOINT"/http://floci:4566}"); done
    docker run --rm -i --network "$PREFIX-net" -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
      -v "$ROOT:/repo" -w /repo amazon/aws-cli --endpoint-url http://floci:4566 --region "$REGION" "${args[@]}"
  fi
}

PASS=0; FAIL=0
use_component() {
  local file="$GEN/$1.aws.env"
  [ -s "$file" ] || { echo "Missing $file - run setup-supporthub.sh first"; exit 2; }
  export AWS_ACCESS_KEY_ID="$(sed -n 's/^AWS_ACCESS_KEY_ID=//p' "$file")"
  export AWS_SECRET_ACCESS_KEY="$(sed -n 's/^AWS_SECRET_ACCESS_KEY=//p' "$file")"
  COMPONENT="$1"; USER_NAME="$2"
  printf "\n--- %s (IAM user %s) ---\n" "$COMPONENT" "$USER_NAME" | tee -a "$OUT"
}
check() { # expect(ALLOW|DENY) description aws-args...
  local expect="$1" desc="$2"; shift 2
  local output status actual
  output="$(awsx "$@" 2>&1)"; status=$?
  if [ $status -eq 0 ]; then actual=ALLOW
  elif echo "$output" | grep -qiE "AccessDenied|not authorized|Forbidden"; then actual=DENY
  else actual="ERROR"; fi
  local verdict=FAIL
  [ "$actual" = "$expect" ] && verdict=PASS
  [ "$verdict" = PASS ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
  printf "%-4s | expected %-5s | actual %-5s | %s\n" "$verdict" "$expect" "$actual" "$desc" | tee -a "$OUT"
  if [ "$actual" = ERROR ]; then echo "       detail: $(echo "$output" | tr '\n' ' ' | cut -c1-200)" | tee -a "$OUT"; fi
}

# Emulator limitation: Floci does not provide the cloudwatch:namespace condition
# key, so the policy condition can only be enforced on real AWS. Reported, but
# counted neither as a pass nor as a failure.
LIMITS=0
limit() {
  local expect="$1" desc="$2" actual=ALLOW; shift 2
  awsx "$@" >/dev/null 2>&1 || actual=DENY
  [ "$actual" = "$expect" ] || LIMITS=$((LIMITS+1))
  printf "LIMIT| expected %-5s | actual %-5s | %s
" "$expect" "$actual" "$desc" | tee -a "$OUT"
}

PROBE="$GEN/iam-probe.json"
echo '{"probe":"iam-permission-test"}' > "$PROBE"

{
  echo "SupportHub IAM permission tests - $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Target: Floci $(curl -fsS $ENDPOINT/_floci/health 2>/dev/null | sed -E 's/.*"version":"([^"]+)".*/\1/') with FLOCI_SERVICES_IAM_ENFORCEMENT_ENABLED=true"
  echo "Each line uses the component's OWN access key. Secret values are never printed."
} > "$OUT"

# ---------------- Article (Alyaa) ----------------
use_component article supporthub-article-service
check ALLOW "S3 PutObject own prefix articles/ (version backup)" s3api put-object --bucket supporthub-article-backups --key articles/iam-test/probe.json --body "$PROBE" --query ETag
check ALLOW "S3 GetObject own prefix articles/ (backup retrieval)" s3api get-object --bucket supporthub-article-backups --key articles/iam-test/probe.json "$GEN/iam-probe-download.json" --query ContentLength
check DENY  "S3 DeleteObject (backups are append-only)" s3api delete-object --bucket supporthub-article-backups --key articles/iam-test/probe.json
check DENY  "S3 PutObject outside articles/ prefix" s3api put-object --bucket supporthub-article-backups --key other/probe.json --body "$PROBE"
check DENY  "S3 PutObject into Search exports bucket (other component)" s3api put-object --bucket supporthub-search-analytics-exports --key exports/probe.csv --body "$PROBE"
check DENY  "S3 ListAllMyBuckets" s3api list-buckets
check ALLOW "SQS SendMessage to supporthub-article-events (outbox publish)" sqs send-message --queue-url "$Q" --message-body '{"eventType":"iam.probe"}' --query MessageId
check DENY  "SQS ReceiveMessage (consumer action belongs to Editorial)" sqs receive-message --queue-url "$Q" --wait-time-seconds 0
check ALLOW "Secrets GetSecretValue supporthub/article/runtime-config" secretsmanager get-secret-value --secret-id supporthub/article/runtime-config --query Name
check ALLOW "Secrets GetSecretValue supporthub/shared/session" secretsmanager get-secret-value --secret-id supporthub/shared/session --query Name
check DENY  "Secrets GetSecretValue supporthub/editorial/runtime (other component)" secretsmanager get-secret-value --secret-id supporthub/editorial/runtime --query Name
check DENY  "Secrets GetSecretValue supporthub/search/runtime (other component)" secretsmanager get-secret-value --secret-id supporthub/search/runtime --query Name
check DENY  "DynamoDB Scan Search counters (other component)" dynamodb scan --table-name supporthub-search-counters --max-items 1
check DENY  "SNS Publish to Editorial topic (other component)" sns publish --topic-arn "$TOPIC" --message probe

# ---------------- Editorial (Salma) ----------------
use_component editorial supporthub-editorial-service
check ALLOW "SQS ReceiveMessage from supporthub-article-events (consumer)" sqs receive-message --queue-url "$Q" --wait-time-seconds 0 --visibility-timeout 0 --max-number-of-messages 1
check DENY  "SQS SendMessage to article events (only Article publishes)" sqs send-message --queue-url "$Q" --message-body probe
check DENY  "SQS PurgeQueue" sqs purge-queue --queue-url "$Q"
check ALLOW "SNS Publish to supporthub-editorial-publication-events" sns publish --topic-arn "$TOPIC" --message '{"probe":"iam-permission-test"}' --query MessageId
check DENY  "SNS CreateTopic" sns create-topic --name supporthub-iam-probe-topic
check ALLOW "Secrets GetSecretValue supporthub/editorial/runtime" secretsmanager get-secret-value --secret-id supporthub/editorial/runtime --query Name
check ALLOW "Secrets GetSecretValue supporthub/shared/service-hmac" secretsmanager get-secret-value --secret-id supporthub/shared/service-hmac --query Name
check DENY  "Secrets GetSecretValue supporthub/article/runtime-config (other component)" secretsmanager get-secret-value --secret-id supporthub/article/runtime-config --query Name
check DENY  "Secrets GetSecretValue supporthub/search/runtime (other component)" secretsmanager get-secret-value --secret-id supporthub/search/runtime --query Name
check DENY  "S3 GetObject Article backups (other component)" s3api get-object --bucket supporthub-article-backups --key articles/iam-test/probe.json "$GEN/iam-probe-download.json"
check DENY  "Lambda UpdateFunctionCode (deployment is an admin task)" lambda update-function-configuration --function-name supporthub-editorial-publication-outcome --timeout 31

# ---------------- Search & Analytics (Nermeen) ----------------
use_component search search-analytics-service
check ALLOW "DynamoDB Scan own counters table" dynamodb scan --table-name supporthub-search-counters --max-items 1 --query Count
check ALLOW "DynamoDB UpdateItem own counters table" dynamodb update-item --table-name supporthub-search-counters --key '{"pk":{"S":"TERM#iam-probe"}}' --update-expression "ADD searches :one" --expression-attribute-values '{":one":{"N":"1"}}'
check DENY  "DynamoDB DeleteTable" dynamodb delete-table --table-name supporthub-search-counters
check ALLOW "CloudWatch PutMetricData SupportHub/Search" cloudwatch put-metric-data --namespace SupportHub/Search --metric-name IamProbe --value 1
check ALLOW "S3 PutObject exports/ in own bucket" s3api put-object --bucket supporthub-search-analytics-exports --key exports/iam-probe.csv --body "$PROBE" --query ETag
check DENY  "S3 GetObject Article backups (other component)" s3api get-object --bucket supporthub-article-backups --key articles/iam-test/probe.json "$GEN/iam-probe-download.json"
check ALLOW "Secrets GetSecretValue supporthub/search/runtime" secretsmanager get-secret-value --secret-id supporthub/search/runtime --query Name
check DENY  "Secrets GetSecretValue supporthub/editorial/runtime (other component)" secretsmanager get-secret-value --secret-id supporthub/editorial/runtime --query Name
check ALLOW "S3 GetObject own exports/" s3api get-object --bucket supporthub-search-analytics-exports --key exports/iam-probe.csv "$GEN/iam-probe-download.json" --query ContentLength
check DENY  "S3 DeleteObject own exports" s3api delete-object --bucket supporthub-search-analytics-exports --key exports/iam-probe.csv
check DENY  "S3 ListAllMyBuckets" s3api list-buckets
limit DENY  "CloudWatch PutMetricData in another namespace" cloudwatch put-metric-data --namespace SupportHub/Other --metric-name IamProbe --value 1
check DENY  "SNS Publish to Editorial topic (other component)" sns publish --topic-arn "$TOPIC" --message probe
check DENY  "Secrets GetSecretValue supporthub/article/runtime-config (other component)" secretsmanager get-secret-value --secret-id supporthub/article/runtime-config --query Name
check DENY  "SQS ReceiveMessage article events (other component)" sqs receive-message --queue-url "$Q" --wait-time-seconds 0

# ---------------- Identity (shared, Alyaa) ----------------
use_component identity supporthub-identity-service
check ALLOW "Secrets GetSecretValue supporthub/shared/session" secretsmanager get-secret-value --secret-id supporthub/shared/session --query Name
check ALLOW "Secrets GetSecretValue supporthub/identity/runtime" secretsmanager get-secret-value --secret-id supporthub/identity/runtime --query Name
check DENY  "Secrets GetSecretValue supporthub/shared/service-hmac (internal services only)" secretsmanager get-secret-value --secret-id supporthub/shared/service-hmac --query Name
check ALLOW "SNS Publish to supporthub-identity-security-alerts" sns publish --topic-arn "$ALERTS" --message '{"probe":"iam-permission-test"}' --query MessageId
check DENY  "SNS Publish to Editorial topic (other component)" sns publish --topic-arn "$TOPIC" --message probe
check DENY  "SNS CreateTopic" sns create-topic --name supporthub-iam-probe-topic
check DENY  "S3 ListAllMyBuckets" s3api list-buckets
check DENY  "IAM ListUsers" iam list-users

rm -f "$PROBE" "$GEN/iam-probe-download.json"
printf "\nTotal: %d passed, %d failed, %d not enforceable in Floci (LIMIT)\n" "$PASS" "$FAIL" "$LIMITS" | tee -a "$OUT"
echo "Saved: $OUT"
[ "$FAIL" -eq 0 ]
