# FirstLight — Disaster Intelligence Prototype

**A simulated-exercise demo of a disaster-intelligence workflow: transparent need scores, human review, grounded reporting, and provenance-stamped exports — over generated scenario data.**

> **Read this first.** The public demo at <https://gadda00.github.io/firstlight/> is a **simulated exercise**. Every damage footprint, road closure, facility status, population figure, score, and report is **procedurally generated fiction** rendered over a real basemap. **No satellite imagery is acquired or processed anywhere in the demo, and nothing in it reflects current conditions.** What is real: the basemap (© OpenStreetMap · Esri · CARTO), the browser compute (H3 zoning, need scores with uncertainty, routing on a toy graph), and the workflow itself (review → sitrep → export). FirstLight is not operationally deployed and is not affiliated with any emergency agency.

- **Modes, plainly:** the GitHub Pages site is a static **simulated exercise**; the repository also contains a locally-runnable **server-backed pilot** (real catalog ingestion, labeled-synthetic analysis, SHA-256 audit chain) — see the [capability matrix](docs/CAPABILITY_MATRIX.md). No processed real-data product exists yet; no public operational deployment exists.
- **Provider truth:** every data-source status is machine-read from [`src/lib/firstlight/provider-status.json`](src/lib/firstlight/provider-status.json) and rendered below — implemented adapters are pinned by tests; researched candidates are explicitly **not connected**.

---

## Live demo (simulated exercise, static)

**https://gadda00.github.io/firstlight/** — deployed from this repository on every push to `main`.

The scenario catalog uses unmistakable nomenclature (**Synthetic Scenario A/B/C**) so no event can be mistaken for a historical record; the swipe map is honestly labeled **basemap / generated overlays** (both panes show the same real basemap — there is no before/after imagery); sensor metadata is **illustrative — not acquired**; pipeline stages list only the compute that actually runs in the browser; and "confidence" values are presented as **generated scenario scores** (never as model probabilities). Deterministic seeds make every run reproducible.

Deploy your own demo in one click:

