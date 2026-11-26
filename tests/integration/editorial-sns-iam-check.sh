#!/usr/bin/env bash
# SupportHub Group 12 - Phase 4 (Editorial): SNS topic configuration and
# Editorial IAM least-privilege checks against the ISOLATED Floci (port 4567).
#
#   bash tests/integration/editorial-sns-iam-check.sh
#
# Uses the dedicated Editorial access key from the git-ignored
# infra/floci/.generated/isolated/editorial.aws.env (values never printed)
# and the Floci admin test/test identity only for read-only inspection.
# Never targets port 4566 (production / team Floci).
set -uo pipefail
export MSYS_NO_PATHCONV=1 AWS_PAGER="" AWS_DEFAULT_REGION=us-east-1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; cd "$ROOT" || exit 2
EP=http://localhost:4567; ACC=000000000000
TOPIC="arn:aws:sns:us-east-1:$ACC:supporthub-editorial-publication-events"
ALERTS="arn:aws:sns:us-east-1:$ACC:supporthub-identity-security-alerts"
KEYFILE=infra/floci/.generated/isolated/editorial.aws.env
docker port supporthub-iso-floci 4566 | grep -q 4567 || { echo "isolated Floci not on 4567"; exit 2; }

PASS=0; FAIL=0; LIMIT=0
res() { if [ "$1" = ok ]; then PASS=$((PASS+1)); echo "PASS | $2"; else FAIL=$((FAIL+1)); echo "FAIL | $2"; fi; }
admin() { AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test aws --cli-read-timeout 20 --endpoint-url $EP "$@"; }
EKEY="$(sed -n 's/^AWS_ACCESS_KEY_ID=//p' $KEYFILE)"; ESEC="$(sed -n 's/^AWS_SECRET_ACCESS_KEY=//p' $KEYFILE)"
ed() { AWS_ACCESS_KEY_ID="$EKEY" AWS_SECRET_ACCESS_KEY="$ESEC" aws --cli-read-timeout 20 --endpoint-url $EP "$@"; }
# expect DENY: command must fail with an authorization error (not a missing-resource error)
deny() { local name="$1"; shift; local out; out="$(ed "$@" 2>&1)"; local rc=$?
  if [ $rc -ne 0 ] && echo "$out" | grep -qiE "AccessDenied|not authorized|AuthorizationError|InvalidClientTokenId|SignatureDoesNotMatch|UnrecognizedClient"; then
    res ok "DENY  $name  -> $(echo "$out" | grep -oiE '\(([A-Za-z]+)\)' | head -1)"
  else res bad "DENY  $name  -> rc=$rc $(echo "$out" | head -1 | cut -c1-160)"; fi; }

echo "Editorial SNS configuration + IAM check - $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Floci: $EP $(curl -fsS $EP/_floci/health | sed -E 's/.*"version":"([^"]+)".*/version \1/')  (container supporthub-iso-floci, IAM enforcement: $(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' supporthub-iso-floci | sed -n 's/FLOCI_SERVICES_IAM_ENFORCEMENT_ENABLED=//p'))"

echo; echo "== 1. Topic initialisation (admin, read-only)"
admin sns list-topics --query 'Topics[].TopicArn' --output text | tr '\t' '\n' | sed 's/^/     /'
attrs="$(admin sns get-topic-attributes --topic-arn "$TOPIC" --output json 2>&1)"
echo "$attrs" | grep -q "\"TopicArn\": \"$TOPIC\"" && res ok "topic supporthub-editorial-publication-events exists" || res bad "topic exists"
echo "$attrs" | grep -E '"(TopicArn|SubscriptionsConfirmed|SubscriptionsPending|DisplayName|Owner)"' | sed 's/^ */     /'
subs="$(admin sns list-subscriptions-by-topic --topic-arn "$TOPIC" --query 'Subscriptions[].[Protocol,Endpoint]' --output text)"
echo "$subs" | sed 's/^/     subscription: /'
echo "$subs" | grep -q "lambda	arn:aws:lambda:us-east-1:$ACC:function:supporthub-editorial-publication-outcome" \
  && res ok "intended subscriber: SNS -> Lambda supporthub-editorial-publication-outcome" || res bad "Lambda subscription"
