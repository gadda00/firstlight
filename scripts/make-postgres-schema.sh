#!/usr/bin/env bash
# FirstLight — regenerate prisma/schema.postgres.prisma from the canonical
# prisma/schema.prisma. The ONLY permitted difference is the datasource
# provider (postgresql). Run this whenever schema.prisma changes, then
# regenerate the initial migration if the model set changed:
#
#   bunx prisma migrate diff --from-empty \
#     --to-schema-datamodel prisma/schema.postgres.prisma \
#     --script > prisma/migrations/0_init/migration.sql
#
# Dev/CI/tests keep using prisma/schema.prisma (SQLite + `db push`).
# The PILOT deployment builds with this schema and runs
# `prisma migrate deploy` — never `db push` in production.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 - <<'PY'
import pathlib, re, sys
src = pathlib.Path("prisma/schema.prisma").read_text()
pg = re.sub(r'provider\s*=\s*"sqlite"', 'provider = "postgresql"', src, count=1)
pg = pg.replace(
  "// PILOT STORE: SQLite via Prisma.",
  "// PILOT STORE (PostgreSQL variant): GENERATED from schema.prisma by\n"
  "// scripts/make-postgres-schema.sh — regenerate instead of hand-editing.")
pathlib.Path("prisma/schema.postgres.prisma").write_text(pg)

# Drift guard: everything except the provider line + header must match.
orig = re.sub(r'provider\s*=\s*"sqlite"', 'provider = "postgresql"', src, count=1)
if pg.replace(
    "// PILOT STORE (PostgreSQL variant): GENERATED from schema.prisma by\n"
    "// scripts/make-postgres-schema.sh — regenerate instead of hand-editing.",
    "// PILOT STORE: SQLite via Prisma.") != src:
    print("ERROR: unexpected drift between schema.prisma and generated variant", file=sys.stderr)
    sys.exit(1)
print("prisma/schema.postgres.prisma regenerated (provider=postgresql)")
PY
