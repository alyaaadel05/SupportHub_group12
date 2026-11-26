#!/usr/bin/env bash
# =====================================================================
# SupportHub Group 12 - run the three background workers as ECS services
# on Floci (ECS "Real Docker": Floci starts real containers via the host
# Docker socket and replaces failed tasks).
#
#   Article Outbox Worker          (Alyaa)  supporthub-article-outbox-worker
#   Editorial Article Consumer     (Salma)  supporthub-editorial-article-consumer
#   Editorial Publication Worker   (Salma)  supporthub-editorial-publication-worker
#
# Usage (repository root, Git Bash / Linux):
#   bash infra/floci/ecs/deploy-ecs-workers.sh --env isolated            # deploy / update
#   bash infra/floci/ecs/deploy-ecs-workers.sh --env isolated --status   # read-only status
#   bash infra/floci/ecs/deploy-ecs-workers.sh --env isolated --scale 0  # stop the ECS workers
#
# --env remote is for the remote Floci host (run ON that host, endpoint
# http://localhost:4566 there). It refuses to run against this PC's main
# Floci on 4566 unless SUPPORTHUB_REMOTE_HOST=true is set on the remote host.
#
# Least privilege: Floci injects its default admin credentials into ECS tasks
# and does not enforce taskRoleArn, so every task receives its OWN component
# IAM key through the task definition "secrets" (Secrets Manager), which
# overrides the injected credentials. Task/execution roles are still created
# with scoped policies so the same definitions work on real ECS.
# No secret value is printed. Idempotent: existing resources are reused.
# =====================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1 AWS_PAGER="" AWS_DEFAULT_REGION=us-east-1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"; cd "$ROOT" || exit 2
ENV_NAME=""; MODE=deploy; SCALE=1; DESIRED=1
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_NAME="$2"; shift 2 ;;
    --status) MODE=status; shift ;;
    --scale) MODE=scale; SCALE="$2"; shift 2 ;;
    --desired) DESIRED="$2"; shift 2 ;;
    -h|--help) sed -n 2,26p "$0"; exit 0 ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
done
case "$ENV_NAME" in
  isolated) EP=http://localhost:4567; FLOCI=supporthub-iso-floci; GEN=infra/floci/.generated/isolated
            ARTICLE_IMAGE=supporthub-int-article:local; EDITORIAL_IMAGE=supporthub-int-editorial:local
            ARTICLE_URL=http://article:3001; NODE_ENV_VALUE=development
            QUEUE_URL=http://floci:4566/000000000000/supporthub-article-events ;;
  remote)   [ "${SUPPORTHUB_REMOTE_HOST:-false}" = true ] || { echo "refusing: --env remote must run on the remote Floci host (set SUPPORTHUB_REMOTE_HOST=true there)"; exit 3; }
            EP=http://localhost:4566; FLOCI="${SUPPORTHUB_FLOCI_CONTAINER:-supporthub-floci}"; GEN="${SUPPORTHUB_GEN:-infra/floci/.generated/remote}"
            ARTICLE_IMAGE="${ARTICLE_IMAGE:-}"; EDITORIAL_IMAGE="${EDITORIAL_IMAGE:-}"
            if [ "$MODE" = deploy ] && { [ -z "$ARTICLE_IMAGE" ] || [ -z "$EDITORIAL_IMAGE" ]; }; then echo "set ARTICLE_IMAGE and EDITORIAL_IMAGE for a deploy"; exit 2; fi
            ARTICLE_URL="${ARTICLE_SERVICE_URL:-https://supporthub-article-service.vercel.app}"; NODE_ENV_VALUE=production
            # Rehearsal only: a non-production task NODE_ENV (allows plain-HTTP service URLs) is
            # refused for the real remote output folder, so production always enforces HTTPS.
            if [ -n "${SUPPORTHUB_TASK_NODE_ENV:-}" ] && [ "$SUPPORTHUB_TASK_NODE_ENV" != production ]; then
              [ "$GEN" != infra/floci/.generated/remote ] || { echo "refusing SUPPORTHUB_TASK_NODE_ENV=$SUPPORTHUB_TASK_NODE_ENV for the real remote deployment"; exit 3; }
              NODE_ENV_VALUE="$SUPPORTHUB_TASK_NODE_ENV"; echo "  NOTE: rehearsal task NODE_ENV=$NODE_ENV_VALUE ($GEN)"
            fi
            QUEUE_URL="http://floci:4566/000000000000/${QUEUE_NAME:-supporthub-article-events-production}" ;;
  production)
            # Laptop/demo host: the main Floci (loopback-only port) runs the production workers as ECS.
            EP="${SUPPORTHUB_FLOCI_ENDPOINT:-http://127.0.0.1:4566}"; FLOCI="${SUPPORTHUB_FLOCI_CONTAINER:-supporthub-floci}"
            GEN="${SUPPORTHUB_GEN:-infra/floci/.generated/production}"
            ARTICLE_IMAGE="${ARTICLE_IMAGE:-supporthub-prod-article:local}"; EDITORIAL_IMAGE="${EDITORIAL_IMAGE:-supporthub-prod-editorial:local}"
            ARTICLE_URL="${ARTICLE_SERVICE_URL:-https://supporthub-article-service.vercel.app}"; NODE_ENV_VALUE=production
            QUEUE_URL="http://floci:4566/000000000000/${QUEUE_NAME:-supporthub-article-events-production}"
            DB_SECRET_ARTICLE="${DB_SECRET_ARTICLE:-supporthub/article/database}"; DB_SECRET_EDITORIAL="${DB_SECRET_EDITORIAL:-supporthub/editorial/database}"
            if [ "$MODE" != status ] && [ "${SUPPORTHUB_PRODUCTION_APPROVED:-false}" != true ]; then
              echo "refusing: production $MODE changes the production workers; set SUPPORTHUB_PRODUCTION_APPROVED=true after approval"; exit 3
            fi ;;
  *) echo "--env isolated|remote|production required"; exit 2 ;;