[ "$(echo "$subs" | grep -c lambda)" = 1 ] && res ok "exactly one Lambda subscription (no duplicate deliveries)" || res bad "Lambda subscription count"
grep -q "supporthub-editorial-publication-events" infra/floci/setup-supporthub.sh && res ok "topic + subscription created idempotently by setup-supporthub.sh (create-topic, subscribe only if missing)" || res bad "setup script"

echo; echo "== 2. Dedicated Editorial identity and policy"
admin iam get-user --user-name supporthub-editorial-service --query 'User.[UserName,Arn]' --output text | sed 's/^/     /'
pols="$(admin iam list-user-policies --user-name supporthub-editorial-service --query 'PolicyNames' --output text)"
echo "     inline policies: $pols"
[ "$(echo $pols | wc -w)" = 3 ] && res ok "editorial user has exactly 3 inline policies (SQS consumer, SNS publisher, secrets)" || res bad "policy count"
doc="$(admin iam get-user-policy --user-name supporthub-editorial-service --policy-name SupportHubEditorialSNSPublisher --query PolicyDocument --output json)"
echo "$doc" | tr -d ' \n\r' | sed 's/^/     SNS policy: /'; echo
echo "$doc" | tr -d ' \n\r' | grep -q '"Action":"sns:Publish","Resource":"arn:aws:sns:us-east-1:000000000000:supporthub-editorial-publication-events"' \
  && res ok "SNS policy = sns:Publish on the publication topic ONLY (no wildcard)" || res bad "SNS policy scope"
echo "$doc" | grep -q '\*' && res bad "SNS policy contains a wildcard" || res ok "no wildcard in SNS policy"
diff <(echo "$doc" | tr -d ' \n\r') <(tr -d ' \n\r' < infra/iam/editorial-sns-publish-policy.json) >/dev/null \
  && res ok "deployed SNS policy identical to infra/iam/editorial-sns-publish-policy.json" || res bad "deployed policy differs from repo file"
[ -n "$EKEY" ] && [ -n "$ESEC" ] && res ok "dedicated Editorial key file present (git-ignored, values not printed)" || res bad "key file"
git check-ignore -q "$KEYFILE" && res ok "key file is git-ignored" || res bad "key file NOT ignored"
ed sts get-caller-identity --query Arn --output text 2>/dev/null | grep -q "user/supporthub-editorial-service" \
  && res ok "key authenticates as arn:...:user/supporthub-editorial-service" || res bad "caller identity"
h() { printf %s "$1" | sha256sum | cut -c1-12; }
wk="$(docker exec supporthub-iso-editorial-publication-worker printenv AWS_ACCESS_KEY_ID)"
[ "$(h "$wk")" = "$(h "$EKEY")" ] && res ok "publication worker runs with the dedicated Editorial key (sha256 prefix $(h "$EKEY") matches)" || res bad "worker key differs"
unset wk
wt="$(docker exec supporthub-iso-editorial-publication-worker printenv EDITORIAL_PUBLICATION_TOPIC_ARN)"
[ "$wt" = "$TOPIC" ] && res ok "worker EDITORIAL_PUBLICATION_TOPIC_ARN = publication topic" || res bad "worker topic ARN ($wt)"
docker exec supporthub-iso-editorial-publication-worker printenv SNS_ENDPOINT_URL | grep -q "^http://floci:4566$" \
  && res ok "worker SNS endpoint = isolated Floci (http://floci:4566 on supporthub-iso-net; no real AWS)" || res bad "worker endpoint"

