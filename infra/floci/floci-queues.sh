#!/usr/bin/env bash
# =====================================================================
# SupportHub Group 12 - idempotent Floci startup + SQS/IAM initialisation
# =====================================================================
# Makes sure ONE Floci environment is running and healthy, then checks
# (and only if missing, creates) the article-events queue, its dead-letter
# queue, the redrive policy and the two queue IAM identities.
#
#   bash infra/floci/floci-queues.sh --env production   # main Floci :4566
#   bash infra/floci/floci-queues.sh --env isolated     # isolated Floci :4567
#   ... --verify-only     never change anything, fail if a change is needed
#   ... --counts          print resource counts (containers/queues/users/keys)
#   ... --allow-new-key   permit creating an access key ONLY for a user that
#                         has no usable key file (never by default)
#
# Environments are never mixed: every endpoint, container, network, queue
# name and key-file directory comes from ONE profile, and the script checks
# that the endpoint port really belongs to that profile's Floci container.
#
# Idempotency / safety rules
#   - existing containers, queues, users, policies and keys are reused
#   - a queue or policy whose configuration differs from the expected one is
#     NOT overwritten: the script stops with exit 3 (unexpected configuration)
#   - access keys are never deleted or rotated; a new key is only created with
#     --allow-new-key, when the user has no valid key file and < 2 keys
#   - secret values are never printed (only key-name checks / hash prefixes)
#
# Exit codes: 0 ok | 1 a check failed | 2 missing prerequisite or config
#             3 conflicting/unexpected configuration (fail-safe stop)
#             4 Floci not running/healthy
# =====================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

ENV_NAME=""; VERIFY_ONLY=false; COUNTS_ONLY=false; ALLOW_NEW_KEY=false; QUIET=false
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_NAME="${2:-}"; shift ;;
    --env=*) ENV_NAME="${1#*=}" ;;
    --verify-only|--dry-run) VERIFY_ONLY=true ;;
    --counts) COUNTS_ONLY=true ;;
    --allow-new-key) ALLOW_NEW_KEY=true ;;
    --quiet) QUIET=true ;;
    -h|--help) sed -n 2,33p "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

REGION=us-east-1; ACCOUNT=000000000000
WORKER_CFG_DIR="${SUPPORTHUB_WORKER_CONFIG_DIR:-}"
if [ -z "$WORKER_CFG_DIR" ] && [ -n "${LOCALAPPDATA:-}" ]; then
  WORKER_CFG_DIR="$(cygpath -u "$LOCALAPPDATA" 2>/dev/null || echo "$LOCALAPPDATA")/SupportHub/production-workers"
fi

case "$ENV_NAME" in
  production)
    PORT=4566; FLOCI=supporthub-floci; NETWORK=floci_default
    QUEUE=supporthub-article-events-production; DLQ=supporthub-article-events-production-dlq
    VISIBILITY=60; MAX_RECEIVE=5
    KEY_DIR="$WORKER_CFG_DIR"
    # component|IAM user|policy name|policy file
    IDENTITIES=(
      "article|supporthub-prod-article-publisher|ProductionArticlePublishOnly|infra/iam/production-article-sqs-publish-policy.json"
      "editorial|supporthub-prod-editorial-consumer|ProductionEditorialConsumeOnly|infra/iam/production-editorial-sqs-consumer-policy.json"
    )
    ;;
  isolated)
    . infra/floci/isolated-env.sh
    PORT="$SUPPORTHUB_FLOCI_PORT"; FLOCI="$SUPPORTHUB_PREFIX-floci"; NETWORK="$SUPPORTHUB_PREFIX-net"
    QUEUE=supporthub-article-events; DLQ=supporthub-article-events-dlq
    VISIBILITY=30; MAX_RECEIVE=5
    KEY_DIR="$ROOT/$SUPPORTHUB_GEN"
    IDENTITIES=(
      "article|supporthub-article-service|SupportHubArticleSQSPublisher|infra/iam/article-sqs-policy.json"
      "editorial|supporthub-editorial-service|SupportHubEditorialSQSConsumer|infra/iam/editorial-sqs-consumer-policy.json"
    )
    ;;
  *) echo "ERROR: --env production|isolated is required" >&2; exit 2 ;;
