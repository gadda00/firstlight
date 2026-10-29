# FirstLight — Disaster Intelligence Platform

**From raw evidence to a prioritized, routable response map — for the first six hours after a disaster.**

FirstLight is a Geo-AI decision layer for humanitarian logistics, damage assessment, and access analysis. This repository now ships **two clearly separated run modes** — a fully client-side **demo** (unchanged behavior, clearly labeled simulated data) and an **operational mode** with a server API, database persistence, authentication/RBAC, real open-data ingestion, a SHA-256 audit chain, and approval-frozen sitreps.

> **Ethics & scope.** FirstLight supports humanitarian logistics, damage assessment, access analysis, and operational briefing. It provides no targeting, no offensive intelligence, no surveillance of individuals, and no autonomous dispatch. Every operational recommendation is reviewable, explainable, uncertainty-aware, and subject to authorized human approval. Missing data is reported as missing — never silently rendered as "low impact".

---

## Live demo (simulated, static)

**https://gadda00.github.io/firstlight/** — deployed from this repository on every push to `main`.

All damage footprints, facility statuses, and population figures in the demo are **procedurally simulated** (deterministic seeded generator, now isolated behind the `DemoScenarioProvider` + a `DEMO_MODE` flag). Every artifact carries its provenance (source, sensor, date, resolution, license, processing version, and — in v2 — per-zone uncertainty bounds and data-quality flags).

Deploy your own demo in one click:

