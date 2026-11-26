#!/usr/bin/env bash
# =====================================================================
# SupportHub Group 12 - READ-ONLY inventory of a Floci instance, for before/after
# comparisons (e.g. when recreating the container). Never receives, purges or
# changes anything. Secret VALUES and key secrets are never read; access key ids
# are shown only as 12-char sha256 fingerprints.
#   bash infra/floci/floci-inventory.sh [endpoint]   (default http://127.0.0.1:4566)
# =====================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1 AWS_PAGER="" AWS_DEFAULT_REGION=us-east-1
EP="${1:-http://127.0.0.1:4566}"
A() { AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test timeout 40 aws --cli-connect-timeout 5 --cli-read-timeout 30 --endpoint-url "$EP" "$@"; }
fp() { printf %s "$1" | sha256sum | cut -c1-12; }
echo "# Floci inventory $EP $(date -u +%FT%TZ) version=$(curl -s -m 5 "$EP/_floci/health" | sed -E 's/.*"version":"([^"]+)".*/\1/')"
echo "## SQS (visible / in-flight / delayed, redrive)"
for u in $(A sqs list-queues --query 'QueueUrls' --output text 2>/dev/null); do
  n="${u##*/}"
  a="$(A sqs get-queue-attributes --queue-url "$EP/000000000000/$n" --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateNumberOfMessagesDelayed RedrivePolicy VisibilityTimeout \
       --query 'Attributes.[ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible,ApproximateNumberOfMessagesDelayed,VisibilityTimeout,RedrivePolicy]' --output text 2>/dev/null | tr '\t' '|')"
  echo "queue $n | $a"
done | sort
echo "## SNS topics and subscriptions"
A sns list-topics --query 'Topics[].TopicArn' --output text | tr '\t' '\n' | sort | sed 's/^/topic /'
A sns list-subscriptions --query 'Subscriptions[].[TopicArn,Protocol,Endpoint]' --output text | sort | sed 's/^/subscription /'
echo "## Secrets Manager (names only)"
A secretsmanager list-secrets --query 'SecretList[].Name' --output text | tr '\t' '\n' | sort | sed 's/^/secret /'
echo "## IAM users, inline policies, access key fingerprints"
for u in $(A iam list-users --query 'Users[].UserName' --output text | tr '\t' '\n' | sort); do
  p="$(A iam list-user-policies --user-name "$u" --query 'PolicyNames' --output text | tr '\t' ',')"
  k="$(for id in $(A iam list-access-keys --user-name "$u" --query 'AccessKeyMetadata[].AccessKeyId' --output text); do fp "$id"; done | sort | tr '\n' ',')"
  echo "user $u | policies=$p | keys=$k"
done
echo "## IAM roles"
A iam list-roles --query 'Roles[].RoleName' --output text | tr '\t' '\n' | sort | sed 's/^/role /'
echo "## S3 buckets (object count / total bytes)"
for b in $(A s3api list-buckets --query 'Buckets[].Name' --output text); do
  s="$(A s3api list-objects-v2 --bucket "$b" --query '[length(Contents || `[]`), sum(Contents[].Size || `[0]`)]' --output text 2>/dev/null | tr '\t' '/')"
  echo "bucket $b | $s"
done
echo "## DynamoDB"
for t in $(A dynamodb list-tables --query TableNames --output text); do echo "table $t | items=$(A dynamodb scan --table-name "$t" --select COUNT --query Count --output text)"; done
echo "## Lambda / ECS"
echo "lambdas: $(A lambda list-functions --query 'Functions[].FunctionName' --output text)"
echo "ecs clusters: $(A ecs list-clusters --query clusterArns --output text)"