esac
ENDPOINT="http://localhost:$PORT"
# Test hook: point the key-file checks at another directory (e.g. an empty one).
KEY_DIR="${SUPPORTHUB_KEY_DIR_OVERRIDE:-$KEY_DIR}"
QUEUE_URL="$ENDPOINT/$ACCOUNT/$QUEUE"; DLQ_URL="$ENDPOINT/$ACCOUNT/$DLQ"
DLQ_ARN="arn:aws:sqs:$REGION:$ACCOUNT:$DLQ"

PASS=0; FAIL=0; CHANGES=0
say()  { [ "$QUIET" = true ] || echo "$@"; }
ok()   { PASS=$((PASS+1)); say "  [PASS] $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  [FAIL] $1"; }
act()  { CHANGES=$((CHANGES+1)); say "  [CHANGE] $1"; }
die()  { echo "ERROR: $1" >&2; exit "${2:-1}"; }
step() { say ""; say "==> $1"; }

command -v docker >/dev/null || die "docker is required" 2
docker info >/dev/null 2>&1 || die "Docker is not running (start Docker Desktop)" 2
command -v aws  >/dev/null || die "AWS CLI v2 is required (https://aws.amazon.com/cli/)" 2
command -v curl >/dev/null || die "curl is required" 2
command -v node >/dev/null || die "node is required (policy comparison)" 2

# Admin calls use Floci's built-in root credentials; nothing real.
admin() { env -u AWS_PROFILE -u AWS_SESSION_TOKEN AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test aws --endpoint-url "$ENDPOINT" --region "$REGION" "$@"; }
key_of() { sed -n "s/^$2=//p" "$1" 2>/dev/null | tr -d '\r' | head -1; }
as_key() { # file aws-args...   run with a component key, values never printed
  local f="$1"; shift
  env -u AWS_PROFILE -u AWS_SESSION_TOKEN \
    AWS_ACCESS_KEY_ID="$(key_of "$f" AWS_ACCESS_KEY_ID)" AWS_SECRET_ACCESS_KEY="$(key_of "$f" AWS_SECRET_ACCESS_KEY)" \
    aws --endpoint-url "$ENDPOINT" --region "$REGION" "$@"
}
hash10() { printf %s "$1" | sha256sum | cut -c1-10; }

# ---------------------------------------------------------------------
counts() {
  local q u k=0 users=0 user
  q=$(admin sqs list-queues --queue-name-prefix supporthub-article-events --query 'length(QueueUrls)' --output text 2>/dev/null || echo "?")
  for spec in "${IDENTITIES[@]}"; do
    IFS='|' read -r _ user _ _ <<<"$spec"
    if admin iam get-user --user-name "$user" >/dev/null 2>&1; then
      users=$((users+1))
      k=$((k + $(admin iam list-access-keys --user-name "$user" --query 'length(AccessKeyMetadata)' --output text 2>/dev/null || echo 0)))
    fi
  done
  u=$(admin iam list-users --query 'length(Users)' --output text 2>/dev/null || echo "?")
  echo "COUNTS env=$ENV_NAME floci_containers=$(docker ps -a --filter "name=^/${FLOCI}\$" -q | wc -l | tr -d ' ') article_events_queues=$q queue_iam_users=$users/${#IDENTITIES[@]} queue_iam_access_keys=$k all_iam_users=$u"
}

# ---------------------------------------------------------------------
step "Floci container $FLOCI (env=$ENV_NAME, endpoint $ENDPOINT)"
n=$(docker ps -a --filter "name=^/${FLOCI}\$" -q | wc -l | tr -d ' ')
if [ "$n" -eq 0 ]; then
  [ "$VERIFY_ONLY" = true ] && die "Floci container $FLOCI does not exist (verify-only)" 4
  # Port must be free before creating anything.
  if docker ps --format '{{.Names}} {{.Ports}}' | grep -E "(:|\s)$PORT->" >/dev/null; then
    die "port $PORT is already published by another container: $(docker ps --format '{{.Names}} {{.Ports}}' | grep -E ":$PORT->" | awk '{print $1}')" 3
  fi
  if [ "$ENV_NAME" = production ]; then
    # Same compose project name "floci" -> same volume floci_floci-data (data kept).
    docker compose -p floci -f infra/floci/docker-compose.yml up -d --no-deps floci >/dev/null 2>&1 \
      || die "could not create $FLOCI from infra/floci/docker-compose.yml" 4
    docker update --restart unless-stopped "$FLOCI" >/dev/null
  else
    docker compose -f infra/floci/docker-compose.supporthub.yml --profile own-floci up -d floci >/dev/null 2>&1 \
      || die "could not create $FLOCI" 4
  fi
  act "created $FLOCI (was missing)"
