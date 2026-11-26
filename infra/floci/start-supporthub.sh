#!/usr/bin/env bash
# =====================================================================
# SupportHub Group 12 - MASTER START SCRIPT for the AWS layer (Floci).
# One command: start Floci -> AWS resources -> IAM -> Secrets Manager ->
# Lambda -> ECS cluster -> the three workers -> (optional) Cloudflare tunnel.
# The four APIs run ONLY on Vercel; the frontend ONLY on Cloudflare Pages;
# the database is Neon. Local API containers are for isolated tests only.
#
#   bash infra/floci/start-supporthub.sh --env isolated              # test stack (port 4567)
#   bash infra/floci/start-supporthub.sh --env production --status   # read-only
#   SUPPORTHUB_PRODUCTION_APPROVED=true bash infra/floci/start-supporthub.sh --env production \
#        [--recreate-floci] [--start-workers] [--with-tunnel]
#
#   --recreate-floci  recreate the main Floci from infra/floci/docker-compose.yml when it lacks the
#                     Docker socket or is published beyond loopback (data volume floci_floci-data kept)
#   --start-workers   run the ECS workers (desiredCount 1). Default 0 = deployed but idle, so they
#                     never compete with the legacy laptop worker containers before the cutover
#   --with-tunnel     start cloudflared (token in infra/floci/.generated/production/cloudflared.env)
#
# Inputs for production (private, outside git; prepared by prepare-production-env.sh):
#   %LOCALAPPDATA%\SupportHub\remote\production.env           (restricted DB URLs + HMAC)
#   %LOCALAPPDATA%\SupportHub\production-workers\article.aws.env, editorial.aws.env (existing keys)
# Nothing is deleted; keys are reused; secrets are never printed.
# Exit codes: 0 ok, 1 step failed, 2 usage/prerequisite, 3 refused by a safety check.
# =====================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; cd "$ROOT" || exit 2
ENV_NAME=""; RECREATE=false; START=false; TUNNEL=false; STATUS=false
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_NAME="$2"; shift 2 ;;
    --recreate-floci) RECREATE=true; shift ;;
    --start-workers) START=true; shift ;;
    --with-tunnel) TUNNEL=true; shift ;;
    --status) STATUS=true; shift ;;
    -h|--help) sed -n 2,27p "$0"; exit 0 ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
done
step() { echo; echo "######## $1"; }
die() { echo "ERROR: $1" >&2; exit "${2:-1}"; }
health() { docker inspect -f '{{.State.Health.Status}}' "$1" 2>/dev/null; }
wait_healthy() { for i in $(seq 1 120); do [ "$(health "$1")" = healthy ] && return 0; sleep 3; done; return 1; }

case "$ENV_NAME" in
# ------------------------------------------------------------------ isolated
isolated)
  if $STATUS; then exec bash infra/floci/ecs/deploy-ecs-workers.sh --env isolated --status; fi
  step "Isolated Floci (127.0.0.1:4567)"
  docker start supporthub-iso-floci >/dev/null 2>&1 || die "supporthub-iso-floci missing - run SUPPORTHUB_ISOLATED=true bash infra/floci/setup-supporthub.sh first" 2
  wait_healthy supporthub-iso-floci || die "isolated Floci not healthy"
  step "Queues, DLQ and IAM (verify/create)"
  bash infra/floci/floci-queues.sh --env isolated || die "floci-queues failed"
  step "ECS workers"
  bash infra/floci/ecs/deploy-ecs-workers.sh --env isolated --desired 1 || die "ECS deploy failed"
  ;;
