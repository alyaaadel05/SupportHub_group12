#!/usr/bin/env bash
# Synthetic article end-to-end test (Neon development, local Search on 3004, local Identity on 3006).
# Usage: bash scripts/test-synthetic-article.sh <before|published|unpublished> <articleId> <keyword> [categoryId]
PHASE=$1; ID=$2; WORD=$3; CAT=$4
SEARCH=http://127.0.0.1:3004/api
IDENT=http://127.0.0.1:3006/api
ORIGIN=http://127.0.0.1:8080
OUT=evidence/synthetic-article-test.txt
[ -z "$WORD" ] && { echo "Usage: $0 <before|published|unpublished> <articleId> <keyword> [categoryId]"; exit 1; }

found() { curl -s "$SEARCH/public/articles?$1" | grep -q "\"article_id\":\"$ID\"" && echo "FOUND" || echo "not found"; }
code()  { curl -s -o /dev/null -w "%{http_code}" "$1"; }
sql()   { node -e "require('dotenv').config();require('./db/pool').query(\`$1\`,[$ID]).then(r=>{console.log(JSON.stringify(r.rows));process.exit(0)})" 2>/dev/null; }
login() {
  JAR=$(mktemp)
  local t; t=$(curl -s -c "$JAR" -b "$JAR" "$IDENT/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
  read -s -p "Editor password (for the vote test): " PW; echo >&2
  curl -s -o /dev/null -c "$JAR" -b "$JAR" -H "Origin: $ORIGIN" -H "X-CSRF-Token: $t" -H "Content-Type: application/json" \
    -d "{\"email\":\"supporthub.nermeen.editor@example.com\",\"password\":\"$PW\"}" "$IDENT/auth/login"; unset PW
  CSRF=$(curl -s -c "$JAR" -b "$JAR" "$IDENT/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
}
vote() { curl -s -w "  (HTTP %{http_code})" -b "$JAR" -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF" \
  -H "Content-Type: application/json" -d "{\"helpful\":$1}" "$SEARCH/articles/$ID/votes"; }

[ "$PHASE" = "published" ] || [ "$PHASE" = "unpublished" ] && login
{
  echo; echo "=== Phase: $PHASE — article $ID, keyword \"$WORD\" — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  echo "Keyword search ?q=$WORD        -> $(found "q=$WORD")"
  [ -n "$CAT" ] && echo "Category search ?category=$CAT   -> $(found "category=$CAT")"
  echo "Search index row               -> $(sql 'SELECT article_id,title,updated_at FROM search_published_articles WHERE article_id=$1')"
  if [ "$PHASE" = "published" ]; then
    B=$(sql 'SELECT COUNT(*)::int AS n FROM article_views WHERE article_id=$1')
    echo "Open article                   -> HTTP $(code "$SEARCH/public/articles/$ID")"
    echo "Views before / after open      -> $B / $(sql 'SELECT COUNT(*)::int AS n FROM article_views WHERE article_id=$1')"
    echo "Vote helpful                   -> $(vote true)"
    echo "Change vote to unhelpful       -> $(vote false)"
    echo "Vote rows for this article     -> $(sql 'SELECT user_id,helpful FROM helpfulness_votes WHERE article_id=$1')"
    echo "Analytics (most viewed + votes)-> $(node -e "require('dotenv').config();require('./services/analyticsService').overview().then(o=>{const a=o.mostViewedArticles.find(x=>String(x.article_id)==='$ID');console.log(JSON.stringify(a||'not in top 10'),'| totalVotes',o.totalVotes);process.exit(0)})" 2>/dev/null)"
  else
    echo "Open article                   -> HTTP $(code "$SEARCH/public/articles/$ID")"
  fi
  [ "$PHASE" = "unpublished" ] && echo "New vote after unpublishing    -> $(vote true)"
} | tee -a "$OUT"
[ -n "$JAR" ] && rm -f "$JAR"