else
  ok "container $FLOCI exists (count=1, reused)"
  # A paused container reports Running=true but does not answer: treat as NOT READY.
  # It is never unpaused automatically (pausing is a deliberate operator action).
  if [ "$(docker inspect -f '{{.State.Paused}}' "$FLOCI")" = true ]; then
    die "$FLOCI is paused - Floci not ready (unpause it deliberately: docker unpause $FLOCI)" 4
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$FLOCI")" != true ]; then
    [ "$VERIFY_ONLY" = true ] && die "$FLOCI is stopped (verify-only)" 4
    docker start "$FLOCI" >/dev/null || die "could not start $FLOCI" 4
    act "started stopped container $FLOCI"
  else
    ok "$FLOCI running"
  fi
fi
# Environment separation: the endpoint port must belong to THIS container.
# Read from the static port bindings (valid whether the container is running,
# starting, paused or stopped), not from "docker port" (empty unless running).
published="$(docker inspect -f '{{range $p,$b := .HostConfig.PortBindings}}{{if eq $p "4566/tcp"}}{{range $b}}{{.HostPort}} {{end}}{{end}}{{end}}' "$FLOCI" | tr ' ' '\n' | grep -v '^$' | sort -u | head -1)"
[ "$published" = "$PORT" ] || die "$FLOCI publishes port '${published:-none}', expected $PORT - refusing to mix environments" 3
ok "$FLOCI publishes 4566 on host port $PORT only (environment separation)"
# Exposure check (warning only, exit code unchanged): Floci accepts its default
# admin credentials and unsigned S3 reads, so it must be bound to loopback.
hostips="$(docker inspect -f '{{range $p,$b := .HostConfig.PortBindings}}{{if eq $p "4566/tcp"}}{{range $b}}[{{.HostIp}}] {{end}}{{end}}{{end}}' "$FLOCI")"
if echo "$hostips" | tr ' ' '\n' | grep -v '^$' | grep -qvE '^\[(127\.0\.0\.1|::1)\]$'; then
  echo "  [WARN] $FLOCI publishes port $PORT on non-loopback addresses $hostips - reachable from the LAN/tailnet;"
  echo "         recreate it from infra/floci/docker-compose.yml (127.0.0.1:$PORT:4566) in a planned maintenance window"
else
  ok "$FLOCI bound to loopback only"
fi
[ "$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$FLOCI")" = unless-stopped ] \
  && ok "restart policy unless-stopped" || bad "restart policy of $FLOCI is not unless-stopped"
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$FLOCI" | grep -q '^FLOCI_SERVICES_IAM_ENFORCEMENT_ENABLED=true$' \
  && ok "IAM enforcement enabled" || bad "FLOCI_SERVICES_IAM_ENFORCEMENT_ENABLED is not true"
docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$FLOCI" | grep -qw "$NETWORK" \
  && ok "attached to network $NETWORK" || bad "$FLOCI not attached to $NETWORK"

step "Waiting for Floci health"
ready=false
for i in $(seq 1 "${FLOCI_WAIT_SECONDS:-90}"); do
  if curl -fsS -m 3 "$ENDPOINT/_floci/health" 2>/dev/null | grep -q '"sqs":"running"'; then ready=true; break; fi
  sleep 1
done
[ "$ready" = true ] || die "Floci at $ENDPOINT did not report sqs running within ${FLOCI_WAIT_SECONDS:-90}s" 4
ok "Floci healthy, SQS running (after ~${i}s)"
admin sts get-caller-identity --query Account --output text >/dev/null 2>&1 && ok "AWS CLI connectivity" || die "AWS CLI cannot reach $ENDPOINT" 4

