#!/usr/bin/env bash
# FirstLight — pilot PostgreSQL backup + restore drill.
#
# Backup:    ./scripts/backup-postgres.sh                  # -> backups/firstlight-<ts>.sql.gz
# Verify:    ./scripts/backup-postgres.sh --verify <file>  # restore into a scratch DB and row-count every table
#
# The rereview requires backups AND restore verification — an untested
# backup is not a backup. --verify spins a throwaway postgres container,
# restores the dump into it, and asserts every table restored with the
# expected row counts from the live DB.
set -euo pipefail
cd "$(dirname "$0")/.."

SERVICE="${POSTGRES_SERVICE:-postgres}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DIR="backups"
FILE="${2:-$DIR/firstlight-$STAMP.sql.gz}"

mkdir -p "$DIR"

if [ "${1:-}" = "--verify" ]; then
  [ -f "$FILE" ] || { echo "verify: dump file '$FILE' not found" >&2; exit 1; }
  SCRATCH="firstlight_restore_drill_$STAMP"
  echo "restore drill: container $SCRATCH"
  docker run -d --rm --name "$SCRATCH" \
    -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=drill \
    postgis/postgis:16-3.4 >/dev/null
  trap 'docker rm -f "$SCRATCH" >/dev/null 2>&1 || true' EXIT
  until docker exec "$SCRATCH" pg_isready -U postgres -d drill >/dev/null 2>&1; do sleep 1; done
  docker exec -i "$SCRATCH" psql -U postgres -d drill -v ON_ERROR_STOP=1 \
    < <(gunzip -c "$FILE") >/dev/null
  echo "restore drill: dump restored cleanly into scratch database"
  LIVE_TABLES="$(
    docker compose exec -T "$SERVICE" psql -U firstlight -d firstlight -At \
      -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
  )"
  FAILED=0
  while read -r t; do
    [ -n "$t" ] || continue
    LIVE="$(docker compose exec -T "$SERVICE" psql -U firstlight -d firstlight -At -c "SELECT count(*) FROM \"$t\"")"
    COPY="$(docker exec "$SCRATCH" psql -U postgres -d drill -At -c "SELECT count(*) FROM \"$t\"" 2>/dev/null || echo MISSING)"
    if [ "$LIVE" != "$COPY" ]; then
      echo "  ✗ $t: live=$LIVE restored=$COPY" >&2
      FAILED=1
    else
      echo "  ✓ $t: $LIVE rows"
    fi
  done <<< "$LIVE_TABLES"
  [ "$FAILED" -eq 0 ] && echo "restore drill PASSED" || { echo "restore drill FAILED" >&2; exit 1; }
  exit 0
fi

echo "backup: $SERVICE -> $FILE"
docker compose exec -T "$SERVICE" pg_dump -U firstlight -d firstlight | gzip > "$FILE"
gunzip -t "$FILE"
echo "backup: written and gzip-verified ($FILE)"
echo "next: run ./scripts/backup-postgres.sh --verify $FILE"
