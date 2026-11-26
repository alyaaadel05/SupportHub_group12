#!/usr/bin/env bash
set -u

SOURCE="$PWD/infra/floci/remote/cutover.sh"
SANDBOX="$(mktemp -d)" || exit 2
TARGET="$SANDBOX/infra/floci/remote/cutover.sh"

mkdir -p "$(dirname "$TARGET")" || exit 2

cat > "$SANDBOX/mocks.sh" <<'MOCKS'

docker() {
  case "$1" in
    inspect) echo true ;;
    image) [ "$SCENARIO" != image_missing ] ;;
    ps)
      [ "$SCENARIO" = not_ready ] && return 0
      printf 'floci-aws-ecs-a-article-outbox-worker\nfloci-aws-ecs-b-editorial-article-consumer\nfloci-aws-ecs-c-editorial-publication-worker\n'
      ;;
    logs)
      case "$2" in
        *article-outbox-worker) echo "Article SQS outbox scheduler started" ;;
        *editorial-article-consumer) echo "Editorial Article Event Consumer started" ;;
        *editorial-publication-worker) echo "Editorial publication event publisher started" ;;
      esac
      ;;
    start)
      echo START >> "$MOCK_LOG"
      [ "$SCENARIO" != restart_fail ] && [ "$SCENARIO" != drain_restart_fail ]
      ;;
    stop)
      case "$2" in
        *article-outbox-worker)
          echo STOP_ARTICLE >> "$MOCK_LOG"
          [ "$SCENARIO" != article_stop_fail ]
          ;;
        *editorial-article-worker)
          echo STOP_EDITORIAL >> "$MOCK_LOG"
          [ "$SCENARIO" != editorial_stop_fail ]
          ;;
        *) return 99 ;;
      esac
      ;;
    *) return 99 ;;
  esac
}

sleep() { :; }

timeout() {
  shift
  case "$1" in
    aws)
      case "$*" in
        *get-queue-attributes*)
          if [ "$SCENARIO" = delayed_messages ] ||
   [ "$SCENARIO" = drain_restart_fail ]; then
    printf '0\t0\t1\n'
else
    printf '0\t0\t0\n'
fi
          ;;
        *describe-services*runningCount,pendingCount*--output\ text*)
          # post-activation readiness query
          # Windows AWS CLI emits CRLF line endings: the mock does too (regression found in the real cutover).
          if [ "$SCENARIO" = not_ready ]; then printf '0\t1\r\n0\t1\r\n0\t1\r\n'; else printf '1\t0\r\n1\t0\r\n1\t0\r\n'; fi
          ;;
        *describe-services*)
          if [ "$SCENARIO" = active_ecs ] || [ "$SCENARIO" = precheck_active_ecs ]; then
            echo '[[1,1,0],[0,0,0],[0,0,0]]'
          else
            echo '[[0,0,0],[0,0,0],[0,0,0]]'
          fi
          ;;
        *list-tasks*)
          echo '[]'
          ;;
        *) return 99 ;;
      esac
      ;;
    bash)
      case "$*" in
        *"--scale 0"*)
          echo SCALE_ZERO >> "$MOCK_LOG"
          [ "$SCENARIO" != scale_down_fail ]
          ;;
        *"--scale 1"*)
          echo SCALE_ONE >> "$MOCK_LOG"
          [ "$SCENARIO" != scale_up_fail ]
          ;;
        *start-supporthub.sh*)
          echo VERIFY >> "$MOCK_LOG"
          [ "$SCENARIO" != verify_fail ]
          ;;
        *"--status"*) echo MOCK_STATUS ;;
        *) return 99 ;;
      esac
      ;;
    node) echo MOCK_DATABASE_STATUS ;;
    *) return 99 ;;
  esac
}

MOCKS

grep -qx 'set -uo pipefail' "$SOURCE" || exit 2

awk -v mocks="$SANDBOX/mocks.sh" '
{
  print
  if ($0 == "set -uo pipefail") {
    while ((getline line < mocks) > 0) print line
    close(mocks)
  }
}' "$SOURCE" > "$TARGET" || exit 2

bash -n "$TARGET" || exit 2

PASS=0
FAIL=0

run_case() {
  local name="$1" mode="$2" expected="$3"
  local required="$4" forbidden="$5"
  local rc=0

  export SCENARIO="$name"
  export MOCK_LOG="$SANDBOX/$name.log"
  export REMOTE=local
  unset BASH_ENV

  : > "$MOCK_LOG"

  bash "$TARGET" "$mode" \
    > "$SANDBOX/$name.out" 2>&1 || rc=$?

  if [ "$rc" -eq "$expected" ] &&
     grep -Eq "$required" "$MOCK_LOG" &&
     ! grep -Eq "$forbidden" "$MOCK_LOG"; then

    echo "PASS | $name | exit=$rc"
    PASS=$((PASS+1))

  else

    echo "FAIL | $name | exit=$rc"
    cat "$MOCK_LOG"
    cat "$SANDBOX/$name.out"
    FAIL=$((FAIL+1))

  fi
}

run_case rollback_ok --rollback \
  0 '^START$' '^SCALE_ONE$'

run_case scale_down_fail --rollback \
  1 '^SCALE_ZERO$' '^START$'

run_case active_ecs --rollback \
  1 '^SCALE_ZERO$' '^START$'

run_case restart_fail --rollback \
  1 '^START$' '^SCALE_ONE$'

run_case article_stop_fail --i-approve-production-cutover \
  1 '^STOP_ARTICLE$' '^(SCALE_ONE|STOP_EDITORIAL)$'

run_case editorial_stop_fail --i-approve-production-cutover \
  1 '^STOP_EDITORIAL$' '^SCALE_ONE$'

run_case scale_up_fail --i-approve-production-cutover \
  1 '^SCALE_ONE$' '^START$'

run_case verify_fail --i-approve-production-cutover \
  1 '^VERIFY$' '^(STOP_ARTICLE|STOP_EDITORIAL|SCALE_ONE)$'

echo

run_case delayed_messages --i-approve-production-cutover \
  1 '^START$' '^(STOP_EDITORIAL|SCALE_ONE)$'

run_case drain_restart_fail --i-approve-production-cutover \
  1 '^START$' '^(STOP_EDITORIAL|SCALE_ONE)$'

# New pre-check and readiness guards
run_case cutover_ok --i-approve-production-cutover \
  0 '^SCALE_ONE$' '^START$'

run_case precheck_active_ecs --i-approve-production-cutover \
  3 '^VERIFY$' '^(STOP_ARTICLE|STOP_EDITORIAL|SCALE_ONE)$'

run_case image_missing --i-approve-production-cutover \
  3 '^VERIFY$' '^(STOP_ARTICLE|STOP_EDITORIAL|SCALE_ONE)$'

run_case not_ready --i-approve-production-cutover \
  1 '^SCALE_ONE$' '^START$'

echo "Total: $PASS passed, $FAIL failed"
echo "Temporary test files: $SANDBOX"
echo "Production operations were mocked."

[ "$FAIL" -eq 0 ]