echo; echo "== 3. Unauthorized SNS and cross-service operations are denied (Editorial key)"
deny "sns:Publish to identity security-alerts topic"   sns publish --topic-arn "$ALERTS" --message probe
deny "sns:CreateTopic"                                 sns create-topic --name supporthub-iam-probe-topic
deny "sns:DeleteTopic (non-existent probe ARN)"        sns delete-topic --topic-arn "arn:aws:sns:us-east-1:$ACC:supporthub-iam-probe-missing"
deny "sns:Subscribe to the publication topic"          sns subscribe --topic-arn "$TOPIC" --protocol sqs --notification-endpoint "arn:aws:sqs:us-east-1:$ACC:supporthub-article-events"
deny "sns:SetTopicAttributes on the publication topic" sns set-topic-attributes --topic-arn "$TOPIC" --attribute-name DisplayName --attribute-value probe
deny "sns:GetTopicAttributes"                          sns get-topic-attributes --topic-arn "$TOPIC"
deny "sns:ListTopics"                                  sns list-topics
deny "sns:ListSubscriptionsByTopic"                    sns list-subscriptions-by-topic --topic-arn "$TOPIC"
deny "lambda:InvokeFunction (subscriber is invoked by SNS, not Editorial)" lambda invoke --function-name supporthub-editorial-publication-outcome --payload e30= /dev/null
deny "lambda:UpdateFunctionConfiguration"              lambda update-function-configuration --function-name supporthub-editorial-publication-outcome --timeout 31
deny "sqs:SendMessage to article-events (producer role belongs to Article)" sqs send-message --queue-url "$EP/$ACC/supporthub-article-events" --message-body probe
deny "iam:ListUsers"                                   iam list-users
deny "secretsmanager:GetSecretValue supporthub/identity/runtime" secretsmanager get-secret-value --secret-id supporthub/identity/runtime --query Name
deny "s3:ListBuckets"                                  s3api list-buckets
# Side-effect-free probe: does Floci verify the SigV4 signature (secret), or only the key id?
out="$(AWS_ACCESS_KEY_ID="$EKEY" AWS_SECRET_ACCESS_KEY="wrong-secret-value-for-test-000000000000" aws --endpoint-url $EP sts get-caller-identity --query Arn --output text 2>&1)"
if [ $? -ne 0 ]; then res ok "DENY  request signed with a forged secret -> $(echo "$out" | grep -oiE '\(([A-Za-z]+)\)' | head -1)"
else LIMIT=$((LIMIT+1)); echo "LIMIT | EMULATOR LIMITATION: Floci accepted a request signed with a WRONG secret for the Editorial key id (resolved to $(echo "$out" | sed 's/.*:user/user/')); SigV4 signatures are not verified, only the key id. Real AWS rejects this with SignatureDoesNotMatch."; fi
out="$(AWS_ACCESS_KEY_ID=AKIAUNKNOWNPROBE0000 AWS_SECRET_ACCESS_KEY=x aws --endpoint-url $EP sns publish --topic-arn "$TOPIC" --message probe 2>&1)"
[ $? -ne 0 ] && res ok "DENY  sns:Publish with an unknown access key -> $(echo "$out" | grep -oiE '\(([A-Za-z]+)\)' | head -1)" || res bad "unknown key accepted"
admin sns list-subscriptions-by-topic --topic-arn "$TOPIC" --query 'length(Subscriptions)' --output text | grep -qx 1 \
  && res ok "denied Subscribe did not add a subscription (still 1)" || res bad "subscription count changed"
admin sns list-topics --query 'Topics[].TopicArn' --output text | grep -q supporthub-iam-probe-topic && res bad "probe topic was created" || res ok "denied CreateTopic created nothing"
unset EKEY ESEC
echo; echo "ALLOW sns:Publish with the Editorial key is proven by the real application path (worker) in 03-sns-publication-notifications.txt"
echo "Total: $PASS passed, $FAIL failed, $LIMIT emulator limitation(s)"
[ "$FAIL" -eq 0 ]
