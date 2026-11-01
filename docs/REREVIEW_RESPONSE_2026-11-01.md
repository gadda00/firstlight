# FirstLight — Rereview Response & Delivery Evidence

**Date:** 2026-11-01
**Responds to:** `FIRSTLIGHT_REREVIEW_2026-11-01.md` (baseline: `origin/main` @ `9a0c53f`)
**Branch:** `repair/rereview-baseline` (9 commits on top of `9a0c53f`)
**Scope:** the review's "Definition of done for the next AI coding agent" — implemented, tested, evidenced. Not recommendations: code, tests, and gates.

---

## 1. Baseline (before) → Result (after)

| Gate | Review's baseline finding | This delivery (verified twice from clean state) |
|---|---|---|
| `bun install --frozen-lockfile` | completed | **pass** (479 packages) |
| `bun run lint` | reported passing | **pass** — 0 errors, 1 pre-existing warning |
| `bun run typecheck` | **182 errors** | **pass — 0 errors** (strictness untouched: `ignoreBuildErrors: false`, no `any` casts to escape) |
| `bun test` | 141 pass / 14 fail + unloadable files | **186 pass / 0 fail** across 15 files |
| `bun run build` | **fails** (`httpClient` export missing) | **pass** (type-validated, API route dynamic) |
| `bun run build:static` | **fails** (TS validation) | **pass** (API route stashed/restored, trap-protected) |
| Browser smoke | — | **59/59 checks** (`scripts/browser-smoke.py`, real Chromium; live USGS ingestion, idempotent replay, full review→sitrep→approve→export→bundle→audit trail, demo static build, zero console errors) |
| Python worker | fabricated outputs | **24/24** egress-policy unit tests |
| CI | would fail at typecheck | all gates wired; workflows now actually parse (see §6) |

`docs/verification-summary.json` is **generated** by `bun run verify:full` (commit SHA, timestamps, per-gate results) — acceptance tables regenerate from it; they are never hand-edited.

---

## 2. What was done, by review item

### P0 — green baseline
- **httpClient contract (P0.1):** exported `httpClient(timeoutMs)` from `http-client.ts` — a timeout-bounded, signal-composing, `preconnect`-carrying drop-in for `fetch` matching every call site's actual shape. Seven adapters repaired to the shared contracts (`AcquiredAsset`, `AcquireDestination`, `ValidationReport`): module-level helper calls instead of implicit `this`, `sizeBytes: number` conventions, unknown-narrowing guards, honest AOI-center Point geometries (the old code passed the raw `{lat,lng,aoiKm}` object as geometry), `TwitterDataType` fix, `tweetGeoToGeometry` narrowing helper.
- **Registry coverage test:** `tests/registry.test.ts` imports every registered adapter (compile-time + load-time), asserts unique ids / contract invariants / blocked-dependency honesty. The round3 missing-export failure mode is now pinned.
- **Typecheck (P0.2):** `@types/geojson` pinned + loaded via tsconfig `types`; `kind` union extended with `'weather' | 'osint'`; map-layers rewritten with `BaseStyleId` literal union, discriminated fill factory, real `raster-saturation` paint prop, completed `LayerMetadata` (id/group/zIndex).
- **Tests/builds (P0.3):** removed the unwired `streaming/` (1,133 lines, undeclared `ws` dependency, broken test path, zero importers) and `fusion/` (1,297 lines, zero importers) — the review explicitly sanctions removal over advertising an incomplete feature. `planet.test.ts` rewritten in `bun:test` against current contracts. Test-runner drift eliminated (no vitest imports remain).
- Fixed real bugs found along the way: broken `EXPORT` typo + bogus celery flags in `python/entrypoint.sh`; corrupted branch triggers (`ain]`) and two unquoted-scalar YAML errors in the GitHub workflows — **the deploy workflow never parsed before**.

### P1 — ingestion correctness
- **Canonical idempotency (P1.A):** key = SHA-256 over canonical JSON of `{eventId, adapterId, params, aoi, timeWindow, country, contractVersion}` with recursive key sorting. Tests: changed AOI / radius / time window / country / nested params → different keys; reordered keys (any depth) → same key.
- **Concurrency + lifecycle (P1.B):** atomic create-or-reuse guarded by the unique key; live RUNNING runs answer `already_running` (never a duplicate provider call — proven by a concurrency test asserting exactly one `discover`); stale 10-minute leases are reclaimable; `MAX_ATTEMPTS=5` dead-runs cap provider-call volume. Attempts are created `ok: null` BEFORE provider IO and finalized exactly once (finally-path) with stage / httpStatus / retryable / latency / correlationId — a crash can no longer leave a false success. Catalog upserts run in ONE `$transaction` per run.
- **Handler-level stability:** `ingestWindowFor()` quantizes the derived window to the hour so retries replay (a raw `now` would have made every retry a new identity).

### P2 — truthful operational claims
Every served layer now carries a first-class **`provenance`** block: `analysisMode: 'synthetic-scenario'`, `simulated: true`, an honesty label, bounded `sourceAssetIds`, per-adapter catalog summary (real vs simulated counts, freshness), `processingVersion`, `crs`, `temporalWindow`, `qualityStatus`, and explicit caveats. The operational status bar renders a `⚠ SYNTHETIC ANALYSIS · catalog N real asset(s)` chip (full caveats on hover). README states it plainly: **real-data catalog + synthetic analysis demo** — a real hazard record can no longer silently become an unlabeled synthetic damage polygon. The full real processing pipeline remains honestly deferred (worker reports `blocked_scaffold`).

