# OPERATIONS_RUNBOOK.md — FirstLight

## Daily operation

### Health checks
- `GET /api/health` — never throws: returns `ok` or `degraded` + per-component status (`database`) + `dbDiagnostics` (resolved URL hint) when degraded. Wire uptime monitoring to this endpoint; alert on `status != "ok"`.
- `GET /api/meta` — also reports run mode, auth requirement, and every adapter's `health` (`live` / `fixtures-only` / `blocked`). Alert if a previously-`live` adapter flips to `blocked` (e.g. env var lost).

### Routine verification
- `POST /api/audit/verify` (approver+) — walks the full audit chain and re-computes every hash. Run daily; any `ok: false` means tampering or DB corruption — page the on-call.
- Review backlog: `GET /api/events/{id}` → `counts.reviewOpen`; SLA target in `PILOT_ACCEPTANCE.md`.

## Deployment

### Demo (static — GitHub Pages)
Automatic on push to `main` (`.github/workflows/deploy-pages.yml`). The static build **excludes the server API** by design (`scripts/build-static.sh` stashes `src/app/api` during build — a static artifact never ships an accidental server surface).

### Operational (server)
```bash
bun install --frozen-lockfile
cp .env.example .env            # DATABASE_URL must be ABSOLUTE for SQLite
bunx prisma db push
bun run db:seed                 # first deploy only; prints pilot tokens — ROTATE
DEMO_MODE=false NEXT_PUBLIC_DEMO_MODE=false bun run build
DEMO_MODE=false DATABASE_URL=… bun run start
python3 scripts/browser-smoke.py   # 52-check acceptance gate before going live
```
Environment requirements: `DEMO_MODE=false`, absolute `DATABASE_URL`, optional provider keys (`FIRSTLIGHT_FIRMS_TOKEN`, `FIRSTLIGHT_COPERNICUS_*`).

### Rollback
Deployments are git-driven: revert the commit and redeploy. Database schema changes are additive (`prisma db push` on a copy first). Approved sitreps are frozen artifacts — a rollback never mutates them; new data produces new draft versions.

## Provider outage procedures

| Symptom | Diagnosis | Action |
|---|---|---|
| Ingestion returns 502 `upstream_error` | provider down / malformed | Run auto-retries (built-in, 2 with backoff). Failed runs are **re-attemptable** — re-run the same ingestion later; only SUCCEEDED runs are replayed |
| 429 `rate_limited` from provider | quota hit | Backoff honors `Retry-After`; space ingestions; consider caching (idempotency already prevents duplicate calls) |
| Adapter reports `blocked_dependency` (503) | missing env var (e.g. `FIRSTLIGHT_FIRMS_TOKEN`) | Set the variable; the adapter goes live with zero code changes |
| NWS 400 on alerts | (historical) invalid query param | Fixed in adapter (no `limit` param); if it recurs, check `DATA_SOURCES.md` notes |
| Catalog shows `failed` records | adapter validation rejected them | Inspect `stageLogs` on the ingestion run (`GET /api/events/{id}/catalog` → `ingestionRuns`); do NOT promote failed records |

**Never** work around an outage by fabricating provider data. A missing source is visible as missing.

## Stale data

- Every catalog record carries `ageHours`; sitreps cite `source_freshness` (oldest source age).
- Offline bundles warn on import when older than 24 h; hard-fail when expired or revoked.
- If a source exceeds its acceptable staleness (see `DATA_SOURCES.md` refresh cadence), regenerate the sitrep draft — do not distribute the stale one.

## Queue / ingestion recovery

Ingestion runs are rows, not an external queue (pilot). Recovery = re-run the ingestion (failed runs retry; succeeded runs replay idempotently). The `IngestionAttempt` log preserves the full failure history for forensics.

## Restore drill (quarterly, timed)

1. Snapshot `db/firstlight.db` (and `db/*.db` backups).
2. Restore into a fresh checkout: `bunx prisma db push` → copy DB file → `bun run start`.
3. Verify: `POST /api/audit/verify` → `ok: true` with the same event count; `GET /api/events/{id}` returns the event with counts; an approved sitrep still serves its frozen markdown byte-identically (compare `claimsHash`); export checksums still match recorded `sha256`.
4. Record drill duration and gaps in the ops log. Target: complete under 30 minutes.

## Security incidents

See `SECURITY.md` §9: revoke sessions → freeze distribution (bundle revocation, sitrep supersession) → `POST /api/audit/verify` → contain egress (unset provider tokens — adapters fail closed).

## Known operational limits (honest)

- Single-node in-memory rate limiter (Redis seam documented).
- No external job queue: heavy ingestion runs inline with the request.
- Browser smoke requires the server and test in the same shell session (sandbox kills detached servers — same behavior in CI steps).
