#!/usr/bin/env bash
# =====================================================================
# SupportHub Group 12 - safe, idempotent startup of the SQS workers
# =====================================================================
# Starts (or verifies) main Floci, the production SQS queue + DLQ and the
# two production workers, in dependency order:
#
#   1. prerequisites (docker, aws, curl, node)        exit 2 if missing
#   2. private configuration (outside Git) validated  exit 2 if missing/invalid
#   3. Floci running + healthy, queue + DLQ + redrive + IAM keys verified
#      (infra/floci/floci-queues.sh)                   exit 3/4 on conflict/not ready
#   4. worker dependencies (network alias "floci", database/HTTP reachability)
#   5. supporthub-prod-article-outbox-worker   (Article -> SQS publisher)
#   6. supporthub-prod-editorial-article-worker (SQS -> Editorial consumer)
#   7. post-start checks (running, not restarting, startup log line)
#
# Usage (repository root, Git Bash on Windows):
#   bash infra/floci/start-production-workers.sh              # start / reuse
#   bash infra/floci/start-production-workers.sh --dry-run    # show plan, change nothing
#   bash infra/floci/start-production-workers.sh --verify-only  # change nothing,
#                                         exit 1 if anything is not already running correctly
#   bash infra/floci/start-production-workers.sh --env isolated   # same logic against the
#                                         isolated stack (Floci :4567, supporthub-iso-* workers)
#
# Private configuration (never copied into Git):
#   %LOCALAPPDATA%\SupportHub\production-workers\article.restricted.env
#   %LOCALAPPDATA%\SupportHub\production-workers\editorial.restricted.env
#   (+ article.aws.env / editorial.aws.env used for the queue key checks)
#   override the directory with SUPPORTHUB_WORKER_CONFIG_DIR.
#
# Idempotency: an existing worker container is reused if its image, command,
# network, restart policy and environment match the private file; a stopped one
# is started; a missing one is created with --restart unless-stopped. A worker
# whose configuration differs, or another container consuming the same queue,
# stops the script with exit 3 - nothing is removed or recreated automatically.
# Values are never printed: only variable NAMES and pass/fail results.
#
# Exit codes: 0 ok | 1 check failed / action needed (verify-only)
#             2 missing prerequisite or configuration | 3 conflicting configuration
#             4 Floci not ready | 5 worker failed to start
# =====================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

ENV_NAME=production; DRY_RUN=false; VERIFY_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --env=*) ENV_NAME="${arg#*=}" ;;
    --env) : ;;
    production|isolated) ENV_NAME="$arg" ;;
    --dry-run) DRY_RUN=true ;;
    --verify-only) DRY_RUN=true; VERIFY_ONLY=true ;;
    -h|--help) sed -n 2,42p "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

PASS=0; FAIL=0; NEEDED=0
ok()   { PASS=$((PASS+1)); echo "  [PASS] $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  [FAIL] $1"; }
plan() { NEEDED=$((NEEDED+1)); echo "  [PLAN] would $1 (dry-run: not executed)"; }
step() { echo; echo "==> $1"; }
die()  { echo "ERROR: $1" >&2; exit "${2:-1}"; }

TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
chmod 700 "$TMPD" 2>/dev/null || true

# ---------------------------------------------------------------------
step "1. Prerequisites"
for c in docker aws curl node; do command -v $c >/dev/null || die "$c is required" 2; done
docker info >/dev/null 2>&1 || die "Docker is not running (start Docker Desktop)" 2
ok "docker, aws, curl, node available; Docker running"