### P3 — worker and deployment
- **`python/secure_download.py`** (new, no celery dependency): HTTPS-only, provider allowlist (default deny-unknown), DNS-then-IP SSRF rejection (private/loopback/link-local/metadata), bounded redirects re-validated per hop, byte limits, content-type + SHA-256 checks, atomic `.part`→rename, credential-redacted logging. 24 unit tests.
- **`python/tasks.py`:** every raster/ML task returns `status: 'blocked_scaffold'` naming its exact missing dependency — no fabricated URLs, no `random.uniform` "quality" metrics, no simulated sleeps. `health_check` reports genuine telemetry + capability truth.
- **`docker-compose.yml`:** explicit `demo` / `pilot` / `monitoring` profiles. Pilot: ONE persistence model (app AND worker on PostgreSQL/PostGIS — the round3 SQLite/Postgres split-brain is gone), one-shot `prisma migrate deploy` service (never `db push` in production), required secrets via `:?` interpolation + `scripts/check-pilot-secrets.sh` weak-value gate, internal services unpublished (only nginx 80/443 is public), pinned image versions, mem/cpu limits, `scripts/backup-postgres.sh` with a `--verify` restore drill. `prisma/schema.postgres.prisma` + `0_init` migration generated and drift-guarded by `scripts/make-postgres-schema.sh`.

### P4 — streaming & credentials
- The incomplete WebSocket system was **removed** (unwired, undeclared `ws`, broken test import) — the review's sanctioned alternative to advertising it. No doc ever referenced it.
- Browser credentials: CSP + full security headers on **every** response (HTML via `next.config.ts`, API JSON via `http.ts`, single source `src/lib/security-headers.ts`); session TTL 24h → **8h**; sessionStorage labeled pilot/demo-grade in code + SECURITY.md with the exact mitigation set and the HttpOnly-cookie production path; tokens appear only in `Authorization` headers (never URLs/logs/envelopes/exports — enforced and tested).

### P5 — documentation truth
README: `MAP_TOKEN` → `FIRSTLIGHT_FIRMS_TOKEN` (the env name the code and tests actually use); "simulated demo platform" description replaced with the honest two-mode statement; test counts 148 → 186. PILOT_ACCEPTANCE: round3 regression recorded (182 type errors), 130/130 → 186/186, new rows for layer provenance / worker honesty / deployment profiles, artifact-generated claims. CI builds the operational bundle with `NEXT_PUBLIC_DEMO_MODE=false` (a runtime env can never flip a baked client bundle — this was a latent deployment bug).

---

## 3. Test inventory added in this delivery

| Suite | File | Cases |
|---|---|---|
| Registry import coverage | `tests/registry.test.ts` | 6 |
| Ingestion identity, concurrency, lifecycle, window | `tests/ingestion-identity.test.ts` | 19 |
| Layer provenance (real router) | `tests/integration.test.ts` (+2) | 2 |
| Planet adapter contracts (rewritten) | `src/lib/server/adapters/__tests__/planet.test.ts` | 11 (was 11 vitest, never runnable) |
| Python egress policy | `python/test_secure_download.py` | 24 |

---

## 4. Exact commands run (final evidence)

```
rm -rf node_modules .next out db tests/fixtures/*.db
bun install --frozen-lockfile        # pass — 479 packages
bun run lint                         # pass — 0 errors, 1 warning
bun run typecheck                    # pass — 0 errors
bun test                             # pass — 186/186 across 15 files
bun run build                        # pass (DEMO_MODE=false)
bun run build:static                 # pass
python3 -m unittest test_secure_download   # pass — 24/24 (python/)
FIRSTLIGHT_BASE_URL=:3005 python3 scripts/browser-smoke.py  # 59/59
```
`bun run verify:full` automates all of the above (except the smoke) and writes `docs/verification-summary.json`.

## 5. Environment & setup

- Demo: `bun run dev` (or static: `bun run build:static` → `out/`). No secrets, no server, clearly labeled simulated.
- Operational: `DATABASE_URL=file:...bunx prisma db push && bun run db:seed`, build with `DEMO_MODE=false NEXT_PUBLIC_DEMO_MODE=false`, `node .next/standalone/server.js`. Login: `analyst@firstlight.example` / `fl-demo-analyst-token-2026` (seeded pilot tokens).
- Pilot containers: `docker compose --profile pilot up` (requires `POSTGRES_PASSWORD`, `APP_ADMIN_TOKEN`, `MINIO_ROOT_*`; see `.env.example`). Demo container: `--profile demo up`.
- Provider keys: `FIRSTLIGHT_FIRMS_TOKEN`, `FIRSTLIGHT_COPERNICUS_USERNAME/PASSWORD` (optional; adapters report `blocked` without them — never simulated).

## 6. Known limitations & intentionally blocked features

1. **The analysis layer is synthetic** (labeled everywhere; `provenance.analysisMode: 'synthetic-scenario'`). Real raster→product processing is the roadmap's processing phase.
2. **Python worker tasks are `blocked_scaffold`** — the honest label for unimplemented capabilities; the hardened download seam is real and tested.
3. **SessionStorage bearer token is pilot-grade** (labeled, 8h TTL, CSP'd); HttpOnly cookie + CSRF is the documented production upgrade.
4. Image pins in compose (minio/grafana/otel) should be re-verified against your registry when deploying; TLS certificates must be mounted for nginx 443.
5. The 1 lint warning (`import/no-anonymous-default-export` in map-layers) is pre-existing and cosmetic.
6. Backup verification (`--verify`) requires a Docker runtime (not available in the CI sandbox) — run it in the pilot environment.

## 7. Changed files

56 files changed, +3,812 / −4,584 (net −772 lines: scaffolding removed, contracts tightened). Full list: `git diff --stat 9a0c53f..HEAD`.
