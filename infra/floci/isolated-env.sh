# Sourced by setup-supporthub.sh, verify-iam.sh and verify-aws-usage.sh when
# SUPPORTHUB_ISOLATED=true. Runs the whole stack against its OWN Floci and
# Postgres so tests never reach the team's supporthub-floci, its queues (whose
# workers use Neon) or its IAM users. Everything generated stays git-ignored.
export SUPPORTHUB_PREFIX=supporthub-iso
export SUPPORTHUB_FLOCI_PORT=4567
export SUPPORTHUB_PORT_BASE=320
export SUPPORTHUB_FRONTEND_PORT=8188
export SUPPORTHUB_GEN=infra/floci/.generated/isolated
export SUPPORTHUB_GEN_DIR=./.generated/isolated