# ---------------------------------------------------------------------
# Worker profiles.  name|image|cmd(JSON)|network|config file|startup log marker
QUEUE_NAME=""; NETWORK=""
if [ "$ENV_NAME" = production ]; then
  CFG_DIR="${SUPPORTHUB_WORKER_CONFIG_DIR:-}"
  [ -n "$CFG_DIR" ] || { [ -n "${LOCALAPPDATA:-}" ] || die "LOCALAPPDATA is not set; set SUPPORTHUB_WORKER_CONFIG_DIR" 2
                         CFG_DIR="$(cygpath -u "$LOCALAPPDATA" 2>/dev/null || echo "$LOCALAPPDATA")/SupportHub/production-workers"; }
  NETWORK=floci_default; QUEUE_NAME=supporthub-article-events-production
  WORKERS=(
    "article|supporthub-prod-article-outbox-worker|supporthub-prod-article:local|[\"services/articleOutboxScheduler.js\"]|$CFG_DIR/article.restricted.env|Article SQS outbox scheduler started"
    "editorial|supporthub-prod-editorial-article-worker|supporthub-prod-editorial:local|[\"workers/articleEventConsumer.js\"]|$CFG_DIR/editorial.restricted.env|Editorial Article Event Consumer started"
  )
  REQ_article="AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION AWS_ENDPOINT_URL SQS_QUEUE_URL DATABASE_URL_POOLED NODE_ENV"
  REQ_editorial="AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION SERVICE_SHARED_SECRET ARTICLE_SERVICE_URL SQS_ENDPOINT_URL ARTICLE_EVENTS_QUEUE_URL DATABASE_URL_POOLED NODE_ENV"
elif [ "$ENV_NAME" = isolated ]; then
  . infra/floci/isolated-env.sh
  CFG_DIR="$ROOT/$SUPPORTHUB_GEN"; NETWORK="$SUPPORTHUB_PREFIX-net"; QUEUE_NAME=supporthub-article-events
  # The isolated workers are compose-managed and read the DB URL from isolated
  # Secrets Manager; their expected env = component key file + queue URL.
  for c in article editorial; do
    [ -s "$CFG_DIR/$c.aws.env" ] || die "missing $CFG_DIR/$c.aws.env (run setup-supporthub.sh with SUPPORTHUB_ISOLATED=true)" 2
    { tr -d '\r' < "$CFG_DIR/$c.aws.env" | grep -E '^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY)='
      echo "AWS_ENDPOINT_URL=http://floci:4566"
      [ $c = article ] && echo "SQS_QUEUE_URL=http://floci:4566/000000000000/$QUEUE_NAME" \
                       || echo "ARTICLE_EVENTS_QUEUE_URL=http://floci:4566/000000000000/$QUEUE_NAME"
    } > "$TMPD/$c.expected.env"
  done
  WORKERS=(
    "article|$SUPPORTHUB_PREFIX-article-outbox-worker|supporthub-int-article:local|[\"node\",\"start.js\",\"services/articleOutboxScheduler.js\"]|$TMPD/article.expected.env|Article SQS outbox scheduler started"
    "editorial|$SUPPORTHUB_PREFIX-editorial-article-worker|supporthub-int-editorial:local|[\"node\",\"start.js\",\"workers/articleEventConsumer.js\"]|$TMPD/editorial.expected.env|Editorial Article Event Consumer started"
  )
  REQ_article="AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_ENDPOINT_URL SQS_QUEUE_URL"
  REQ_editorial="AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_ENDPOINT_URL ARTICLE_EVENTS_QUEUE_URL"
else
  die "--env must be production or isolated" 2
fi
EXPECTED_QUEUE_URL="http://floci:4566/000000000000/$QUEUE_NAME"
echo "Environment: $ENV_NAME | config: $CFG_DIR | queue: $QUEUE_NAME$([ "$DRY_RUN" = true ] && echo ' | DRY-RUN')"

val() { sed -n "s/^$2=//p" "$1" | tr -d '\r' | head -1; }