esac
CLUSTER=supporthub-workers
SERVICES="article-outbox-worker:supporthub-article-outbox-worker editorial-article-consumer:supporthub-editorial-article-consumer editorial-publication-worker:supporthub-editorial-publication-worker"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  [PASS] $1"; }
bad() { FAIL=$((FAIL+1)); echo "  [FAIL] $1"; }
die() { echo "ERROR: $1" >&2; exit "${2:-2}"; }
# Native path for Docker bind mounts (Git Bash on Windows rehearsal); plain path on Linux.
mp() { (cd -- "$1" && pwd -W 2>/dev/null) || (cd -- "$1" && pwd); }

# ---------------------------------------------------------------------
# Temporary files - safe handling
#  * one dedicated directory per run, validated before use (non-empty,
#    absolute, not a symlink, expected basename, never the repository root,
#    remote: confined to the git-ignored infra/floci/.generated tree);
#  * only files this script creates are recorded in CREATED and deleted,
#    each by exact path with an allow-listed name (<service>.json/.arn);
#  * no recursive and no wildcard deletion; the directory itself is removed
#    with rmdir, which fails (harmlessly) if anything unexpected is inside.
# ---------------------------------------------------------------------
TMP=""; CREATED=()
ALLOWED_TMP_NAMES=""
for spec in $SERVICES; do ALLOWED_TMP_NAMES="$ALLOWED_TMP_NAMES ${spec%%:*}.json ${spec%%:*}.arn"; done
ROOT_REAL="$(cd -- "$ROOT" && pwd -P)" || die "cannot resolve repository root"
make_tmpdir() {
  if [ "$ENV_NAME" = remote ]; then
    TMP="$ROOT/$GEN/ecs-deploy-tmp"
    mkdir -p -- "$TMP" && chmod 700 -- "$TMP" || die "cannot create $TMP"
  else
    local d; d="$(mktemp -d "${TMPDIR:-/tmp}/supporthub-ecs-deploy.XXXXXX")" || die "mktemp failed"
    TMP="$(cd -- "$d" && (pwd -W 2>/dev/null || pwd))" || die "cannot resolve $d"
  fi
  [ -n "$TMP" ] || die "temporary directory path is empty"
  case "$TMP" in /*|[A-Za-z]:/*) ;; *) die "temporary directory is not absolute: $TMP" ;; esac
  [ -d "$TMP" ] && [ ! -L "$TMP" ] || die "temporary directory missing or a symlink: $TMP"
  case "$(basename -- "$TMP")" in supporthub-ecs-deploy.??????|ecs-deploy-tmp) ;; *) die "unexpected temporary directory name: $TMP" ;; esac
  local real; real="$(cd -- "$TMP" && pwd -P)" || die "cannot resolve $TMP"
  [ "$real" != "/" ] && [ "$real" != "$ROOT_REAL" ] || die "refusing temporary directory $real"
  if [ "$ENV_NAME" = remote ]; then
    case "$real" in "$ROOT_REAL"/infra/floci/.generated/*/ecs-deploy-tmp|"$ROOT_REAL"/infra/floci/.generated/ecs-deploy-tmp) ;;
      *) die "remote temporary directory must be inside infra/floci/.generated: $real" ;; esac
  else
    case "$real/" in "$ROOT_REAL"/*) die "temporary directory must not be inside the repository: $real" ;; esac
  fi
}
track_tmp() { # record a file this script is about to create inside TMP
  local name; name="$(basename -- "$1")"
  case " $ALLOWED_TMP_NAMES " in *" $name "*) ;; *) die "refusing to track unexpected temporary file $name" ;; esac
  [ "$(dirname -- "$1")" = "$TMP" ] || die "temporary file outside $TMP: $1"
  CREATED+=("$1")
}
cleanup_tmp() {
  [ -n "$TMP" ] || return 0
  local f
  for f in "${CREATED[@]}"; do
    [ "$(dirname -- "$f")" = "$TMP" ] || continue
    case " $ALLOWED_TMP_NAMES " in *" $(basename -- "$f") "*) ;; *) continue ;; esac
    if [ -f "$f" ] && [ ! -L "$f" ]; then rm -f -- "$f"; fi
  done
  rmdir -- "$TMP" 2>/dev/null || true
}
trap cleanup_tmp EXIT

if [ "$ENV_NAME" = remote ]; then
  # Remote host: Floci publishes NO host port. The AWS CLI runs in a short-lived
  # container on the private network (repository mounted read-only at /repo,
  # the validated temporary directory at /work).
  NETWORK="${SUPPORTHUB_NETWORK:-supporthub-net}"
  make_tmpdir
  A() { timeout 60 docker run --rm -i --network "$NETWORK" -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test \
          -e AWS_DEFAULT_REGION=us-east-1 -e AWS_PAGER= -v "$(mp "$ROOT"):/repo:ro" -v "$(mp "$TMP"):/work" -w /work \
          amazon/aws-cli --cli-connect-timeout 5 --cli-read-timeout 30 --endpoint-url http://floci:4566 "$@"; }
  [ "$(docker inspect -f '{{.State.Running}}' "$FLOCI" 2>/dev/null)" = true ] || { echo "$FLOCI is not running"; exit 4; }
  [ -z "$(docker port "$FLOCI" 2>/dev/null)" ] || { echo "$FLOCI publishes host ports - refusing (remote Floci must stay private)"; exit 3; }
  A sts get-caller-identity >/dev/null 2>&1 || { echo "Floci not reachable on $NETWORK"; exit 4; }
  POLICY_PREFIX=/repo/
else
  A() { AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test timeout 40 aws --cli-connect-timeout 5 --cli-read-timeout 30 --endpoint-url "$EP" "$@"; }
  curl -fsS -m 5 "$EP/_floci/health" >/dev/null || { echo "Floci not reachable at $EP"; exit 4; }
  docker port "$FLOCI" 4566 2>/dev/null | grep -q "${EP##*:}" || { echo "endpoint $EP does not belong to $FLOCI - refusing"; exit 3; }
  if [ "$ENV_NAME" = production ]; then
    # Production Floci must be loopback-only (default admin credentials + unsigned S3 reads).
    docker port "$FLOCI" 4566 2>/dev/null | grep -vE '^127\.0\.0\.1:|^\[::1\]:' | grep -q . \
      && { echo "$FLOCI is published beyond loopback - refusing (recreate it with start-supporthub.sh --recreate-floci)"; exit 3; }
    docker inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' "$FLOCI" | grep -q '/var/run/docker.sock' \
      || { echo "$FLOCI has no Docker socket - ECS tasks cannot start (recreate it with start-supporthub.sh --recreate-floci)"; exit 3; }
  fi
  POLICY_PREFIX=""
  if [ "$MODE" = deploy ]; then make_tmpdir; fi
fi

status() {
  echo "== ECS cluster $CLUSTER on $EP"
  for spec in $SERVICES; do
    svc="${spec%%:*}"
    A ecs describe-services --cluster "$CLUSTER" --services "$svc" \
      --query 'services[0].[serviceName,status,desiredCount,runningCount,taskDefinition]' --output text 2>/dev/null | sed 's/^/  /'
  done
  docker ps --filter name=floci-aws-ecs- --format '  container {{.Names}} {{.Status}}' | grep -E "outbox|consumer|publication" || true
}
if [ "$MODE" = status ]; then status; exit 0; fi
if [ "$MODE" = scale ]; then
  for spec in $SERVICES; do svc="${spec%%:*}"; A ecs update-service --cluster "$CLUSTER" --service "$svc" --desired-count "$SCALE" --query 'service.desiredCount' --output text >/dev/null && ok "$svc desiredCount=$SCALE" || bad "$svc scale"; done
  exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
fi

echo "==> Secrets (component keys for the tasks; values never printed)"
ensure_cred_secret() { # secret-name key-file
  local name="$1" file="$2"
  [ -f "$file" ] || { bad "missing $file"; return; }
  local json; json="$(node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8");const g=k=>(t.match(new RegExp("^"+k+"=(.+)$","m"))||[])[1].trim();process.stdout.write(JSON.stringify({AWS_ACCESS_KEY_ID:g("AWS_ACCESS_KEY_ID"),AWS_SECRET_ACCESS_KEY:g("AWS_SECRET_ACCESS_KEY")}))' "$file")"
  if A secretsmanager describe-secret --secret-id "$name" >/dev/null 2>&1; then
    # Reuse only if the stored key id matches the key file (compared in node; nothing printed).
    local stored; stored="$(A secretsmanager get-secret-value --secret-id "$name" --query SecretString --output text 2>/dev/null)"
    if STORED="$stored" WANT="$json" node -e 'try{process.exit(JSON.parse(process.env.STORED).AWS_ACCESS_KEY_ID===JSON.parse(process.env.WANT).AWS_ACCESS_KEY_ID?0:1)}catch{process.exit(1)}'; then
      ok "secret $name exists and matches $file (reused)"
    else
      A secretsmanager put-secret-value --secret-id "$name" --secret-string "$json" >/dev/null 2>&1 \
        && ok "secret $name updated (stored key id differed from $file)" || bad "secret $name update"
    fi
    unset stored json; return
  fi
  A secretsmanager create-secret --name "$name" --secret-string "$json" >/dev/null 2>&1 && ok "secret $name created" || bad "secret $name"
  unset json
}
ensure_cred_secret supporthub/ecs/article-worker-credentials "$GEN/article.aws.env"
ensure_cred_secret supporthub/ecs/editorial-worker-credentials "$GEN/editorial.aws.env"
USE_CA=false
if [ -f "$GEN/certs/ca.crt" ]; then
  USE_CA=true
  if A secretsmanager describe-secret --secret-id supporthub/ecs/local-ca >/dev/null 2>&1; then ok "secret supporthub/ecs/local-ca exists (public CA certificate of the local Postgres)"
  else
    ca="$(node -e 'process.stdout.write(JSON.stringify({LOCAL_CA_PEM:require("fs").readFileSync(process.argv[1],"utf8")}))' "$GEN/certs/ca.crt")"
    A secretsmanager create-secret --name supporthub/ecs/local-ca --secret-string "$ca" >/dev/null 2>&1 && ok "secret supporthub/ecs/local-ca created" || bad "local-ca secret"
  fi
fi

echo "==> IAM roles (scoped; enforced by real ECS, documented for Floci)"
TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
ensure_role() { # role policy-name policy-file
  A iam get-role --role-name "$1" >/dev/null 2>&1 || A iam create-role --role-name "$1" --assume-role-policy-document "$TRUST" >/dev/null 2>&1
  A iam put-role-policy --role-name "$1" --policy-name "$2" --policy-document "file://${POLICY_PREFIX}$3" >/dev/null 2>&1 && ok "role $1 policy $2" || bad "role $1"
}
ensure_role supporthub-ecs-execution SupportHubEcsReadTaskSecrets infra/iam/ecs-execution-secrets-policy.json
ensure_role supporthub-article-worker-task SupportHubArticleWorker infra/iam/article-worker-task-policy.json
ensure_role supporthub-editorial-worker-task SupportHubEditorialWorker infra/iam/editorial-worker-task-policy.json

echo "==> Cluster and task definitions"
A ecs describe-clusters --clusters "$CLUSTER" --query 'clusters[?status==`ACTIVE`].clusterName' --output text | grep -q "$CLUSTER" \
  && ok "cluster $CLUSTER exists" || { A ecs create-cluster --cluster-name "$CLUSTER" >/dev/null && ok "cluster $CLUSTER created" || bad "cluster"; }
[ -n "$TMP" ] && [ -d "$TMP" ] || die "temporary directory not prepared"
for spec in $SERVICES; do
  svc="${spec%%:*}"; family="${spec#*:}"
  # Production: each worker uses its own restricted Neon role, so its database
  # secret can be overridden (DB_SECRET_ARTICLE / DB_SECRET_EDITORIAL), e.g.
  # supporthub/article/database and supporthub/editorial/database.
  case "$svc" in article-*) DBS="${DB_SECRET_ARTICLE:-supporthub/shared/database}" ;; *) DBS="${DB_SECRET_EDITORIAL:-supporthub/shared/database}" ;; esac
  track_tmp "$TMP/$svc.json"; track_tmp "$TMP/$svc.arn"
  node -e '
    const fs=require("fs"); const [src,out,ai,ei,au,q,ne,ca,dbs]=process.argv.slice(1);
    let t=fs.readFileSync(src,"utf8").replace(/__ARTICLE_IMAGE__/g,ai).replace(/__EDITORIAL_IMAGE__/g,ei)
      .replace(/__ARTICLE_SERVICE_URL__/g,au).replace(/__ARTICLE_QUEUE_URL__/g,q).replace(/__NODE_ENV__/g,ne);
    const d=JSON.parse(t);
    for(const c of d.containerDefinitions){
      if(ca!=="true") c.secrets=c.secrets.filter(s=>s.name!=="LOCAL_CA_PEM");
      for(const e of c.environment) if(e.name==="SECRET_IDS") e.value=e.value.replace("supporthub/shared/database",dbs);
    }
    fs.writeFileSync(out,JSON.stringify(d));' \
    "infra/floci/ecs/task-definitions/$svc.json" "$(mp "$TMP")/$svc.json" "$ARTICLE_IMAGE" "$EDITORIAL_IMAGE" "$ARTICLE_URL" "$QUEUE_URL" "$NODE_ENV_VALUE" "$USE_CA" "$DBS"
  (cd "$TMP" && A ecs register-task-definition --cli-input-json "file://$svc.json" --query 'taskDefinition.taskDefinitionArn' --output text) >"$TMP/$svc.arn" 2>&1 \
    && ok "task definition $(sed 's|.*/||' "$TMP/$svc.arn")" || { bad "register $family: $(head -c 200 "$TMP/$svc.arn")"; continue; }
  arn="$(cat "$TMP/$svc.arn")"
  if A ecs describe-services --cluster "$CLUSTER" --services "$svc" --query 'services[?status==`ACTIVE`].serviceName' --output text | grep -q "$svc"; then
    A ecs update-service --cluster "$CLUSTER" --service "$svc" --task-definition "$arn" --desired-count "$DESIRED" --force-new-deployment >/dev/null \
      && ok "service $svc updated -> $(echo "$arn" | sed 's|.*/||')" || bad "update $svc"
  else
    A ecs create-service --cluster "$CLUSTER" --service-name "$svc" --task-definition "$arn" --desired-count "$DESIRED" >/dev/null \
      && ok "service $svc created" || bad "create $svc"
  fi
done
cleanup_tmp; TMP=""

echo "==> Waiting until every service runs $DESIRED task(s) (max 90 s)"
for i in $(seq 1 18); do
  run=0; for spec in $SERVICES; do svc="${spec%%:*}"; c="$(A ecs describe-services --cluster "$CLUSTER" --services "$svc" --query 'services[0].runningCount' --output text 2>/dev/null)"; [ "$c" = "$DESIRED" ] && run=$((run+1)); done
  [ $run -eq 3 ] && break; sleep 5
done
[ "$run" -eq 3 ] && ok "3/3 ECS worker services at runningCount=$DESIRED" || bad "only $run/3 services at runningCount=$DESIRED"
status
echo "Summary: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