if [ "$COUNTS_ONLY" = true ]; then counts; exit 0; fi

# ---------------------------------------------------------------------
step "SQS queues"
queue_exists() { admin sqs get-queue-url --queue-name "$1" >/dev/null 2>&1; }
dup=$(admin sqs list-queues --queue-name-prefix "$QUEUE" --output text 2>/dev/null | grep -cE "/$QUEUE\$")
[ "$dup" -le 1 ] && ok "no duplicate $QUEUE queues (found $dup)" || die "duplicate queues named $QUEUE ($dup)" 3

if queue_exists "$DLQ"; then ok "DLQ $DLQ exists (reused)"
elif [ "$VERIFY_ONLY" = true ]; then bad "DLQ $DLQ missing"
else admin sqs create-queue --queue-name "$DLQ" --attributes MessageRetentionPeriod=345600 >/dev/null && act "created DLQ $DLQ" || bad "create DLQ $DLQ"
fi

REDRIVE_JSON="{\"deadLetterTargetArn\":\"$DLQ_ARN\",\"maxReceiveCount\":\"$MAX_RECEIVE\"}"
if queue_exists "$QUEUE"; then
  ok "queue $QUEUE exists (reused, not recreated)"
elif [ "$VERIFY_ONLY" = true ]; then
  bad "queue $QUEUE missing"
else
  attrs="$(node -e 'console.log(JSON.stringify({VisibilityTimeout:process.argv[1],RedrivePolicy:process.argv[2]}))' "$VISIBILITY" "$REDRIVE_JSON")"
  admin sqs create-queue --queue-name "$QUEUE" --attributes "$attrs" >/dev/null && act "created $QUEUE with redrive" || bad "create $QUEUE"
fi

if queue_exists "$QUEUE"; then
  got="$(admin sqs get-queue-attributes --queue-url "$QUEUE_URL" --attribute-names VisibilityTimeout RedrivePolicy QueueArn --output json 2>/dev/null)"
  verdict="$(printf %s "$got" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const a=(JSON.parse(s||"{}").Attributes)||{}; const [vis,dlq,max]=process.argv.slice(1);
      let r={}; try{r=JSON.parse(a.RedrivePolicy||"{}")}catch{}
      const out=[];
      out.push((a.VisibilityTimeout===vis?"OK":"BAD")+" VisibilityTimeout="+a.VisibilityTimeout+" (expected "+vis+")");
      out.push((r.deadLetterTargetArn===dlq?"OK":"BAD")+" redrive target="+(r.deadLetterTargetArn||"none"));
      out.push((String(r.maxReceiveCount)===max?"OK":"BAD")+" maxReceiveCount="+(r.maxReceiveCount||"none")+" (expected "+max+")");
      console.log(out.join("\n"));})' "$VISIBILITY" "$DLQ_ARN" "$MAX_RECEIVE")"
  while IFS= read -r line; do
    case "$line" in OK*) ok "${line#OK }" ;; *) bad "${line#BAD } - not overwritten (unexpected configuration)"; MISMATCH=true ;; esac
  done <<<"$verdict"
  depth="$(admin sqs get-queue-attributes --queue-url "$QUEUE_URL" --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible --query 'Attributes.[ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible]' --output text 2>/dev/null)"
  dlqdepth="$(admin sqs get-queue-attributes --queue-url "$DLQ_URL" --attribute-names ApproximateNumberOfMessages --query 'Attributes.ApproximateNumberOfMessages' --output text 2>/dev/null)"
  say "  [INFO] $QUEUE visible/in-flight: $(echo $depth | tr ' ' '/') ; $DLQ messages: ${dlqdepth:-?}"
fi

