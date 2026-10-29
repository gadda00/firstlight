#!/usr/bin/env bash
# FirstLight — static demo build.
#
# `output: export` cannot include a dynamic server API (Next.js refuses
# export const dynamic = "force-dynamic" in export mode — and that is
# CORRECT: the demo build must never ship an accidental server surface).
# This script stashes src/app/api during the static build and restores it
# afterwards (trap-protected, safe on CI interruption).
set -euo pipefail

API_DIR="src/app/api"
STASH=".api-stash"

restore() {
  if [ -d "$STASH" ]; then
    rm -rf "$API_DIR"
    mkdir -p "$(dirname "$API_DIR")"
    mv "$STASH" "$API_DIR"
    echo "restored $API_DIR"
  fi
}
trap restore EXIT

if [ -d "$API_DIR" ]; then
  rm -rf "$STASH"
  mv "$API_DIR" "$STASH"
  echo "stashed $API_DIR (server API excluded from static demo build)"
fi

# NOTE: no `exec` here — it would replace the shell and the EXIT trap
# (restore) would never fire.
BUILD_MODE=static next build "$@"
