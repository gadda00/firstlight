#!/usr/bin/env bash
# FirstLight — verification gate runner.
#
# Runs every quality gate from a clean state and EMITS
# docs/verification-summary.json (commit SHA, timestamps, commands, pass/
# fail counts). Acceptance tables must be regenerated from this artifact —
# never hand-edited green after code changes (that exact drift is what the
# round3 rereview caught).
#
# Usage: bun run verify:full   (or: bash scripts/verify.sh)
set -uo pipefail
cd "$(dirname "$0")/.."

SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
STAMP_START="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
declare -a RESULTS=()
FAILED=0

record() { # name, command, ok, detail
  RESULTS+=("$(printf '%s\t%s\t%s\t%s' "$1" "$2" "$3" "$4")")
}

run_gate() {
  local name="$1"; shift
  local detail
  echo "── gate: $name ──────────────────────────────────"
  if detail="$( "$@" 2>&1 | tail -40 )"; then
    echo "  PASS"
    record "$name" "$*" pass "$(echo "$detail" | tail -1 | head -c 200)"
  else
    echo "  FAIL"
    FAILED=1
    record "$name" "$*" fail "$(echo "$detail" | tail -1 | head -c 200)"
  fi
}

# Clean state (mirrors the rereview's required command list).
rm -rf node_modules .next out db tests/fixtures/*.db 2>/dev/null

run_gate "install" bun install --frozen-lockfile
run_gate "lint" bun run lint
run_gate "typecheck" bun run typecheck
run_gate "test" bun test
run_gate "build" bun run build
run_gate "build:static" bun run build:static
run_gate "python-worker-tests" bash -c "cd python && python3 -m unittest test_secure_download"

STAMP_END="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Test counts (parsed from the last bun test run; empty if it failed).
TEST_COUNTS="$(bun test 2>&1 | grep -E '^ *[0-9]+ (pass|fail)' | tr '\n' ' ' | sed 's/  */ /g')"

{
  printf '{\n'
  printf '  "commit": "%s",\n' "$SHA"
  printf '  "startedAt": "%s",\n' "$STAMP_START"
  printf '  "finishedAt": "%s",\n' "$STAMP_END"
  printf '  "runner": "scripts/verify.sh",\n'
  printf '  "testCounts": "%s",\n' "$TEST_COUNTS"
  printf '  "gates": [\n'
  first=1
  for r in "${RESULTS[@]}"; do
    IFS=$'\t' read -r name cmd status detail <<< "$r"
    [ $first -eq 1 ] || printf ',\n'
    first=0
    printf '    { "name": "%s", "command": "%s", "status": "%s", "detail": "%s" }' \
      "$name" "$(echo "$cmd" | sed 's/"/\\"/g')" "$status" "$(echo "$detail" | sed 's/"/\\"/g')"
  done
  printf '\n  ],\n'
  printf '  "overall": "%s"\n' "$([ $FAILED -eq 0 ] && echo pass || echo fail)"
  printf '}\n'
} > docs/verification-summary.json

echo ""
echo "verification: $([ $FAILED -eq 0 ] && echo PASS || echo FAIL) — wrote docs/verification-summary.json"
cat docs/verification-summary.json
exit $FAILED