# ---------------------------------------------------------------- production
production)
  FLOCI="${SUPPORTHUB_FLOCI_CONTAINER:-supporthub-floci}"; NET="${SUPPORTHUB_NETWORK:-floci_default}"
  GEN="${SUPPORTHUB_GEN:-infra/floci/.generated/production}"
  PRIV="${SUPPORTHUB_PRIVATE_DIR:-${LOCALAPPDATA:-$HOME/.local/share}/SupportHub}"
  command -v cygpath >/dev/null 2>&1 && PRIV="$(cygpath -u "$PRIV")"
  if $STATUS; then
    step "Status (read-only)"
    echo "  $FLOCI: $(health "$FLOCI") ; ports: $(docker port "$FLOCI" 2>/dev/null | tr '\n' ' ') ; docker.sock: $(docker inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' "$FLOCI" 2>/dev/null | grep -c docker.sock)"
    echo "  cloudflared: $(docker inspect -f '{{.State.Status}}' supporthub-cloudflared 2>/dev/null || echo absent)"
    echo "  legacy laptop workers: $(docker ps --filter name=supporthub-prod- --format '{{.Names}}' | tr '\n' ' ')"
    bash infra/floci/ecs/deploy-ecs-workers.sh --env production --status 2>&1 | sed 's/^/  /'
    exit 0
  fi
  [ "${SUPPORTHUB_PRODUCTION_APPROVED:-false}" = true ] || die "production changes need approval: set SUPPORTHUB_PRODUCTION_APPROVED=true" 3

  step "Private inputs -> $GEN (git-ignored, owner-only)"
  case "$GEN" in infra/floci/.generated/*) ;; *) die "SUPPORTHUB_GEN must be under infra/floci/.generated" 2 ;; esac
  mkdir -p -- "$GEN" && chmod 700 -- "$GEN"
  umask 077
  [ -f "$PRIV/remote/production.env" ] || die "missing $PRIV/remote/production.env - run infra/floci/remote/prepare-production-env.sh" 2
  cp -- "$PRIV/remote/production.env" "$GEN/production.env"
  for c in article editorial; do
    if [ ! -f "$GEN/$c.aws.env" ] && [ -f "$PRIV/production-workers/$c.aws.env" ]; then
      grep -E '^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY)=' "$PRIV/production-workers/$c.aws.env" > "$GEN/$c.aws.env"
    fi
  done
  chmod 600 -- "$GEN"/*.env
  echo "  production.env + existing worker keys in place (values not printed)"

  step "Floci ($FLOCI): loopback-only + Docker socket"
  needs=""
  docker inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' "$FLOCI" 2>/dev/null | grep -q /var/run/docker.sock || needs="$needs no-docker-socket"
  docker port "$FLOCI" 4566 2>/dev/null | grep -vE '^(127\.0\.0\.1|\[::1\]):' | grep -q . && needs="$needs published-beyond-loopback"
  docker inspect "$FLOCI" >/dev/null 2>&1 || needs="$needs missing"
  if [ -n "$needs" ]; then
    $RECREATE || die "Floci needs recreation ($needs). Re-run with --recreate-floci (data volume is kept)." 3
    [ "$FLOCI" = supporthub-floci ] || die "--recreate-floci only supports the main supporthub-floci container" 3
    docker compose -p floci -f infra/floci/docker-compose.yml up -d --no-deps --force-recreate floci || die "Floci recreation failed"
    echo "  recreated from infra/floci/docker-compose.yml (127.0.0.1:4566, Docker socket, volume floci_floci-data kept)"
  else
    docker start "$FLOCI" >/dev/null 2>&1; echo "  $FLOCI already compliant"
  fi
  wait_healthy "$FLOCI" || die "Floci not healthy"

  step "AWS resources, IAM, Secrets Manager, Lambda (idempotent)"
  SUPPORTHUB_FLOCI_MODE=local SUPPORTHUB_LOCAL_APPROVED=true SUPPORTHUB_FLOCI_CONTAINER="$FLOCI" SUPPORTHUB_NETWORK="$NET" \
  SUPPORTHUB_GEN="$GEN" ARTICLE_WORKER_USER="${ARTICLE_WORKER_USER:-supporthub-prod-article-publisher}" \
  EDITORIAL_WORKER_USER="${EDITORIAL_WORKER_USER:-supporthub-prod-editorial-consumer}" \
    bash infra/floci/remote/remote-init-aws.sh || die "AWS initialisation failed"

  step "ECS cluster + three workers (desiredCount $($START && echo 1 || echo 0))"
  SUPPORTHUB_GEN="$GEN" bash infra/floci/ecs/deploy-ecs-workers.sh --env production --desired "$($START && echo 1 || echo 0)" || die "ECS deploy failed"

  if $TUNNEL; then
    step "Cloudflare tunnel connector (outbound only)"
    [ -f "$GEN/cloudflared.env" ] && grep -q '^TUNNEL_TOKEN=.' "$GEN/cloudflared.env" || die "missing TUNNEL_TOKEN in $GEN/cloudflared.env" 2
    if docker inspect supporthub-cloudflared >/dev/null 2>&1; then docker start supporthub-cloudflared >/dev/null
    else
      docker run -d --name supporthub-cloudflared --network "$NET" --restart unless-stopped \
        --env-file "$GEN/cloudflared.env" cloudflare/cloudflared:latest tunnel --no-autoupdate run >/dev/null || die "cloudflared start failed"
    fi
    echo "  cloudflared $(docker inspect -f '{{.State.Status}}' supporthub-cloudflared) on $NET (no published port)"
  fi
  step "Summary"
  echo "  Floci: $(health "$FLOCI"), ports $(docker port "$FLOCI" | tr '\n' ' ')"
  $START || echo "  ECS workers deployed IDLE. Start them at the approved cutover: --start-workers (or cutover.sh)."
  ;;
*) echo "--env isolated|production required"; exit 2 ;;
esac
