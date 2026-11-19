#!/usr/bin/env bash
# Creates the Search & Analytics AWS resources in Floci.
# Safe to run more than once: existing resources are skipped.
# Usage (from services/search-analytics-service):  bash infra/setup-floci.sh
set -euo pipefail
export AWS_PROFILE="${AWS_PROFILE:-floci}"
export MSYS_NO_PATHCONV=1

TABLE="${DYNAMODB_COUNTERS_TABLE:-supporthub-search-counters}"
BUCKET="${S3_EXPORT_BUCKET:-supporthub-search-analytics-exports}"

echo "== Floci account"
aws sts get-caller-identity --query Account --output text

echo "== DynamoDB table: $TABLE"
if aws dynamodb describe-table --table-name "$TABLE" >/dev/null 2>&1; then
  echo "exists - skipped"
else
  aws dynamodb create-table --table-name "$TABLE" \
    --attribute-definitions AttributeName=pk,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --query TableDescription.TableStatus --output text
fi

echo "== CloudWatch namespace: SupportHub/Search"
echo "created automatically by the service's first metric (no setup needed)"

echo "== S3 export bucket (private): $BUCKET"
if aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  echo "exists - skipped"
else
  aws s3api create-bucket --bucket "$BUCKET" >/dev/null && echo "created"
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true \
  && echo "public access blocked" || echo "public access block not supported by this emulator"
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' \
  && echo "default encryption on" || echo "bucket encryption not supported by this emulator"

echo "Done."