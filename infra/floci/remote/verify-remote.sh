#!/usr/bin/env bash
# =====================================================================
# SupportHub Group 12 - READ-ONLY verification of the remote Floci host.
# Run ON THE VM after deploy-remote.sh:   bash infra/floci/remote/verify-remote.sh
# Never sends messages to the production queue and never changes resources:
# IAM checks use only read/describe calls (GetQueueAttributes, GetSecretValue with
# --query Name, ListObjectsV2, Scan Limit 1 ...) or calls that are DENIED.
# Overrides for a rehearsal: SUPPORTHUB_FLOCI_CONTAINER, SUPPORTHUB_NETWORK,
# SUPPORTHUB_GEN, SUPPORTHUB_EXPECT_TUNNEL=false.
# =====================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"; cd "$ROOT" || exit 2
FLOCI="${SUPPORTHUB_FLOCI_CONTAINER:-supporthub-floci}"; NETWORK="${SUPPORTHUB_NETWORK:-supporthub-net}"
GEN="${SUPPORTHUB_GEN:-infra/floci/.generated/remote}"; EXPECT_TUNNEL="${SUPPORTHUB_EXPECT_TUNNEL:-true}"
ACC=000000000000; Q=supporthub-article-events-production
PASS=0; FAIL=0; NV=0
ok()  { PASS=$((PASS+1)); echo "  [PASS] $1"; }
bad() { FAIL=$((FAIL+1)); echo "  [FAIL] $1"; }
nv()  { NV=$((NV+1)); echo "  [NOT VERIFIED] $1"; }
mp() { (cd -- "$1" && pwd -W 2>/dev/null) || (cd -- "$1" && pwd); }
# AWS CLI on the private network; identity = Floci admin (default) or a component key file.
A()  { timeout 60 docker run --rm -i --network "$NETWORK" -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test -e AWS_DEFAULT_REGION=us-east-1 -e AWS_PAGER= \
         amazon/aws-cli --cli-connect-timeout 5 --cli-read-timeout 30 --endpoint-url http://floci:4566 "$@"; }
AK() { local kf="$1"; shift; timeout 60 docker run --rm -i --network "$NETWORK" --env-file "$kf" -e AWS_DEFAULT_REGION=us-east-1 -e AWS_PAGER= \
         amazon/aws-cli --cli-connect-timeout 5 --cli-read-timeout 30 --endpoint-url http://floci:4566 "$@"; }
allow() { local label="$1" kf="$2"; shift 2; local out; out="$(AK "$kf" "$@" 2>&1)" && ok "ALLOW $label" || bad "ALLOW $label -> $(echo "$out" | tail -1 | cut -c1-120)"; }
deny()  { local label="$1" kf="$2"; shift 2; local out; out="$(AK "$kf" "$@" 2>&1)"; if [ $? -ne 0 ] && echo "$out" | grep -qiE "AccessDenied|not authorized|AuthorizationError"; then ok "DENY  $label"; else bad "DENY  $label -> $(echo "$out" | tail -1 | cut -c1-120)"; fi; }

echo "Remote Floci host verification - $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo; echo "== 1. Host exposure"
if command -v ss >/dev/null 2>&1 && [ "$(uname -s)" = Linux ]; then
  LISTEN="$(ss -tlnH | awk '{print $4}' | grep -vE '^(127\.|\[::1\]|\[::ffff:127\.)' | sort -u | tr '\n' ' ')"
  echo "  non-loopback TCP listeners: ${LISTEN:-none}"
  echo "$LISTEN" | tr ' ' '\n' | grep -v '^$' | grep -vE ':22$' | grep -q . && bad "only SSH (22) listens publicly" || ok "only SSH (22) listens publicly"
  command -v ufw >/dev/null 2>&1 && { ufw status | grep -q "Status: active" && ok "ufw firewall active" || bad "ufw firewall not active"; } || nv "ufw not installed"
else
  nv "host listener/firewall checks (not a Linux host - rehearsal)"
fi
echo; echo "== 2. Containers"
[ "$(docker inspect -f '{{.State.Health.Status}}' "$FLOCI" 2>/dev/null)" = healthy ] && ok "$FLOCI healthy" || bad "$FLOCI not healthy"
[ -z "$(docker port "$FLOCI" 2>/dev/null)" ] && ok "$FLOCI publishes no host port" || bad "$FLOCI publishes host ports"
PUB="$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E '0\.0\.0\.0:|:::|\[::\]:' | grep -E "supporthub|floci-aws" || true)"
[ -z "$PUB" ] && ok "no SupportHub/Floci container publishes a host port" || bad "published ports: $PUB"
if [ "$EXPECT_TUNNEL" = true ]; then
  [ "$(docker inspect -f '{{.State.Running}}' supporthub-cloudflared 2>/dev/null)" = true ] && ok "cloudflared running" || bad "cloudflared not running"
  docker logs --since 10m supporthub-cloudflared 2>&1 | grep -qiE "Registered tunnel connection|Connection .* registered" && ok "tunnel connection registered with Cloudflare" || nv "tunnel registration not seen in the last 10 min of logs"
else nv "cloudflared (rehearsal without tunnel)"; fi
echo; echo "== 3. AWS resources"
for b in supporthub-article-backups supporthub-search-analytics-exports; do
  A s3api get-public-access-block --bucket "$b" --output text 2>/dev/null | grep -q "True	True	True	True" && ok "bucket $b private (Block Public Access x4)" || bad "bucket $b"
done
A sqs get-queue-attributes --queue-url "http://floci:4566/$ACC/$Q" --attribute-names RedrivePolicy ApproximateNumberOfMessages --output text 2>/dev/null | grep -q "$Q-dlq" && ok "queue $Q with DLQ redrive" || bad "queue/redrive"
for t in supporthub-editorial-publication-events supporthub-identity-security-alerts; do A sns get-topic-attributes --topic-arn "arn:aws:sns:us-east-1:$ACC:$t" >/dev/null 2>&1 && ok "topic $t" || bad "topic $t"; done
A dynamodb describe-table --table-name supporthub-search-counters --query 'Table.TableStatus' --output text 2>/dev/null | grep -q ACTIVE && ok "DynamoDB table ACTIVE" || bad "DynamoDB table"
for s in supporthub/article/database supporthub/editorial/database supporthub/shared/service-hmac supporthub/ecs/article-worker-credentials supporthub/ecs/editorial-worker-credentials; do
  A secretsmanager describe-secret --secret-id "$s" --query Name --output text >/dev/null 2>&1 && ok "secret $s present (value not read)" || bad "secret $s"
done
A lambda get-function-configuration --function-name supporthub-editorial-publication-outcome --query 'State' --output text 2>/dev/null | grep -q Active && ok "Lambda Active" || bad "Lambda"
A sns list-subscriptions-by-topic --topic-arn "arn:aws:sns:us-east-1:$ACC:supporthub-editorial-publication-events" --query 'Subscriptions[].Protocol' --output text 2>/dev/null | grep -qx lambda && ok "exactly one SNS -> Lambda subscription" || bad "SNS subscription topology"
echo; echo "== 4. ECS"
for s in article-outbox-worker editorial-article-consumer editorial-publication-worker; do
  r="$(A ecs describe-services --cluster supporthub-workers --services "$s" --query 'services[0].[status,desiredCount,runningCount]' --output text 2>/dev/null)"
  echo "$r" | grep -q '^ACTIVE' && ok "service $s ($r)" || bad "service $s ($r)"
done
echo; echo "== 5. IAM least privilege (component keys; read-only or denied calls only)"
KW="$GEN/article.aws.env"; KE="$GEN/editorial.aws.env"; KVA="$GEN/vercel-article.aws.env"; KVS="$GEN/vercel-search.aws.env"; KVI="$GEN/vercel-identity.aws.env"
for k in "$KW" "$KE" "$KVA" "$KVS" "$KVI"; do [ -f "$k" ] || bad "missing key file $k"; done
allow "editorial worker GetQueueAttributes production queue"  "$KE"  sqs get-queue-attributes --queue-url "http://floci:4566/$ACC/$Q" --attribute-names ApproximateNumberOfMessages
deny  "article worker ReceiveMessage (consumer action)"       "$KW"  sqs receive-message --queue-url "http://floci:4566/$ACC/$Q" --wait-time-seconds 0
allow "article worker reads its own DB secret (name only)"    "$KW"  secretsmanager get-secret-value --secret-id supporthub/article/database --query Name
deny  "article worker reads the editorial DB secret"          "$KW"  secretsmanager get-secret-value --secret-id supporthub/editorial/database --query Name
deny  "editorial worker reads the article DB secret"          "$KE"  secretsmanager get-secret-value --secret-id supporthub/article/database --query Name
deny  "editorial worker publishes to identity alerts topic"   "$KE"  sns publish --topic-arn "arn:aws:sns:us-east-1:$ACC:supporthub-identity-security-alerts" --message probe
allow "Vercel article key lists its backups"                  "$KVA" s3api list-objects-v2 --bucket supporthub-article-backups --prefix articles/ --max-items 1
deny  "Vercel article key scans DynamoDB"                     "$KVA" dynamodb scan --table-name supporthub-search-counters --limit 1
allow "Vercel search key scans counters"                      "$KVS" dynamodb scan --table-name supporthub-search-counters --limit 1
deny  "Vercel search key writes to article backups"           "$KVS" s3api put-object --bucket supporthub-article-backups --key articles/probe.json --body /etc/hostname
deny  "Vercel identity key reads a secret"                    "$KVI" secretsmanager get-secret-value --secret-id supporthub/article/database --query Name
deny  "any component key invokes the Lambda"                  "$KVS" lambda invoke --function-name supporthub-editorial-publication-outcome /dev/null
echo
echo "Total: $PASS passed, $FAIL failed, $NV not verified"
[ "$FAIL" -eq 0 ]
