#!/usr/bin/env bash
# =====================================================================
# SupportHub Group 12 - deploy the AWS layer + ECS workers ON THE REMOTE VM.
# Run from the unpacked bundle (repository layout), as a docker-group user:
#   bash infra/floci/remote/deploy-remote.sh             # workers created with desiredCount 0
#   bash infra/floci/remote/deploy-remote.sh --start-workers   # ONLY at the approved cutover
#
# Prerequisites on the VM (see README):
#   infra/floci/.generated/remote/production.env   (from prepare-production-env.sh, chmod 600)
#   infra/floci/.generated/remote/cloudflared.env  (TUNNEL_TOKEN=..., chmod 600)
# Steps: compose up (Floci + cloudflared, no published ports) -> wait healthy ->
# remote-init-aws.sh -> build worker images -> deploy-ecs-workers.sh --env remote.
# Idempotent; never deletes resources, keys or data.
# =====================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"; cd "$ROOT" || exit 2
GEN=infra/floci/.generated/remote
DESIRED=0
for a in "$@"; do case "$a" in --start-workers) DESIRED=1 ;; *) echo "unknown option $a"; exit 2 ;; esac; done
die() { echo "ERROR: $1" >&2; exit "${2:-2}"; }
step() { echo; echo "######## $1"; }

step "Preflight"
command -v docker >/dev/null || die "docker missing (run install-remote-host.sh)"
command -v node >/dev/null || die "node missing (run install-remote-host.sh)"
for f in production.env cloudflared.env; do
  [ -f "$GEN/$f" ] || die "missing $GEN/$f"
  chmod 600 -- "$GEN/$f"
done
grep -q '^TUNNEL_TOKEN=.' "$GEN/cloudflared.env" || die "TUNNEL_TOKEN missing in $GEN/cloudflared.env"
echo "  inputs present (values not printed)"

step "Floci + cloudflared (private network, no published ports)"
docker compose -f infra/floci/remote/docker-compose.remote.yml up -d || die "compose up failed" 4
for i in $(seq 1 100); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' supporthub-floci 2>/dev/null)" = healthy ] && break; sleep 3
done
[ "$(docker inspect -f '{{.State.Health.Status}}' supporthub-floci)" = healthy ] || die "Floci did not become healthy" 4
[ -z "$(docker port supporthub-floci)" ] && [ -z "$(docker port supporthub-cloudflared 2>/dev/null)" ] || die "a container publishes host ports - refusing" 3
echo "  Floci healthy, no published ports; cloudflared $(docker inspect -f '{{.State.Status}}' supporthub-cloudflared)"

step "AWS resources, IAM, secrets, Lambda"
SUPPORTHUB_REMOTE_HOST=true bash infra/floci/remote/remote-init-aws.sh || die "remote-init-aws failed" 1

step "Worker images (built from the bundled source)"
docker build -q -t supporthub-article:prod services/article-service >/dev/null || die "article image build failed"
docker build -q -t supporthub-editorial:prod services/editorial-service >/dev/null || die "editorial image build failed"
echo "  supporthub-article:prod, supporthub-editorial:prod built"

step "ECS workers (desiredCount $DESIRED)"
SUPPORTHUB_REMOTE_HOST=true ARTICLE_IMAGE=supporthub-article:prod EDITORIAL_IMAGE=supporthub-editorial:prod \
  DB_SECRET_ARTICLE=supporthub/article/database DB_SECRET_EDITORIAL=supporthub/editorial/database \
  bash infra/floci/ecs/deploy-ecs-workers.sh --env remote --desired "$DESIRED" || die "ECS deploy failed" 1

step "Done"
[ "$DESIRED" = 0 ] && echo "  Workers are deployed but IDLE (desiredCount 0). Start them only at the approved cutover:" \
  && echo "    bash infra/floci/remote/deploy-remote.sh --start-workers"
echo "  Next: bash infra/floci/remote/verify-remote.sh"
