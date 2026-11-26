#!/usr/bin/env bash
# =====================================================================
# SupportHub Group 12 - build the remote host's production.env on THIS laptop
# from the existing private files (never from the repository):
#   %LOCALAPPDATA%\SupportHub\database-security\article.database.env    -> ARTICLE_DATABASE_URL
#   %LOCALAPPDATA%\SupportHub\database-security\editorial.database.env  -> EDITORIAL_DATABASE_URL
#   %LOCALAPPDATA%\SupportHub\production-workers\editorial.restricted.env -> SERVICE_SHARED_SECRET
# Output (outside the repository, owner-only):
#   %LOCALAPPDATA%\SupportHub\remote\production.env
# Validates role names, the shared production endpoint and TLS options.
# Prints only variable names and checks - never a value.
#   bash infra/floci/remote/prepare-production-env.sh
# =====================================================================
set -euo pipefail
BASE="${LOCALAPPDATA:-$HOME/.local/share}/SupportHub"
OUTDIR="$BASE/remote"; OUT="$OUTDIR/production.env"
mkdir -p -- "$OUTDIR"; chmod 700 -- "$OUTDIR" 2>/dev/null || true
umask 077
node - "$BASE" "$OUT" <<'EOF'
const fs = require("fs"), path = require("path");
const [base, out] = process.argv.slice(2);
const read = (f, k) => { const t = fs.readFileSync(path.join(base, f), "utf8"); const m = t.match(new RegExp("^" + k + "=(.+)$", "m")); if (!m) throw new Error(`${k} missing in ${f}`); return m[1].trim().replace(/^["']|["']$/g, ""); };
const art = read("database-security/article.database.env", "DATABASE_URL_POOLED");
const ed = read("database-security/editorial.database.env", "DATABASE_URL_POOLED");
const hmac = read("production-workers/editorial.restricted.env", "SERVICE_SHARED_SECRET");
const a = new URL(art), e = new URL(ed);
const checks = [
  ["article URL uses role supporthub_article_app", decodeURIComponent(a.username) === "supporthub_article_app"],
  ["editorial URL uses role supporthub_editorial_app", decodeURIComponent(e.username) === "supporthub_editorial_app"],
  ["both URLs use the same production pooled endpoint", a.hostname === e.hostname && a.hostname.includes("-pooler")],
  ["both URLs require verify-full TLS + channel binding", [a, e].every(u => u.searchParams.get("sslmode") === "verify-full" && u.searchParams.get("channel_binding") === "require")],
  ["no owner role", ![a, e].some(u => /owner/i.test(u.username))],
  ["HMAC secret length >= 32", hmac.length >= 32]
];
let bad = 0;
for (const [n, ok] of checks) { console.log(`  [${ok ? "PASS" : "FAIL"}] ${n}`); if (!ok) bad++; }
if (bad) { console.error("refusing to write production.env"); process.exit(1); }
fs.writeFileSync(out, `ARTICLE_DATABASE_URL=${art}\nEDITORIAL_DATABASE_URL=${ed}\nSERVICE_SHARED_SECRET=${hmac}\n`, { mode: 0o600 });
console.log(`  written: ${out} (variables: ARTICLE_DATABASE_URL, EDITORIAL_DATABASE_URL, SERVICE_SHARED_SECRET; values not shown)`);
EOF