| Platform | How |
|---|---|
| **Netlify** | [![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/gadda00/firstlight) — zero config (`netlify.toml` included) |
| **Vercel** | [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/gadda00/firstlight) — zero config (`vercel.json` included) |
| **GitHub Pages** | Already wired: `.github/workflows/deploy-pages.yml` |

## Local pilot (server, authenticated, real catalog — not a deployment)

> **What the local pilot is — stated plainly:** a **real-data catalog + labeled-synthetic analysis**. Open-data providers (USGS, NWS, Copernicus STAC, Open-Meteo, OSM) populate a genuine, checksummed asset catalog, but the damage/flood **analysis geometry is still the labeled synthetic scenario** — no raster→product processing exists (the Python worker reports every raster/ML task as `blocked_scaffold` with its exact missing dependency). Every served layer carries a first-class `provenance` block (`analysisMode: synthetic-scenario`, source asset IDs, processing version, CRS, caveats) and the UI shows a `⚠ SYNTHETIC ANALYSIS` badge beside the layer. See `PROVENANCE_SPEC.md`.

The pilot adds (verified by a 59-check browser suite driving the real UI):

- **Persistence** — SQLite dev store via Prisma; pilot Docker profile runs one shared PostgreSQL/PostGIS with `prisma migrate deploy`: organizations, users, sessions, events, asset catalog, ingestion runs/attempts, review tasks + immutable decisions, versioned score configs, sitrep drafts/claims/approvals, export artifacts, offline bundles, and an append-only **SHA-256 audit chain**.
- **Auth & RBAC** — hashed bearer sessions; capability lattice; org isolation; login/logout audited. Pilot uses seeded account tokens; production path is OIDC/SAML (documented seam).
- **Real open-data ingestion (catalog only)** — `DataSourceAdapter` contract with retries, backoff, timeouts, bounded bodies, SSRF host allowlists, and checksums. **Live-capable:** USGS earthquakes, NOAA/NWS alerts, Open-Meteo GloFAS discharge, Copernicus STAC metadata, bounded OSM Overpass. **Blocked honestly:** NASA FIRMS (needs a free MAP_TOKEN). **Fixture-only:** WorldPop (raster intersection deferred). A catalog result is **not** an acquired image; a water class is not flood depth; discharge is not a flood outline; earthquake metadata is not building damage.
- **Grounded sitreps** — every number comes from a typed query tool; claims cite catalog asset IDs; approval freezes the claim set by SHA-256 hash (two-person rule).
- **Scoring v2** — versioned manifest, area-weighted flood share, uncertainty bounds, ±25% sensitivity, missingness penalties, `not enough evidence` outcome. Weights are **uncalibrated heuristics**.
- **Exports & offline bundles v2** — server-built, checksummed, provenance-stamped. Demo exports carry `simulated: true` + scenario ID + seed and a human-readable warning; checksums are **non-cryptographic FNV-1a demo checksums** (not signatures; they never verify truth).
- **Operational web UI** — after login the browser renders the server-built layer; the client composes nothing itself.

### Run the local pilot

```bash
bun install
cp .env.example .env                      # set DATABASE_URL to an ABSOLUTE path
bunx prisma db push                       # create the schema
bun run db:seed                           # org + one user per role (tokens printed)
DEMO_MODE=false NEXT_PUBLIC_DEMO_MODE=false bun run build
DEMO_MODE=false DATABASE_URL=file:$(pwd)/db/firstlight.db bun run start
# → http://localhost:3000  (login gate; use the seeded analyst account)
```

Smoke the whole pilot workflow end-to-end (real browser, real USGS/NWS calls):

```bash
bun run build:static && DEMO_MODE=false NEXT_PUBLIC_DEMO_MODE=false bun run build
python3 scripts/browser-smoke.py          # 59 checks: login→ingest→review→sitrep→approve→export→bundle→audit
```

### Verification gates

```bash
bun install --frozen-lockfile   # frozen — no silent fallback
bun run lint        # eslint — 0 errors
bun run typecheck   # tsc --noEmit — HARD gate
bun test            # 210 tests (186 core + 24 truthfulness pins: tests/honesty.test.ts)
bun run build       # operational build (type-validated)
bun run build:static  # demo build (API route excluded — a static build never ships a server)
```

CI (`.github/workflows/ci.yml`) runs all of the above with a frozen lockfile and no fallback. `bun run verify:full` reruns every gate from a clean state and writes **docs/verification-summary.json** (commit SHA, per-gate results). Acceptance tables are generated from that artifact — never hand-edited.

## What's implemented vs. honestly deferred

| Capability | Status |
|---|---|
| Simulated-exercise demo (persistent banner, first-use intro, Guide/glossary, honest labels) | **Done** — `tests/honesty.test.ts` pins the truthfulness contract |
| H3 priority zoning, overlay-comparison map, review queue, grounded sitrep, exports | **Done (demo mode)** |
| Persistence, auth/RBAC, API validation, SHA-256 audit chain, health | **Done (local pilot)** |
| 7 data-source adapters + idempotent ingestion orchestration | **Done (pilot)** — statuses in the registry below |
| Scoring v2 (uncertainty, sensitivity, missingness, area-weighted flood) | **Done** — uncalibrated weights, honestly labeled |
| Server claims, approval freeze, exports, offline bundle v2 | **Done (pilot)** |
| **Raster/imagery processing** (SAR RTC, cloud masking, compositing) | **Deferred** — worker reports `blocked_scaffold`; imagery stays a catalog reference, never a fabricated detection |
| **ML detection models** | **Deferred** — no model ships; the demo generator is labeled synthetic end-to-end. See `MODEL_CARD_TEMPLATE.md` |
| Real road graph at scale (one-ways, turn restrictions, full OSM) | **Partial** — graph engine supports directed edges + closure observations; full-network ingest is the PostGIS phase |
| OIDC/SAML + MFA, object storage, queue, Redis, tiles | **Deferred with documented seams** |

Full detail: `IMPLEMENTATION_BASELINE.md` → `ARCHITECTURE.md` → `DATA_SOURCES.md` → `PILOT_ACCEPTANCE.md`; evidence per claim: [`docs/EVIDENCE_LEDGER.md`](docs/EVIDENCE_LEDGER.md).

## Provider & source registry (machine-readable)

Generated from `src/lib/firstlight/provider-status.json` — **edit the JSON, then run `bun run scripts/render-provider-status.ts`** (never hand-edit this table).

<!-- BEGIN:PROVIDER_TABLE -->
| Provider | Pilot status | Public demo | Data role (honest) |
|---|---|---|---|
| USGS Earthquake Hazards Program | live | not connected | hazard metadata — earthquake magnitude/location/time; NOT building damage |
| NOAA National Weather Service | live | not connected | official alert polygons/text — NOT damage assessment |
| NOAA environmental data | live | not connected | hazard context |
| Open-Meteo (GloFAS discharge) | live | not connected | river discharge forecasts — NOT flood outlines |
| Copernicus Data Space Ecosystem | live (catalog only) | not connected | catalog metadata — listing is not an acquisition |
| OpenStreetMap via Overpass API | live | not connected | road/facility context — passability is NEVER implied |
| OSINT aggregator | live (aggregated open feeds) | not connected | context leads — always unverified until corroborated |
| NASA FIRMS | blocked — requires free FIRSTLIGHT_FIRMS_TOKEN (MAP_TOKEN) | not connected | thermal anomalies — NOT confirmed fire perimeters |
| WorldPop | fixtures-only — raster intersection deferred | synthetic illustrative grid (clearly labeled, NOT WorldPop data) | population context (modelled estimates with vintage/uncertainty) |
| Planet Labs | blocked — requires FIRSTLIGHT_PLANET_API_KEY | not connected (demo sensor entries are illustrative metadata only) | high-resolution imagery (commercial) |
| Maxar Open Data | blocked — requires FIRSTLIGHT_MAXAR_CLIENT_ID/SECRET | not connected (demo sensor entries are illustrative metadata only) | high-resolution event imagery |
| Sentinel Hub (Sinergise) | blocked — requires FIRSTLIGHT_SENTINELHUB_CLIENT_ID/SECRET | not connected | raster processing services |
| ECMWF | blocked — requires FIRSTLIGHT_ECMWF_API_KEY | not connected | weather/forecast context |
| X/Twitter API | blocked — requires FIRSTLIGHT_TWITTER_BEARER_TOKEN | not connected | OSINT context only |
| Copernicus Data Space Ecosystem (assets) | candidate — catalog discovery live; asset download/processing NOT implemented | not connected | Cloud/day-night-resilient SAR + optical for event-specific observations; enables a reproducible real-data pilot |
| NASA OPERA via PO.DAAC/CMR | candidate — not implemented | not connected | Official product-level surface-water classifications with granule/time/quality metadata — distinguishes provider product from FirstLight derived change |
| China NSMC Fengyun Data Portal | candidate — access not verified (account review + product order + FTP route not tested) | not connected | Additional optical/microwave coverage and cadence for AOIs of interest |
| CNSA/CRESDA Gaofen international sharing | candidate — portal availability/product availability for AOI+date not verified | not connected | Broad screening/context imagery at moderate resolution |
| ISPRS benchmark datasets (e.g. Vaihingen) | candidate — discovery index only; per-dataset access/license must be checked | not connected | Offline research/segmentation training material |
| xBD / xView2 | candidate — research/training/retrospective evaluation only | not connected | The canonical building-damage benchmark for research |
| Sen1Floods11 | candidate — research/retrospective evaluation only; access/terms not re-verified from this repo | not connected | Flood-mapping benchmark |
| OpenAerialMap | candidate — optional source-discovery layer | not connected | Post-event UAV imagery discovery where it exists |
| EC GHSL | candidate — not implemented | not connected | Alternative built-settlement/population context layer |
| NASA GPM IMERG / CHIRPS | candidate — not implemented | not connected | Rainfall context for flood archetypes |

Full terms, attribution, evidence, and next owner actions: `docs/PROVIDER_STATUS.md` (generated, verified 2026-11-11).
<!-- END:PROVIDER_TABLE -->

## Tech stack

- **Next.js 16** (App Router, TypeScript strict) — dual build: `output: standalone` (server) / `output: export` (static demo)
- **Prisma + SQLite** pilot store → **PostgreSQL + PostGIS** production path
- **Zod** validation at every API boundary; uniform error envelope with request IDs
- **MapLibre GL JS**, **h3-js**, **Zustand** (ephemeral UI state only)
- **Bun** (runtime, test runner, frozen lockfile), Playwright browser suite

## Documentation index

| Doc | Contents |
|---|---|
| `docs/EVIDENCE_LEDGER.md` | Every public claim → mode, status, evidence, verification date, unresolved owner action |
| `docs/CAPABILITY_MATRIX.md` | Capability × mode matrix (public demo / local pilot / catalog / processed product / validated) |
| `docs/DATA_FLOW.md` | Data-flow diagrams for the static demo and the pilot |
| `docs/PROVIDER_STATUS.md` | Full provider registry terms + statuses (generated) |
| `IMPLEMENTATION_BASELINE.md` | Pre-transformation audit |
| `ARCHITECTURE.md` | System boundaries, data flow, trust boundaries, persistence |
| `DATA_SOURCES.md` | Every adapter: endpoints, licenses, rate limits, health, fallbacks |
| `DATA_DICTIONARY.md` | Database + export schema reference |
| `PROVENANCE_SPEC.md` | Asset → product → claim lineage rules |
| `SCORING_METHOD.md` | Score v2 formulas, manifest, uncertainty, sensitivity, calibration status |
| `SECURITY.md` | Threat model, auth model, headers, retention, incident response |
| `OPERATIONS_RUNBOOK.md` | Deploy, rollback, provider outage, stale data, restore drill |
| `PILOT_ACCEPTANCE.md` | Measurable acceptance criteria and current status |
| `MODEL_CARD_TEMPLATE.md` | Required disclosure format for any future detection model |
| `docs/openapi.yaml` | API contract |
| `TRANSFORMATION_ROADMAP.md` | Planning assumptions only — untested targets, explicitly not implemented capabilities |
| `DELIVERY_SUMMARY.md` | Short factual delivery notes |

## Licensing & attribution

- Code: MIT (see `LICENSE`).
- Demo basemaps: © Esri, © OpenStreetMap contributors, © CARTO — tiles only; no event imagery.
- Pilot sources: each carries its license record in the data catalog and in every export (USGS public domain; GloFAS via Open-Meteo CC BY 4.0; NWS public domain; Copernicus Sentinel free & open with attribution; OSM ODbL 1.0; WorldPop CC BY 4.0). Verify every license before shipping derivative products.
- Not affiliated with any emergency management agency. No operational deployment exists.
