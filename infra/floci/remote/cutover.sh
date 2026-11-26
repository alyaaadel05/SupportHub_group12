#!/usr/bin/env bash
# =====================================================================
# SupportHub Group 12 - move the production workers from THIS laptop to the
# remote ECS workers without losing events. Run on the laptop, repository root.
#
#   REMOTE=user@host bash infra/floci/remote/cutover.sh --check          # READ-ONLY (default)
#   REMOTE=user@host bash infra/floci/remote/cutover.sh --i-approve-production-cutover
#   REMOTE=user@host bash infra/floci/remote/cutover.sh --rollback       # remote to 0, laptop workers back
#   REMOTE_DIR (default ~/supporthub) = bundle location on the VM.
#
# Order (no event lost):
#   1. stop laptop article outbox worker  -> new events stay 'pending' in Neon (durable outbox)
#   2. wait until the laptop production queue has 0 visible and 0 in-flight messages
#      (the laptop consumer finishes everything already sent); abort + restart step 1 if not
#   3. stop laptop editorial consumer
#   4. scale the remote ECS workers to 1 -> they send the pending outbox rows to the remote
#      queue, consume them, and publish pending publication events (Article 21's event
#      included) -> Lambda writes receipts in production Neon (intended)
# Laptop containers are only STOPPED (never removed); the laptop DLQ is reported, not moved.
# Vercel environment changes are a separate, manual approval step (README).
# =====================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1 AWS_PAGER="" AWS_DEFAULT_REGION=us-east-1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"; cd "$ROOT" || exit 2
MODE=check
for a in "$@"; do case "$a" in --check) MODE=check ;; --i-approve-production-cutover) MODE=cutover ;; --rollback) MODE=rollback ;; *) echo "unknown option $a"; exit 2 ;; esac; done
REMOTE="${REMOTE:-}"; REMOTE_DIR="${REMOTE_DIR:-supporthub}"
LAPTOP_EP=http://localhost:4566; Q=supporthub-article-events-production; ACC=000000000000
W_ART=supporthub-prod-article-outbox-worker; W_ED=supporthub-prod-editorial-article-worker
die() { echo "ERROR: $1" >&2; exit "${2:-2}"; }
L() { AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test timeout 30 aws --cli-connect-timeout 5 --cli-read-timeout 20 --endpoint-url "$LAPTOP_EP" "$@"; }
# REMOTE=local: the ECS workers run in this laptop's main Floci (start-supporthub.sh --env production);
# remote commands then run here, with "--env remote" mapped to "--env production".
R() {
  [ -n "$REMOTE" ] || die "set REMOTE=user@host or REMOTE=local"
  if [ "$REMOTE" = local ]; then
    local cmd="${*//--env remote/--env production}"
    cmd="${cmd//SUPPORTHUB_REMOTE_HOST=true/SUPPORTHUB_PRODUCTION_APPROVED=true}"
    cmd="${cmd//infra\/floci\/remote\/verify-remote.sh/infra\/floci\/start-supporthub.sh --env production --status}"
    timeout 600 bash -c "$cmd"
  else
    timeout 600 ssh -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE" "cd $REMOTE_DIR && $*"
  fi
}
depth() { L sqs get-queue-attributes --queue-url "$LAPTOP_EP/$ACC/$1" --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible --query 'Attributes.[ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible]' --output text 2>/dev/null | tr '\t' '/'; }
running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ] && echo running || echo stopped; }

echo "== Read-only status ($(date -u +%FT%TZ))"
echo "  laptop $W_ART: $(running $W_ART) ; $W_ED: $(running $W_ED)"
echo "  laptop queue $Q visible/in-flight: $(depth $Q) ; DLQ: $(depth $Q-dlq)"
echo "  production outboxes (read-only, restricted roles):"
timeout 120 node tests/integration/production-readonly-db-check.mjs pending 2>&1 | sed 's/^/    /'
if [ -n "$REMOTE" ]; then
  echo "  remote ECS services:"; R "bash infra/floci/ecs/deploy-ecs-workers.sh --env remote --status" 2>&1 | sed 's/^/    /' || echo "    (remote not reachable)"
else echo "  remote: REMOTE not set (skipped)"; fi
[ "$MODE" = check ] && { echo "check only - nothing changed"; exit 0; }

if [ "$MODE" = rollback ]; then
  echo "== ROLLBACK"
  R "SUPPORTHUB_REMOTE_HOST=true bash infra/floci/ecs/deploy-ecs-workers.sh --env remote --scale 0" || echo "  WARN: remote scale-down failed - check manually"
  docker start "$W_ED" "$W_ART" >/dev/null && echo "  laptop workers started again"
  exit 0
fi

echo "== CUTOVER (approved)"
[ -n "$REMOTE" ] || die "REMOTE=user@host required"
R "SUPPORTHUB_REMOTE_HOST=true bash infra/floci/remote/verify-remote.sh" >/dev/null 2>&1 || die "remote verification failed - not cutting over" 1
echo "  [1/4] remote verification passed"
docker stop "$W_ART" >/dev/null && echo "  [2/4] laptop article outbox worker stopped (new events stay pending in Neon)"
drained=no
for i in $(seq 1 60); do d="$(depth $Q)"; [ "$d" = "0/0" ] && { drained=yes; break; }; sleep 10; done
if [ "$drained" != yes ]; then
  docker start "$W_ART" >/dev/null; die "laptop queue not drained in 10 min (now $(depth $Q)); article worker restarted, nothing else changed" 1
fi
echo "  [3/4] laptop queue drained (0/0); DLQ $(depth $Q-dlq) stays on the laptop for review"
docker stop "$W_ED" >/dev/null && echo "        laptop editorial consumer stopped"
R "SUPPORTHUB_REMOTE_HOST=true bash infra/floci/ecs/deploy-ecs-workers.sh --env remote --scale 1" >/dev/null || { echo "  remote scale-up FAILED - rolling back"; docker start "$W_ED" "$W_ART" >/dev/null; exit 1; }
echo "  [4/4] remote ECS workers scaled to 1"
sleep 60
echo "== After cutover"; timeout 120 node tests/integration/production-readonly-db-check.mjs pending 2>&1 | sed 's/^/    /'
echo "Rollback if needed: REMOTE=$REMOTE bash infra/floci/remote/cutover.sh --rollback"
