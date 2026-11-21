#!/usr/bin/env bash
# Vote abuse / concurrency tests against the LOCAL stack:
#   Identity (Alyaa's image) on 127.0.0.1:3006, Search & Analytics on 127.0.0.1:3004.
# Logs in as the editor test account (password typed hidden, never stored).
# Local Search uses REQUIRE_TURNSTILE_FOR_VOTES=false because the local frontend has no
# Turnstile site key; Turnstile itself is tested separately (SECURITY.md S19).
ID=http://127.0.0.1:3006/api
SEARCH=http://127.0.0.1:3004/api
ORIGIN=http://127.0.0.1:8080
JAR=$(mktemp)
token() { curl -s -c "$JAR" -b "$JAR" "$ID/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/'; }

CSRF=$(token)
read -s -p "Editor password: " PW; echo
curl -s -o /dev/null -c "$JAR" -b "$JAR" -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"supporthub.nermeen.editor@example.com\",\"password\":\"$PW\"}" "$ID/auth/login"
unset PW
CSRF=$(token)

vote() {  # $1 = article id, $2 = JSON body
  local code body
  code=$(curl -s -o /tmp/vote-body.txt -w "%{http_code}" -b "$JAR" -H "Origin: $ORIGIN" \
    -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" -d "$2" "$SEARCH/articles/$1/votes")
  body=$(head -c 100 /tmp/vote-body.txt)
  echo "$code  $body"
}

echo "Vote abuse tests — $(date -u +%Y-%m-%dT%H:%M:%SZ) (local, editor account)"
echo "1. Invalid vote value \"yes\"        -> $(vote 1 '{"helpful":"yes"}')"
echo "2. Invalid article id \"abc\"        -> $(vote abc '{"helpful":true}')"
echo "3. Unpublished (draft) article 2    -> $(vote 2 '{"helpful":true}')"
echo "4. Article that does not exist      -> $(vote 999999 '{"helpful":true}')"
echo "5. Try to vote as user 1            -> $(vote 1 '{"helpful":true,"user_id":1,"userId":1}')"
echo "6. 20 simultaneous votes on article 1 (alternating helpful/unhelpful)..."
for i in $(seq 1 20); do
  if [ $((i % 2)) -eq 0 ]; then v=true; else v=false; fi
  curl -s -o /dev/null -w "%{http_code} " -b "$JAR" -H "Origin: $ORIGIN" -H "X-CSRF-Token: $CSRF" \
    -H "Content-Type: application/json" -d "{\"helpful\":$v}" "$SEARCH/articles/1/votes" &
done
wait; echo
rm -f "$JAR" /tmp/vote-body.txt