# ---------------------------------------------------------------------
step "2. Private configuration (values never printed)"
for spec in "${WORKERS[@]}"; do
  IFS='|' read -r comp name image cmd file marker <<<"$spec"
  [ -f "$file" ] || die "configuration file missing: $file" 2
  if [ "$ENV_NAME" = production ]; then
    case "$(cd "$(dirname "$file")" && pwd -P)/" in "$ROOT"/*) die "$file is inside the repository - private config must stay outside Git" 2 ;; esac
    ok "$(basename "$file") present outside the repository"
  fi
  req_var="REQ_$comp"; missing=""
  for k in ${!req_var}; do [ -n "$(val "$file" "$k")" ] || missing="$missing $k"; done
  [ -z "$missing" ] && ok "$comp: all required variables set (${!req_var})" || die "$comp: missing/empty variables:$missing (in $file)" 2
  if [ "$ENV_NAME" = production ]; then
    q="$( [ $comp = article ] && val "$file" SQS_QUEUE_URL || val "$file" ARTICLE_EVENTS_QUEUE_URL )"
    [ "$q" = "$EXPECTED_QUEUE_URL" ] && ok "$comp: queue URL = production queue" || die "$comp: queue URL does not point to $QUEUE_NAME" 3
    db="$(val "$file" DATABASE_URL_POOLED)"
    printf %s "$db" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const u=new URL(s);
      const role=decodeURIComponent(u.username);const bad=[];
      if(!/^supporthub_[a-z]+_app$/.test(role))bad.push("role is not a restricted supporthub_*_app role");
      if(/owner/i.test(role))bad.push("owner role");
      if(u.searchParams.get("sslmode")!=="verify-full")bad.push("sslmode is not verify-full");
      if(!u.password)bad.push("no password");
      console.log(bad.length?"BAD "+bad.join(", "):"OK role="+role)})' > "$TMPD/db.chk" 2>/dev/null || echo "BAD unparseable DATABASE_URL_POOLED" > "$TMPD/db.chk"
    r="$(cat "$TMPD/db.chk")"
    case "$r" in OK*) ok "$comp: database identity ${r#OK } (restricted, TLS verify-full)" ;; *) die "$comp: DATABASE_URL_POOLED ${r#BAD }" 2 ;; esac
    for k in AWS_ENDPOINT_URL SQS_ENDPOINT_URL; do v="$(val "$file" $k)"; [ -z "$v" ] || [ "$v" = "http://floci:4566" ] || die "$comp: $k must be http://floci:4566 (main Floci on $NETWORK)" 3; done
    if [ $comp = editorial ]; then
      [ "$(val "$file" SERVICE_SHARED_SECRET | wc -c)" -gt 32 ] && ok "editorial: SERVICE_SHARED_SECRET length >= 32" || die "editorial: SERVICE_SHARED_SECRET too short" 2
      case "$(val "$file" ARTICLE_SERVICE_URL)" in https://*) ok "editorial: ARTICLE_SERVICE_URL uses HTTPS" ;; *) die "editorial: ARTICLE_SERVICE_URL must be https://" 2 ;; esac
    fi
    [ "$(val "$file" NODE_ENV)" = production ] && ok "$comp: NODE_ENV=production" || die "$comp: NODE_ENV must be production" 2
  fi
  # docker --env-file needs LF line endings: write a CR-free private temp copy.
  tr -d '\r' < "$file" | grep -E '^[A-Za-z_][A-Za-z0-9_]*=' > "$TMPD/$comp.run.env"
done

# ---------------------------------------------------------------------
step "3. Floci, production queue, DLQ, redrive and queue IAM keys"
FQ_ARGS=(--env "$ENV_NAME"); [ "$DRY_RUN" = true ] && FQ_ARGS+=(--verify-only)
bash infra/floci/floci-queues.sh "${FQ_ARGS[@]}" > "$TMPD/fq.log" 2>&1; fq=$?
grep -E '\[(FAIL|CHANGE|WARN)\]|ERROR|floci-queues \(' "$TMPD/fq.log" | sed 's/^/    /'
READY_EPOCH=$(date +%s)   # errors logged before Floci was ready are not counted later
case $fq in
  0) ok "Floci healthy; $QUEUE_NAME + DLQ + redrive + IAM keys verified (floci-queues.sh exit 0)" ;;
  3) die "floci-queues.sh found an unexpected configuration (exit 3) - not starting workers" 3 ;;
  4) die "Floci is not running/healthy (floci-queues.sh exit 4) - not starting workers" 4 ;;
  2) die "floci-queues.sh prerequisite missing (exit 2)" 2 ;;
  *) die "floci-queues.sh reported failed checks (exit $fq) - not starting workers" 1 ;;
esac

# ---------------------------------------------------------------------
step "4. Worker dependencies"
docker network inspect "$NETWORK" >/dev/null 2>&1 && ok "network $NETWORK exists" || die "network $NETWORK missing" 3
FLOCI_CT=$([ "$ENV_NAME" = production ] && echo supporthub-floci || echo "$SUPPORTHUB_PREFIX-floci")
docker inspect -f "{{range \$k,\$v := .NetworkSettings.Networks}}{{if eq \$k \"$NETWORK\"}}{{\$v.Aliases}}{{end}}{{end}}" "$FLOCI_CT" | grep -qw floci \
  && ok "$FLOCI_CT reachable as 'floci' on $NETWORK" || die "$FLOCI_CT has no alias 'floci' on $NETWORK" 3
if [ "$ENV_NAME" = production ]; then
  host="$(val "$TMPD/article.run.env" DATABASE_URL_POOLED | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(new URL(s).hostname))')"
  timeout 8 bash -c "exec 3<>/dev/tcp/$host/5432" 2>/dev/null && ok "Neon pooler reachable on TCP 5432 (host not printed)" || bad "Neon pooler not reachable on TCP 5432"
  au="$(val "$TMPD/editorial.run.env" ARTICLE_SERVICE_URL)"
  [ "$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$au/api/health")" = 200 ] && ok "Article service health 200 ($au)" || bad "Article service health check failed ($au)"
else
  pg="$SUPPORTHUB_PREFIX-postgres"
  if [ "$(docker inspect -f '{{.State.Running}}' "$pg" 2>/dev/null)" != true ]; then
    if [ "$DRY_RUN" = true ]; then plan "start $pg"; else docker start "$pg" >/dev/null || die "cannot start $pg" 5; fi
  fi
  for i in $(seq 1 60); do [ "$(docker inspect -f '{{.State.Health.Status}}' "$pg" 2>/dev/null)" = healthy ] && break; [ "$DRY_RUN" = true ] && break; sleep 2; done
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$pg" 2>/dev/null)" = healthy ] && ok "$pg healthy" || bad "$pg not healthy"
fi

# ---------------------------------------------------------------------
# Existing-container checks: returns 0 if the container matches the profile.
matches() { # name image cmd expected-env-file
  local name="$1" image="$2" cmd="$3" file="$4" diffs="" k a b envc
  [ "$(docker inspect -f '{{.Config.Image}}' "$name")" = "$image" ] || diffs="$diffs image"
  [ "$(docker inspect -f '{{json .Config.Cmd}}' "$name")" = "$cmd" ] || diffs="$diffs command"
  [ "$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$name")" = unless-stopped ] || diffs="$diffs restart-policy"
  docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$name" | grep -qw "$NETWORK" || diffs="$diffs network"
  envc="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$name")"
  for k in $(sed -nE 's/^([A-Za-z_][A-Za-z0-9_]*)=.*/\1/p' "$file"); do
    a="$(val "$file" "$k")"; b="$(printf '%s\n' "$envc" | sed -n "s/^$k=//p" | head -1)"
    [ "$a" = "$b" ] || diffs="$diffs env:$k"
  done
  [ -z "$diffs" ] && return 0
  echo "    differences (names only):$diffs"; return 1
}
other_consumers() { # name queue-url -> other running containers using this queue
  local self="$1" c
  for c in $(docker ps --format '{{.Names}}'); do
    [ "$c" = "$self" ] && continue
    # "floci:4566" resolves per network, so only the same network is the same queue.
    docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$c" | grep -qw "$NETWORK" || continue
    docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$c" | grep -qE "^(ARTICLE_EVENTS_QUEUE_URL|SQS_QUEUE_URL)=$2\$" || continue
    # same role on the same queue = duplicate worker instance
    docker inspect -f '{{json .Config.Cmd}}' "$c" | grep -qF "$3" && echo "$c"
  done
}

