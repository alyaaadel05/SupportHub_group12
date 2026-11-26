#!/usr/bin/env bash
# =====================================================================
# SupportHub Group 12 - build the code bundle for the remote Floci host (laptop).
# Contains ONLY files git tracks or would track (git ls-files -co --exclude-standard)
# under infra/, services/ and tests/integration/ - so .env files, infra/floci/.generated,
# node_modules and other ignored files are never included. Secrets travel separately
# (production.env via scp, Cloudflare token typed on the VM).
# Output (outside the repository): %LOCALAPPDATA%\SupportHub\remote\supporthub-remote.tar.gz
#   bash infra/floci/remote/package-for-remote.sh
# =====================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"; cd "$ROOT"
OUTDIR="${LOCALAPPDATA:-$HOME/.local/share}/SupportHub/remote"
# GNU tar would read "C:\..." as host:path; use the POSIX form on Git Bash.
command -v cygpath >/dev/null 2>&1 && OUTDIR="$(cygpath -u "$OUTDIR")"
OUT="$OUTDIR/supporthub-remote.tar.gz"
mkdir -p -- "$OUTDIR"
LIST="$(git ls-files -co --exclude-standard -- infra services tests/integration .gitignore)"
# Defence in depth: refuse if anything secret-looking slipped into the list.
BAD="$(echo "$LIST" | grep -E '(^|/)\.env($|\.)|\.generated/|aws\.env$|\.password$|\.secret$|\.pem$|\.key$|node_modules/' | grep -vE '\.env\.example$' || true)"
[ -z "$BAD" ] || { echo "refusing: secret-looking files in the bundle:"; echo "$BAD"; exit 3; }
echo "$LIST" | tar -czf "$OUT" -T -
echo "bundle: $OUT ($(echo "$LIST" | wc -l) files, $(du -h "$OUT" | cut -f1))"
tar -tzf "$OUT" | grep -E '(^|/)\.env($|\.)|\.generated/|aws\.env$|\.password$|node_modules/' | grep -vE '\.env\.example$' && { echo "FAIL: forbidden path inside archive"; exit 3; } || echo "archive check: no .env, .generated, key, password or node_modules paths"