| Platform | How |
|---|---|
| **Netlify** | [![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/gadda00/firstlight) — zero config (`netlify.toml` included) |
| **Vercel** | [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/gadda00/firstlight) — zero config (`vercel.json` included) |
| **GitHub Pages** | Already wired: `.github/workflows/deploy-pages.yml` |

## Operational mode (server, authenticated, real data)

The operational pilot adds (all verified by an automated 59-check browser suite that drives the real UI, not just the API):

- **Persistence** — SQLite pilot store via Prisma (schema designed to migrate to PostgreSQL + PostGIS; see `ARCHITECTURE.md`): organizations, users, sessions, events, asset catalog, ingestion runs/attempts, review tasks + immutable decisions, versioned score configs, sitrep drafts/claims/approvals, export artifacts, offline bundles, and an append-only **SHA-256 audit chain**.
- **Auth & RBAC** — 192-bit hashed bearer sessions; capability lattice (observer/analyst/reviewer/approver/admin); org isolation; login/logout audited. Pilot uses seeded account tokens; production path is OIDC/SAML (documented seam).
- **Real open-data ingestion** — `DataSourceAdapter` contract with retries, backoff, timeouts, bounded bodies, SSRF host allowlists, and checksums. **Live now:** USGS earthquake feed, NOAA/NWS alerts, Open-Meteo GloFAS discharge, Copernicus STAC metadata, bounded OSM Overpass. **Blocked honestly:** NASA FIRMS (needs free `MAP_TOKEN`). **Fixture-only:** WorldPop (raster intersection deferred).
- **Grounded sitreps** — every number comes from a typed query tool; claims cite catalog asset IDs and carry quality notes; approval **freezes** the claim set by SHA-256 hash (two-person rule: generator ≠ approver).
- **Scoring v2** — versioned score manifest, area-weighted flood share (true polygon∩hexagon clipping), uncertainty bounds, ±25% sensitivity analysis, missingness penalties, and a `not enough evidence` outcome instead of forced tiers.
- **Exports & offline bundles v2** — server-built, checksummed, provenance-stamped; bundles carry per-layer checksums, expiry, and revocation with import-side validation.
- **Operational web UI** — after login the browser renders the server-built layer directly: the event selector lists the org's events, the map/overview/zones/access panels render the server-computed decision layer, and Review/Sitrep/Export are dedicated server-workflow panels (version-guarded decisions with required reasons, two-person sitrep approval with claim-freeze, checksummed export downloads). The browser composes nothing itself — the layer endpoint is losslessly typed so the client renders exactly what the server computed.

### Run the operational pilot locally

```bash
bun install
cp .env.example .env                      # set DATABASE_URL to an ABSOLUTE path
bunx prisma db push                       # create the schema
bun run db:seed                           # org + one user per role (tokens printed)
DEMO_MODE=false NEXT_PUBLIC_DEMO_MODE=false bun run build
DEMO_MODE=false DATABASE_URL=file:$(pwd)/db/firstlight.db bun run start
# → http://localhost:3000  (login gate; use the seeded analyst account.
#    After login the full UI runs on server data: event selector, map,
#    review queue, sitrep approval, exports.)
```

Smoke the whole operational workflow end-to-end (real browser, real USGS/NWS calls):

```bash
bun run build:static && DEMO_MODE=false NEXT_PUBLIC_DEMO_MODE=false bun run build
python3 scripts/browser-smoke.py          # 59 checks: login→ingest→review→sitrep→approve→export→bundle→audit + UI wiring
```

### Repository verification gates

```bash
bun run lint        # eslint — 0 errors
bun run typecheck   # tsc --noEmit — HARD gate (ignoreBuildErrors removed in Phase 0)
bun test            # 148 unit + integration + contract tests
bun run build       # operational build (type-validated)
bun run build:static  # demo build (API route excluded — a static build never ships a server)
```

CI (`.github/workflows/ci.yml`) runs all of the above with a **frozen lockfile and no fallback**. `bun.lock` is committed.

## What's implemented vs. honestly deferred

| Capability | Status |
|---|---|
| H3 priority zoning, dual swipe map, review queue, grounded sitrep concept, exports | **Retained from v2.1** (demo mode) |
| Type gate, lockfile, tests, demo isolation, mode banners | **Done (Phase 0)** — `tsc` was failing at baseline; now green and enforced |
| Persistence, auth/RBAC, API validation, audit chain, health | **Done (Phase 1)** |
| 7 data-source adapters + idempotent ingestion orchestration | **Done (Phase 2)** — 5 live-capable, 1 blocked-by-key (FIRMS), 1 fixture (WorldPop) |
| Scoring v2 (uncertainty, sensitivity, missingness, area-weighted flood) | **Done (Phase 3)** |
| Server claims, approval freeze, exports, offline bundle v2 | **Done (Phase 4)** |
| **Raster/imagery processing** (SAR RTC, cloud masking, compositing) | **Deferred** — requires the Python worker stack (rasterio/GDAL); imagery stays a catalog *reference*, never a fabricated detection |
| **ML detection models** | **Deferred** — no model is shipped; the demo generator is explicitly labeled synthetic and `truthCorrect` never leaves demo evaluation. See `MODEL_CARD_TEMPLATE.md` |
| **Real road graph at scale** (one-ways, turn restrictions, full OSM) | **Partial** — graph engine supports directed edges + closure observations; full-network ingest is the PostGIS phase |
| OIDC/SAML + MFA, object storage, queue, Redis, tiles | **Deferred with documented seams** — pilot uses hashed tokens, SQLite, in-process orchestration |

The full roadmap and rationale: `IMPLEMENTATION_BASELINE.md` (audited starting point) → `ARCHITECTURE.md` → `DATA_SOURCES.md` → `PILOT_ACCEPTANCE.md`.

## Tech stack

- **Next.js 16** (App Router, TypeScript strict) — dual build: `output: standalone` (server) / `output: export` (static demo)
- **Prisma + SQLite** pilot store → **PostgreSQL + PostGIS** production path
- **Zod** validation at every API boundary; uniform error envelope with request IDs
- **MapLibre GL JS**, **h3-js**, **Zustand** (ephemeral UI state only — server is the source of truth in operational mode)
- **Bun** (runtime, test runner, frozen lockfile), Playwright browser suite

## Documentation index

| Doc | Contents |
|---|---|
| `IMPLEMENTATION_BASELINE.md` | Pre-transformation audit (routes, honesty map, checks, migration risks) |
| `ARCHITECTURE.md` | System boundaries, data flow, trust boundaries, persistence design |
| `DATA_SOURCES.md` | Every adapter: endpoints, licenses, rate limits, health, fallbacks |
| `DATA_DICTIONARY.md` | Database + export schema reference |
| `PROVENANCE_SPEC.md` | Asset → product → claim lineage rules |
| `SCORING_METHOD.md` | Score v2 formulas, manifest, uncertainty, sensitivity, calibration status |
| `SECURITY.md` | Threat model, auth model, headers, retention, incident response |
| `OPERATIONS_RUNBOOK.md` | Deploy, rollback, provider outage, stale data, restore drill |
| `PILOT_ACCEPTANCE.md` | Measurable acceptance criteria and current status |
| `MODEL_CARD_TEMPLATE.md` | Required disclosure format for any future detection model |
| `docs/openapi.yaml` | API contract |

## Licensing & attribution

- Code: MIT (see `LICENSE`).
- Demo basemaps: © Esri, © OpenStreetMap contributors, © CARTO.
- Operational sources: each carries its license record in the data catalog and in every export (USGS public domain; GloFAS via Open-Meteo CC BY 4.0; NWS public domain; Copernicus Sentinel free & open with attribution; OSM ODbL 1.0; WorldPop CC BY 4.0). Verify every license before shipping derivative products.
- Not affiliated with any emergency management agency.
