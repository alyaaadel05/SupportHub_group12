#!/usr/bin/env bash
# =====================================================================
# SupportHub Group 12 - runtime proof of AWS usage per component (read-only)
# =====================================================================
# Shows that each student's AWS services hold REAL application data after
# the application has been used (e.g. after tests/integration/lifecycle-e2e.mjs
# or the k6 workflow test): objects, messages, subscriptions, metrics,
# counters and the secret names each container loaded at start-up.
# Never prints a secret value. Uses Floci admin (test/test) read-only calls.
# Output: evidence/final/aws/aws-usage-<UTC timestamp>.txt
# Usage: bash infra/floci/verify-aws-usage.sh
# =====================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; cd "$ROOT" || exit 2
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1
EP=http://localhost:4566; ACC=000000000000
P="${CONTAINER_PREFIX:-supporthub-int-}"
if command -v aws >/dev/null; then A() { aws --endpoint-url "$EP" "$@"; }
else A() { local a=() x; for x in "$@"; do a+=("${x//localhost:4566/floci:4566}"); done
  docker run --rm -i --network supporthub-int-net -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
    amazon/aws-cli --endpoint-url http://floci:4566 "${a[@]}"; }; fi
mkdir -p evidence/final/aws
OUT="evidence/final/aws/aws-usage-$(date -u +%Y%m%dT%H%M%SZ).txt"
exec > >(tee "$OUT") 2>&1
secrets_loaded() { docker logs "$1" 2>&1 | grep '^\[secrets\]' | sort -u | sed 's/^/    /'; }

echo "SupportHub AWS usage evidence - $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Floci: $(curl -fsS $EP/_floci/health | sed -E 's/.*"version":"([^"]+)".*/\1/')"

echo; echo "=== ALYAA - Article & Category Management (IAM user supporthub-article-service)"
echo "[S3] supporthub-article-backups objects (version backups written by POST /versions/:id/export):"
A s3api list-objects-v2 --bucket supporthub-article-backups --prefix articles/ --query 'Contents[].[Key,Size]' --output text | head -10 | sed 's/^/    /'
echo "[SQS] supporthub-article-events (outbox publisher) attributes:"
A sqs get-queue-attributes --queue-url "$EP/$ACC/supporthub-article-events" --attribute-names ApproximateNumberOfMessages RedrivePolicy --output text | sed 's/^/    /'
echo "[SQS] outbox rows published to SQS (database):"
docker exec ${P}postgres psql -U supporthub -tAc "SELECT status, count(*) FROM article_event_outbox GROUP BY status" 2>/dev/null | sed 's/^/    /'
echo "[Secrets Manager] secrets loaded by the Article API at start-up (names only):"
secrets_loaded ${P}article
echo "[IAM] inline policies:"; A iam list-user-policies --user-name supporthub-article-service --output text | sed 's/^/    /'

echo; echo "=== SALMA - Editorial Workflow & Publication (IAM user supporthub-editorial-service)"
echo "[SQS] events consumed into editorial_event_inbox (database):"
docker exec ${P}postgres psql -U supporthub -tAc "SELECT event_type, count(*) FROM editorial_event_inbox GROUP BY event_type" 2>/dev/null | sed 's/^/    /'
echo "[SNS] supporthub-editorial-publication-events subscriptions:"
A sns list-subscriptions-by-topic --topic-arn arn:aws:sns:us-east-1:$ACC:supporthub-editorial-publication-events --query 'Subscriptions[].[Protocol,Endpoint]' --output text | sed 's/^/    /'
echo "[SNS] publication events published (database outbox):"
docker exec ${P}postgres psql -U supporthub -tAc "SELECT state, count(*) FROM editorial_publication_event_outbox GROUP BY state" 2>/dev/null | sed 's/^/    /'
echo "[Lambda] supporthub-editorial-publication-outcome:"
A lambda get-function-configuration --function-name supporthub-editorial-publication-outcome --query '[Runtime,Handler,State,Role]' --output text | sed 's/^/    /'
echo "[Lambda] receipts written by the Lambda for SNS events (database):"
docker exec ${P}postgres psql -U supporthub -tAc "SELECT count(*) FROM editorial_publication_event_receipts" 2>/dev/null | sed 's/^/    /'
echo "[Secrets Manager] secrets loaded by the Editorial API at start-up (names only):"
secrets_loaded ${P}editorial
echo "[IAM] inline policies:"; A iam list-user-policies --user-name supporthub-editorial-service --output text | sed 's/^/    /'

echo; echo "=== NERMEEN - Search, Feedback & Analytics (IAM user search-analytics-service)"
echo "[DynamoDB] supporthub-search-counters items (live counters):"
A dynamodb scan --table-name supporthub-search-counters --select COUNT --query '[Count]' --output text | sed 's/^/    items: /'
A dynamodb scan --table-name supporthub-search-counters --max-items 5 --query 'Items[].pk.S' --output text | sed 's/^/    sample keys: /'
echo "[CloudWatch] metrics in namespace SupportHub/Search:"
A cloudwatch list-metrics --namespace SupportHub/Search --query 'Metrics[].MetricName' --output text | tr '\t' '\n' | sort -u | tr '\n' ' ' | sed 's/^/    /'; echo
echo "[S3] supporthub-search-analytics-exports objects (CSV exports):"
A s3api list-objects-v2 --bucket supporthub-search-analytics-exports --prefix exports/ --query 'Contents[].[Key,Size]' --output text | head -5 | sed 's/^/    /'
echo "[Secrets Manager] secrets loaded by the Search API at start-up (names only):"
secrets_loaded ${P}search
echo "[IAM] inline policies:"; A iam list-user-policies --user-name search-analytics-service --output text | sed 's/^/    /'

echo; echo "=== SHARED - Identity Service (Alyaa) (IAM user supporthub-identity-service)"
echo "[Secrets Manager] secrets loaded by Identity at start-up (names only):"
secrets_loaded ${P}identity
echo "[Secrets Manager] all SupportHub secrets (names only):"
A secretsmanager list-secrets --query 'SecretList[].Name' --output text | tr '\t' '\n' | sort | sed 's/^/    /'
echo; echo "Saved $OUT"
