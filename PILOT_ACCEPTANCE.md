# PILOT_ACCEPTANCE.md — measurable criteria & current status

The transformation brief's definition of done, itemized with evidence. **Status legend:** ✅ verified (automated) · 🟡 partial (documented seam) · ⛔ deferred with explicit dependency.

## Correctness gates

| Criterion | Status | Evidence |
|---|---|---|
| Frozen install reproducible | ✅ | `bun.lock` committed; CI installs `--frozen-lockfile` with **no fallback** (the old `\|\| bun install` is removed) |
| Lint passes | ✅ | `bun run lint` → 0 errors (CI job) |
| **Typecheck passes — no skipped validation** | ✅ | `tsc --noEmit` exit 0; `ignoreBuildErrors: false`; hard CI gate. Baseline had 3 errors (MapLibre GeoJSON `never`, missing `ReviewOverrides` export) — fixed in Phase 0 |
| Unit/integration/contract tests | ✅ | **130/130** across 10 files (geo, graph, decision, sitrep, exports, golden determinism, clip, scoring, integration, adapters) |
| Production build (operational) | ✅ | `bun run build` type-validated; API route dynamic |
| Static demo build | ✅ | `bun run build:static`; API route excluded (never ships a server surface) |
| Demo mode works offline, clearly labeled | ✅ | 52-check browser suite section B: SIMULATED banner renders, pipeline boots, H3 zones render, no console errors |

## Operational workflow (end-to-end, real data)

| Criterion | Status | Evidence (browser-smoke check names) |
|---|---|---|
| Authenticated access required in operational mode | ✅ | "unauthenticated /api/events → 401", login gate renders in browser |
| At least one real open-data event discovered + ingested + validated | ✅ | "LIVE USGS ingestion succeeds" (10 real assets, Oklahoma), "LIVE NWS alerts ingestion succeeds" |
| Ingestion idempotent | ✅ | "repeated ingestion is replayed (idempotent)" + integration tests (incl. failed-runs-are-re-attemptable) |
| Blocked dependency reported honestly | ✅ | FIRMS → 503 `blocked_dependency` naming `FIRSTLIGHT_FIRMS_TOKEN`; meta reports `health: blocked` |
| Data catalog with provenance (license, age, simulated flag) | ✅ | "catalog lists USGS records with license + age", "catalog marks synthetic vs real distinctly" |
| Review: assigned, reason required, immutable, concurrency-safe | ✅ | 4 checks incl. "empty reason → 400", "stale version write → 409 stale_version" |
| Scores recomputed from review decisions server-side | ✅ | event-core reads DB decisions; integration test "decisions are immutable — corrections append" |
| Grounded sitrep: claims cite evidence, quality notes | ✅ | "draft cites the REAL USGS asset as evidence", "draft labels exposure as UNCALIBRATED" |
| Approval freezes claim set (two-person rule) | ✅ | "approver freezes the draft → approved"; integration tests for self-approval rejection + regeneration-creates-new-version |
| Exports checksummed + approval-gated | ✅ | "sitrep.md export allowed after approval (sha256 recorded)"; pre-approval export → 409 (integration) |
| Offline bundle: checksums, expiry, revocation | ✅ | 5 checks incl. tamper detection, revoke → invalid on import |
| Audit chain intact across the whole trail | ✅ | "audit chain verifies (SHA-256, gap-free)" (41+ events) + tamper/splice tests |
| RBAC + tenant isolation | ✅ | observer 403s (create/decide/audit), role lattice tests, 404 existence hiding |
| Playwright covers the E2E operational workflow | ✅ | **52/52 checks** in `scripts/browser-smoke.py` (login → event → ingest → review → sitrep → approve → export → bundle → audit → logout) |

## Honesty requirements

| Criterion | Status | Evidence |
|---|---|---|
| Failed/stale sources visible, never authoritative-looking | ✅ | failed assets recorded `failed`; FIRMS blocked; catalog shows age + status; sitreps cite `source_freshness` |
| Every operational numeric claim links to query + product version + source + quality | ✅ | claim ledger in every sitrep (tool, params, value, evidence assets, queryHash, qualityNote) |
| Every external source has a license + attribution record | ✅ | `DATA_SOURCES.md` + per-record license fields rendered into exports (Appendix B) |
| Synthetic data impossible to overlook | ✅ | `simulated` flags in catalog/exports/claims; `DemoModeError` in operational mode without explicit opt-in (tested) |
| Uncertainty visible | ✅ | need bounds + `rankingUnstable` + `insufficient_evidence` tiers + UNCALIBRATED exposure labeling |

## Deferred (explicit dependencies — never fabricated)

| Capability | Blocker |
|---|---|
| SAR/optical imagery processing products | Python raster worker stack (GDAL/rasterio) not yet in repo — imagery stays a `discovered` catalog reference |
| ML detection models + calibrated accuracy | No trained model shipped; requires licensed benchmark data + evaluation protocol (`MODEL_CARD_TEMPLATE.md` ready) |
| NASA FIRMS live hotspots | `FIRSTLIGHT_FIRMS_TOKEN` (free) — adapter + tests shipped, health `blocked` |
| WorldPop raster exposure | Python worker stack — catalog reference + fixtures shipped |
| OIDC/SAML + MFA, object storage, external queue, Redis, PMTiles | Production infrastructure phase; seams documented in `ARCHITECTURE.md` §7 |
| Full OSM road-network ingest (one-ways at scale, turn restrictions) | PostGIS bulk-load phase; graph engine already supports directed edges + closure observations |

## Restore drill

Procedures defined (`OPERATIONS_RUNBOOK.md`); drill to be executed and timed in the next ops cycle — the DB, audit chain, frozen sitreps, and export checksums are the recovery surface. ⏳ scheduled.

## Pilot sign-off

The open-data pilot is **functionally complete for its bounded scope**: real USGS/NWS/Copernicus/OSM/Open-Meteo records flow end-to-end into durable state, are reviewed under RBAC, and emerge as approval-frozen, checksummed, fully-attributed sitreps and bundles — with the synthetic layer isolated and labeled. Remaining items are all **blocked by explicit external dependencies** (raster workers, FIRMS token, ML training data, identity provider), each documented above rather than simulated.