step "5-6. Workers (article publisher first, then editorial consumer)"
for spec in "${WORKERS[@]}"; do
  IFS='|' read -r comp name image cmd file marker <<<"$spec"
  script="$(printf %s "$cmd" | sed -E 's/.*"([^"]+\.js)".*/\1/')"
  dups="$(other_consumers "$name" "$EXPECTED_QUEUE_URL" "$script")"
  [ -z "$dups" ] || die "another running container already runs $script on $QUEUE_NAME: $(echo $dups) - refusing to start a duplicate" 3
  docker image inspect "$image" >/dev/null 2>&1 || die "image $image not found locally (this script never builds images)" 2
  n=$(docker ps -a --filter "name=^/${name}\$" -q | wc -l | tr -d ' ')
  if [ "$n" -eq 1 ]; then
    if matches "$name" "$image" "$cmd" "$file"; then ok "$name exists with expected image/command/network/restart policy/env (reused)"
    else die "$name exists but its configuration differs from $file - not modified (remove/recreate only after review)" 3; fi
    if [ "$(docker inspect -f '{{.State.Running}}' "$name")" = true ]; then
      ok "$name already running (no duplicate started)"
    elif [ "$DRY_RUN" = true ]; then plan "docker start $name"
    else docker start "$name" >/dev/null && ok "started existing $name" || die "docker start $name failed" 5
    fi
  else
    if [ "$DRY_RUN" = true ]; then plan "create $name ($image, --restart unless-stopped, network $NETWORK)"
    elif [ "$ENV_NAME" = production ]; then
      docker run -d --name "$name" --restart unless-stopped --network "$NETWORK" \
        --env-file "$(cygpath -w "$TMPD/$comp.run.env" 2>/dev/null || echo "$TMPD/$comp.run.env")" \
        "$image" "$script" >/dev/null && ok "created $name" || die "docker run $name failed" 5
    else
      docker compose -f infra/floci/docker-compose.supporthub.yml up -d --no-deps --no-build \
        "$( [ $comp = article ] && echo article-outbox-worker || echo editorial-article-worker )" >/dev/null 2>&1 \
        && ok "created $name (compose, --no-deps --no-build)" || die "compose could not create $name" 5
    fi
  fi
done

# ---------------------------------------------------------------------
step "7. Post-start verification"
if [ "$DRY_RUN" != true ]; then sleep "${POST_START_WAIT:-12}"; fi
for spec in "${WORKERS[@]}"; do
  IFS='|' read -r comp name image cmd file marker <<<"$spec"
  [ "$(docker ps -a --filter "name=^/${name}\$" -q | wc -l | tr -d ' ')" -eq 1 ] || { [ "$DRY_RUN" = true ] && continue; bad "$name missing"; continue; }
  st="$(docker inspect -f '{{.State.Status}} restarts={{.RestartCount}} restart-policy={{.HostConfig.RestartPolicy.Name}}' "$name")"
  if [ "$(docker inspect -f '{{.State.Running}}' "$name")" = true ] && [ "$(docker inspect -f '{{.State.Restarting}}' "$name")" = false ]; then ok "$name $st"
  elif [ "$DRY_RUN" = true ]; then echo "  [INFO] $name $st"
  else bad "$name $st"; fi
  since="$(docker inspect -f '{{.State.StartedAt}}' "$name")"
  docker logs --since "$since" "$name" 2>&1 | grep -qF "$marker" && ok "$name startup log: '$marker'" \
    || { [ "$(docker inspect -f '{{.State.Running}}' "$name")" = true ] && echo "  [INFO] $name: startup marker not in logs since last start" || true; }
  errs=$(docker logs --since "$((READY_EPOCH + 5))" "$name" 2>&1 | grep -ciE 'polling failed|ECONNREFUSED|EAI_AGAIN|authentication failed|AccessDenied' || true)
  [ "${errs:-0}" -eq 0 ] && ok "$name: no connection/auth errors since Floci was confirmed ready" || bad "$name: $errs connection/auth error line(s) after Floci was ready"
  cnt=$(docker ps --filter "name=^/${name}\$" -q | wc -l | tr -d ' ')
  [ "$cnt" -le 1 ] && ok "$name: single instance (running count $cnt)" || bad "$name: $cnt running instances"
done

echo
echo "====================================================================="
echo " Worker startup ($ENV_NAME): $PASS passed, $FAIL failed$([ "$DRY_RUN" = true ] && echo ", $NEEDED action(s) planned")"
echo "====================================================================="
[ "$FAIL" -eq 0 ] || exit 1
[ "$VERIFY_ONLY" = true ] && [ "$NEEDED" -gt 0 ] && exit 1
exit 0