# ---------------------------------------------------------------------
step "Queue IAM identities (reuse users, policies and valid keys)"
policy_equal() { # json-a json-b  -> exit 0 if semantically equal
  node -e '
    const norm=v=>Array.isArray(v)?v.map(norm).sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:1)
      :v&&typeof v==="object"?Object.fromEntries(Object.keys(v).sort().map(k=>[k,norm(v[k])])):v;
    const wrap=s=>{let j=JSON.parse(s);for(const st of j.Statement||[])for(const k of ["Action","Resource"])if(typeof st[k]==="string")st[k]=[st[k]];return norm(j)};
    process.exit(JSON.stringify(wrap(process.argv[1]))===JSON.stringify(wrap(process.argv[2]))?0:1)' "$1" "$2"
}
for spec in "${IDENTITIES[@]}"; do
  IFS='|' read -r comp user pname pfile <<<"$spec"
  [ -f "$pfile" ] || die "policy file $pfile missing" 2
  if admin iam get-user --user-name "$user" >/dev/null 2>&1; then
    ok "IAM user $user exists (reused)"
  elif [ "$VERIFY_ONLY" = true ]; then
    bad "IAM user $user missing"; continue
  else
    admin iam create-user --user-name "$user" >/dev/null && act "created IAM user $user" || { bad "create $user"; continue; }
  fi

  live="$(admin iam get-user-policy --user-name "$user" --policy-name "$pname" --query PolicyDocument --output json 2>/dev/null)"
  if [ -z "$live" ]; then
    if [ "$VERIFY_ONLY" = true ]; then bad "$user policy $pname missing"
    else admin iam put-user-policy --user-name "$user" --policy-name "$pname" --policy-document "file://$pfile" >/dev/null \
           && act "attached policy $pname to $user" || bad "attach $pname"; fi
  elif policy_equal "$live" "$(cat "$pfile")"; then
    ok "$user policy $pname matches $pfile"
  else
    bad "$user policy $pname differs from $pfile - not overwritten (unexpected configuration)"; MISMATCH=true
  fi

  keyfile="$KEY_DIR/$comp.aws.env"
  active="$(admin iam list-access-keys --user-name "$user" --query 'AccessKeyMetadata[?Status==`Active`].AccessKeyId' --output text 2>/dev/null)"
  nkeys=$(admin iam list-access-keys --user-name "$user" --query 'length(AccessKeyMetadata)' --output text 2>/dev/null || echo 0)
  fid="$(key_of "$keyfile" AWS_ACCESS_KEY_ID)"
  if [ -n "$fid" ] && printf '%s\n' $active | grep -qxF "$fid"; then
    arn="$(as_key "$keyfile" sts get-caller-identity --query Arn --output text 2>/dev/null)"
    if [ "$arn" = "arn:aws:iam::$ACCOUNT:user/$user" ]; then
      ok "$user key file $(basename "$keyfile") valid (key#$(hash10 "$fid"), $nkeys key(s) total) - reused, no new key"
    else
      bad "$user key file key is listed but authentication failed"
    fi
    [ "$nkeys" -le 1 ] || say "  [WARN] $user has $nkeys access keys; extra keys are reported, never deleted automatically"
  elif [ "$ALLOW_NEW_KEY" = true ] && [ "$VERIFY_ONLY" != true ] && [ "$nkeys" -lt 2 ]; then
    [ -e "$keyfile" ] && die "$keyfile exists but holds no valid key for $user - refusing to overwrite it" 3
    pair="$(admin iam create-access-key --user-name "$user" --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)" || die "create key for $user failed" 1
    ( umask 077; printf "AWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\nAWS_REGION=%s\n" \
        "$(echo "$pair" | awk '{print $1}')" "$(echo "$pair" | awk '{print $2}')" "$REGION" > "$keyfile" )
    unset pair; act "created ONE access key for $user -> $keyfile (value not printed)"
  else
    bad "$user has no valid key in $keyfile ($nkeys key(s) exist). Not creating one automatically; rerun with --allow-new-key after review"
  fi
done

# ---------------------------------------------------------------------
step "Queue reachability with the component keys"
EKEY="$KEY_DIR/editorial.aws.env"
if [ -s "$EKEY" ]; then
  as_key "$EKEY" sqs get-queue-attributes --queue-url "$QUEUE_URL" --attribute-names QueueArn >/dev/null 2>&1 \
    && ok "editorial consumer key can reach $QUEUE" || bad "editorial consumer key cannot reach $QUEUE"
fi

echo
echo "floci-queues ($ENV_NAME): $PASS passed, $FAIL failed, $CHANGES change(s)$([ "$VERIFY_ONLY" = true ] && echo ' [verify-only]')"
[ "$QUIET" = true ] || counts
[ "${MISMATCH:-false}" = true ] && exit 3
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
