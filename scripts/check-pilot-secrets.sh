#!/usr/bin/env bash
# FirstLight — pilot startup secret gate.
#
# The pilot profile must FAIL TO START when secrets are missing, weak, or
# known defaults. Weak/default credentials on internal services were a
# rereview finding: this gate makes the failure loud at boot, not silent.
set -euo pipefail

fail() { echo "SECRETS GATE: $1" >&2; exit 1; }
weak() {
  local name="$1" value="$2" min="${3:-12}"
  local -a known_defaults=(
    "firstlight_pass" "minioadmin" "admin" "password" "changeme" "secret"
    "firstlight" "firstlight123" "postgres" "guest"
  )
  [ -n "$value" ] || fail "$name is empty — set it in .env before starting the pilot."
  [ "${#value}" -ge "$min" ] || fail "$name shorter than $min characters."
  for d in "${known_defaults[@]}"; do
    [ "$value" != "$d" ] || fail "$name is a known default value ('$d')."
  done
}

# Only gate what the pilot profile actually consumes.
if [ "${1:-}" = "--all" ]; then
  weak POSTGRES_PASSWORD "${POSTGRES_PASSWORD:-}"
  weak MINIO_ROOT_USER "${MINIO_ROOT_USER:-}" 4
  weak MINIO_ROOT_PASSWORD "${MINIO_ROOT_PASSWORD:-}"
  weak GRAFANA_ADMIN_PASSWORD "${GRAFANA_ADMIN_PASSWORD:-}"
fi
weak APP_ADMIN_TOKEN "${APP_ADMIN_TOKEN:-}" 16

echo "SECRETS GATE: ok (required secrets present, non-default, sufficient length)."
