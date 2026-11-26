#!/usr/bin/env bash
# Safety test for the temporary-file handling of infra/floci/ecs/deploy-ecs-workers.sh.
# Extracts the REAL helper block (between "# Temporary files - safe handling" and
# "trap cleanup_tmp EXIT") and exercises it against decoys. Works only inside a
# scratch area it creates under the system temp directory; never touches the repo.
#   bash tests/integration/ecs-deploy-tmp-safety-check.sh
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/infra/floci/ecs/deploy-ecs-workers.sh"
BLOCK="$(sed -n '/^# Temporary files - safe handling/,/^trap cleanup_tmp EXIT/p' "$SCRIPT" | sed '$d')"
[ -n "$BLOCK" ] || { echo "helper block not found"; exit 2; }
PASS=0; FAIL=0
res() { if [ "$1" = ok ]; then PASS=$((PASS+1)); echo "PASS | $2"; else FAIL=$((FAIL+1)); echo "FAIL | $2"; fi; }
SERVICES="article-outbox-worker:x editorial-article-consumer:y editorial-publication-worker:z"
run_block() { # env-name gen-dir body... -> runs in a subshell, prints EXIT=<code>
  ( ENV_NAME="$1"; GEN="$2"; shift 2
    die() { echo "DIE: $1"; exit 9; }
    eval "$BLOCK"
    trap cleanup_tmp EXIT          # same trap as the real script
    eval "$*"
  ) 2>&1; echo "EXIT=$?"
}
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/tmp-safety-sandbox.XXXXXX")"
FAKEROOT="$SANDBOX/repo"; mkdir -p "$FAKEROOT/infra/floci/.generated/remote" "$FAKEROOT/infra/iam" "$FAKEROOT/evidence"
echo '{"policy":"keep"}' > "$FAKEROOT/infra/iam/keep-policy.json"
echo 'AWS_ACCESS_KEY_ID=keep' > "$FAKEROOT/infra/floci/.generated/remote/article.aws.env"
echo 'evidence keep' > "$FAKEROOT/evidence/keep.txt"
export ROOT_SAVE="$ROOT"

