# FirstLight — Disaster Intelligence Platform

**From raw imagery to a prioritized, routable response map — for the first six hours after a disaster.**

FirstLight is a Geo-AI decision-layer demo that ingests pre/post-event imagery concepts, detects building damage and flood extents, and fuses those outputs with road networks, population grids, and critical facilities to answer the questions responders actually ask:

> *Where is the need greatest, which roads still work, and which hospitals or communities are cut off?*

> ⚠️ **All damage footprints, facility statuses, and population figures in this demo are procedurally SIMULATED.** No real imagery is processed. Every artifact is labeled with its provenance (source, sensor, date, resolution, license, processing version). This is a platform demonstration, not an operational product.

---

## Live demo

**https://gadda00.github.io/firstlight/** (deployed from this repository)

Deploy your own in one click:

| Platform | How |
|---|---|
| **Netlify** | [![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/gadda00/firstlight) — or Site → *Import from Git* → pick this repo. Zero config (`netlify.toml` included). |
| **Vercel** | [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/gadda00/firstlight) — or *Add New Project → Import* this repo. Zero config (`vercel.json` included). |
| **GitHub Pages** | Already wired: `.github/workflows/deploy-pages.yml` builds and deploys on every push to `main`. |

## What's implemented

This repository implements the **decision-layer wedge** from the FirstLight Technical Blueprint (v2.0) — the part that turns raw detections into operational answers — as a fully client-side web platform:

| Blueprint layer | Implementation |
|---|---|
| **1. Ingestion** | Simulated STAC-style provenance records (Sentinel-1/2, Maxar Open Data, Planet, WorldPop) with per-source license, resolution, cloud %, processing version |
| **2. Preprocessing** | Deterministic seeded event generation: 3 archetypes (hurricane surge + wind field, riverine flood meander, earthquake intensity + soft-soil amplification) |
| **3. AI detection mesh** | Procedurally simulated building damage (4 classes + per-detection confidence), SAR flood extents with depth classes, uncertainty routing to a review queue |
| **4. Spatial graph engine** | **Real**: OSM-style road network → graph → binary-heap **Dijkstra** routing, hospital isochrones, isolation deltas (>30 min), debris/flood blockage |
| **5. Grounded sitrep layer** | **Real**: deterministic report engine — every number traces to a typed tool call (`get_event_summary`, `top_zones`, `isolated_facilities`…) with FNV-1a assertion hashes; mandatory human sign-off before export |

### Decision layer (the wedge)

Priority zoning uses Uber **H3 hexagons (res 8)** with the blueprint's transparent, tunable score:

```
need(z) = w₁·D(z) + w₂·Pexp(z) + w₃·Iso(z) + w₄·Crit(z)

D(z)     = (1.0·n_destroyed + 0.6·n_major + 0.2·n_minor) / n_total
Pexp(z)  = affected_population / max_zone_population
Iso(z)   = 1 if travel time to nearest hospital worsens by > 30 min (or unreachable)
Crit(z)  = impacted critical facilities / max_zone_impacted
```

Adjust **w₁–w₄ live** in the UI (toolbar → *Need-score weights*) and watch zones re-rank and re-tier (WARNING / WATCH / INFORMATIONAL).

### Feature highlights

- **Before/after swipe map** — dual camera-synced MapLibre GL maps (Esri World Imagery / CARTO dark), draggable divider
- **Layer stack** — damage points (4 classes), flood extents, H3 need-score zones, passable/blocked roads, facilities w/ status, dispatch routes
- **Review queue** — low-confidence detections (TTA variance, flood-edge ambiguity, occlusion) routed to human-in-the-loop: confirm / reject-as-false-positive / reclassify → stats recompute (the "reviewed labels are the moat" loop)
- **Route planner** — fire station → priority zone on the post-event graph, with blocked-edge avoidance counts and ground-reconnaissance advisories for low-confidence segments
- **Exports** — `damage.geojson`, `flood.geojson`, `zones.geojson`, `zones.csv`, `roads.geojson`, `routes.geojson`, sitrep `.md` (approval-gated), audit trail JSON with hash chain, and an offline field bundle
- **Responsive EOC UI** — dark tactical theme, KPI header, 5-stage pipeline run overlay, full mobile layout

## Quick start

```bash
bun install        # or: npm install
bun run dev        # or: npm run dev  → http://localhost:3000
```

Static production build (works on any static host):

```bash
npm run build:static   # emits ./out
npx serve out
```

For GitHub Pages project sites, set the base path:

```bash
NEXT_PUBLIC_BASE_PATH=/firstlight npm run build:static
```

## Tech stack

- **Next.js 16** (App Router, TypeScript, static export — no server required)
- **Tailwind CSS 4 + shadcn/ui** (dark ops-center theme)
- **MapLibre GL JS** — dual synced maps, WebGL layers, expressions
- **h3-js** — hexagonal priority zoning
- **Zustand** — event/decision/review state
- Hand-rolled geometry, **Dijkstra** with a binary min-heap, seeded PRNG (mulberry32) — zero external services, no API keys

## Repository layout

```
src/
  app/                 # layout, page (single-route app), globals.css
  components/firstlight/
    map-view.tsx       # dual synced swipe map + layers + tooltip
    map-layers.ts      # MapLibre style/layer definitions
    header.tsx         # identity, event selector, KPI pills
    pipeline-overlay.tsx
    app-shell.tsx      # layout composition + status bar
    panels/            # Overview, Zones, Access, Sitrep, Review, Export, Data
  lib/firstlight/
    events.ts          # 3-event catalog w/ full provenance
    generate.ts        # seeded procedural event generation
    graph.ts           # road graph, Dijkstra, isochrones
    decision.ts        # H3 zones, need scores, isolation, routes
    sitrep.ts          # grounded report engine (tool-call citations)
    exports.ts         # GeoJSON/CSV/audit/offline-bundle builders
    geo.ts, rng.ts, types.ts
  store/firstlight.ts  # zustand store
.github/workflows/deploy-pages.yml   # auto-deploy to GitHub Pages
netlify.toml | vercel.json           # one-click host configs
```

## Deployment notes

- **Netlify**: `netlify.toml` runs `npm run build:static` and publishes `out/`.
- **Vercel**: `vercel.json` sets the static build; zero other config.
- **GitHub Pages**: workflow builds with `NEXT_PUBLIC_BASE_PATH=/firstlight` and publishes. Enable via *Settings → Pages → Source: GitHub Actions* (already active for this repo).

## Licensing & ethics guardrails (from the blueprint)

- Prototype on public benchmarks (xBD, Sen1Floods11), then transition to commercially clean data + pilot labels — **verify every license before shipping derivative products**.
- Sentinel-1/2 data is free & open with commercial use allowed; Maxar Open Data and Planet tasking terms require review.
- Human-in-the-loop is mandatory: sitreps require analyst sign-off; low-confidence detections route to review; exports carry the demo disclaimer.
- No targeting features; scope limited to humanitarian logistics and damage assessment.

## License

MIT — see [LICENSE](LICENSE). Map tiles: © Esri, © OpenStreetMap contributors, © CARTO. This project is not affiliated with any emergency management agency.