# 1. local mode: tracked files removed, directory removed, nothing else touched
out="$(ROOT="$FAKEROOT" run_block isolated x 'make_tmpdir; echo "TMP=$TMP"; for s in article-outbox-worker editorial-article-consumer; do track_tmp "$TMP/$s.json"; echo t > "$TMP/$s.json"; done; cleanup_tmp; [ -d "$TMP" ] && echo STILL || echo GONE')"
echo "$out" | grep -q GONE && res ok "local: tracked files deleted and the dedicated directory removed" || res bad "local cleanup: $out"
# 2. a decoy (untracked) file in the temp dir survives, and the directory is kept (rmdir refuses)
out="$(ROOT="$FAKEROOT" run_block isolated x 'make_tmpdir; track_tmp "$TMP/article-outbox-worker.json"; echo t > "$TMP/article-outbox-worker.json"; echo keep > "$TMP/decoy.txt"; cleanup_tmp; [ -f "$TMP/decoy.txt" ] && echo DECOY_KEPT; [ -f "$TMP/article-outbox-worker.json" ] || echo TRACKED_GONE; echo "DIR=$TMP"')"
echo "$out" | grep -q DECOY_KEPT && echo "$out" | grep -q TRACKED_GONE && res ok "untracked decoy survives, tracked file deleted, non-empty directory not removed" || res bad "decoy test: $out"
d="$(echo "$out" | sed -n 's/^DIR=//p')"; [ -n "$d" ] && [ -f "$d/decoy.txt" ] && { rm -f -- "$d/decoy.txt"; rmdir -- "$d"; }
# 3. tracking an unexpected name is refused
out="$(ROOT="$FAKEROOT" run_block isolated x 'make_tmpdir; track_tmp "$TMP/article.aws.env"')"
echo "$out" | grep -q "DIE: refusing to track unexpected" && res ok "tracking a non-allow-listed name (article.aws.env) is refused" || res bad "unexpected name: $out"
# 4. tracking a path outside the temp dir is refused
out="$(ROOT="$FAKEROOT" run_block isolated x 'make_tmpdir; track_tmp "'"$FAKEROOT"'/infra/iam/article-outbox-worker.json"')"
echo "$out" | grep -q "DIE: temporary file outside" && res ok "tracking a same-named file outside the temp dir is refused" || res bad "outside path: $out"
# 5. remote mode: directory confined to infra/floci/.generated; GEN pointing elsewhere refused
out="$(ROOT="$FAKEROOT" run_block remote infra/floci/.generated/remote 'make_tmpdir; echo "TMP=$TMP"')"
echo "$out" | grep -q "infra/floci/.generated/remote/ecs-deploy-tmp" && echo "$out" | grep -q "EXIT=0" && res ok "remote: dedicated directory inside the git-ignored .generated tree accepted" || res bad "remote ok: $out"
out="$(ROOT="$FAKEROOT" run_block remote infra/iam 'make_tmpdir')"
echo "$out" | grep -q "DIE: remote temporary directory must be inside infra/floci/.generated" && res ok "remote: GEN=infra/iam refused (policies cannot become the temp dir)" || res bad "remote confine: $out"
[ -d "$FAKEROOT/infra/iam/ecs-deploy-tmp" ] && rmdir -- "$FAKEROOT/infra/iam/ecs-deploy-tmp"
out="$(ROOT="$FAKEROOT" run_block remote . 'make_tmpdir')"
echo "$out" | grep -q "DIE:" && res ok "remote: GEN=. (repository root) refused" || res bad "remote root: $out"
[ -d "$FAKEROOT/ecs-deploy-tmp" ] && rmdir -- "$FAKEROOT/ecs-deploy-tmp"
# 6. symlinked temp dir refused
mkdir -p "$SANDBOX/target"
# Probe real symlink support first (Git Bash may silently COPY instead of linking).
ln -s "$SANDBOX/target" "$SANDBOX/probe-link" 2>/dev/null
if [ -L "$SANDBOX/probe-link" ]; then rm -f -- "$SANDBOX/probe-link"; SYMLINKS=yes; else [ -d "$SANDBOX/probe-link" ] && rmdir -- "$SANDBOX/probe-link"; SYMLINKS=no; fi
[ "$SYMLINKS" = yes ] && ln -s "$SANDBOX/target" "$FAKEROOT/infra/floci/.generated/remote/ecs-deploy-tmp"
if [ "$SYMLINKS" = yes ] && [ -L "$FAKEROOT/infra/floci/.generated/remote/ecs-deploy-tmp" ]; then
  out="$(ROOT="$FAKEROOT" run_block remote infra/floci/.generated/remote 'make_tmpdir')"
  echo "$out" | grep -q "DIE: temporary directory missing or a symlink" && res ok "symlinked temp directory refused" || res bad "symlink: $out"
  rm -f -- "$FAKEROOT/infra/floci/.generated/remote/ecs-deploy-tmp"
else echo "SKIP | symlink test (symlinks not supported by this shell/filesystem)"; fi
# 7. cleanup with an empty TMP is a no-op
out="$(ROOT="$FAKEROOT" run_block isolated x 'TMP=""; cleanup_tmp; echo NOOP')"
echo "$out" | grep -q NOOP && res ok "cleanup with empty TMP does nothing" || res bad "empty tmp: $out"
# 8. protected files untouched
[ -f "$FAKEROOT/infra/iam/keep-policy.json" ] && [ -f "$FAKEROOT/infra/floci/.generated/remote/article.aws.env" ] && [ -f "$FAKEROOT/evidence/keep.txt" ] \
  && res ok "policy, credential and evidence decoys all still present" || res bad "protected decoys missing"
# 9. the script contains no recursive or wildcard deletion
if grep -nE 'rm[[:space:]]+(-[a-zA-Z]*[rR]|.*\*)' "$SCRIPT"; then res bad "recursive/wildcard rm found"; else res ok "no recursive or wildcard rm in deploy-ecs-workers.sh"; fi

# tidy the sandbox explicitly (known files and directories only)
rm -f -- "$FAKEROOT/infra/iam/keep-policy.json" "$FAKEROOT/infra/floci/.generated/remote/article.aws.env" "$FAKEROOT/evidence/keep.txt"
rmdir -- "$FAKEROOT/infra/floci/.generated/remote" "$FAKEROOT/infra/floci/.generated" "$FAKEROOT/infra/floci" "$FAKEROOT/infra/iam" "$FAKEROOT/infra" "$FAKEROOT/evidence" "$FAKEROOT" "$SANDBOX/target" "$SANDBOX" 2>/dev/null
echo "Total: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
