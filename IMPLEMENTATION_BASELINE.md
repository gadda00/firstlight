# IMPLEMENTATION_BASELINE.md — FirstLight pre-transformation audit

Audited commit: `2161363` ("Fix CI build: add @types/node, drop stale tailwindcss-animate import"), clone verified 2026-10-29. All statements below were **re-verified by running the checks in this environment**, not assumed from the README.

## 1. Runtime shape

- **Framework**: Next.js 16 (App Router) + React 19 + TypeScript 5, Tailwind CSS 4, shadcn/ui (Radix), Zustand 5, MapLibre GL 5, h3-js 4, lucide-react.
- **Single route**: `/` (`src/app/page.tsx` → `AppShell`). No API routes, no server components with data, no environment variables consumed at runtime. The app is a **pure client-side SPA** in both build modes.
- **Build modes** (`next.config.ts`):
  - `BUILD_MODE=static` → `output: 'export'` to `out/` (GitHub Pages / Netlify / Vercel-static).
  - default → `output: 'standalone'` (container-ready, but nothing server-side exists to serve).
- **State**: one Zustand store (`src/store/firstlight.ts`) owns event, pipeline phase, raw data, decision, weights, review maps, routes, sitrep, approval, layer visibility. No persistence of any kind — refresh loses everything.

## 2. Data flow (current)

```
page.tsx ──loadEvent()──▶ store ──▶ generateEvent(meta)      [client, deterministic]
                              ├──▶ computeDecision(raw, weights, overrides)  [client, deterministic]
                              ├──▶ computeRoute(...)                      [client, deterministic]
                              ├──▶ generateSitrep(ctx)                    [client, deterministic template]
                              └──▶ exports.ts (GeoJSON/CSV/audit/offline) [client, browser download]
```

## 3. Function-by-function honesty map

| Module | Function | Status |
|---|---|---|
| `events.ts` | `EVENTS`, `eventById` | **Simulated** catalog with provenance-*shaped* metadata ("Maxar Open Data (simulated)", "Planet (simulated tasking)") |
| `generate.ts` | `generateEvent` | **Deterministic synthetic** (mulberry32 seed): road grid, buildings, damage field per archetype, flood rings, facilities, pop grid, fake pipeline stage timings |
| `rng.ts` | `mulberry32`, `Rng`, `fnv1a` | Real algorithms; `fnv1a` is a **demo checksum, not a security control** |
| `geo.ts` | haversine, point-in-ring, shoelace, rotated rect | Real math (planar approximations, degrees-based) |
| `graph.ts` | `RoadGraph`, Dijkstra (binary heap), multi-source, isochrone | **Real algorithm** on synthetic geometry; edges implicitly bidirectional (no one-way); `blocked` is a boolean with no observation metadata |
| `decision.ts` | `computeDecision`, `scoreZones`, `computeRoute` | **Real deterministic logic** over synthetic inputs. Known weaknesses to replace: global-max normalization; `floodShare` sampled only at boundary points + centroid (not area-weighted); `affectedPop = pop · clamp(D·1.5 + floodShare·0.75)` is an **unlabeled heuristic**; no uncertainty, no sensitivity, no missingness handling; every zone forced into warning/watch/informational |
| `sitrep.ts` | `generateSitrep` | **Deterministic template engine** — typed tool-call citations + FNV-1a assertion hashes; not persisted, not approval-frozen, regenerated client-side |
| `exports.ts` | `damageGeoJSON`, `floodGeoJSON`, `zonesGeoJSON`, `roadsGeoJSON`, `routesGeoJSON`, `zonesCSV`, `auditTrail`, `offlineBundle`, `download*` | Pure builders (**real, reusable**) + browser-download helpers (**client-only**). Audit "hash chain" is a single FNV-1a value — demo-grade |
| `db.ts` | `PrismaClient` singleton | **Orphan**: imports `@prisma/client`, which is not even a dependency; no schema, no design intent, no caller. Must be removed or made real |
| `store/firstlight.ts` | Zustand store | Client-only; review decisions and sitrep approval have **no identity, no reason, no immutability, no concurrency control** |

## 4. Deployment targets & environment assumptions

| Target | Config | Status |
|---|---|---|
| GitHub Pages | `.github/workflows/deploy-pages.yml` (bun, `build:static`, `NEXT_PUBLIC_BASE_PATH=/firstlight`) | **Active** — live demo at https://gadda00.github.io/firstlight/ |
| Netlify | `netlify.toml` (`build:static` → `out/`) | Declared, untested here |
| Vercel | `vercel.json` (static `out/`) | Declared, untested here |
| Container | `output: 'standalone'` | Declared, nothing server-side to run |

Environment assumptions: **zero** — no keys, no DB, no network calls at runtime. Map tiles are fetched from Esri/CARTO CDNs by the browser.

## 5. Licensing & attribution obligations (current)

- Code: MIT (LICENSE).
- Basemap attribution strings (Esri World Imagery, © OpenStreetMap contributors, © CARTO) appear in README/status bar — must be **preserved and extended** with real provider attributions when real adapters land.
- README already flags: Sentinel-1/2 free & open; "Maxar Open Data and Planet tasking terms require review"; simulated sensor entries are labeled "(simulated)" inside `events.ts`.
- No `SECURITY.md`, no `DATA_SOURCES.md`, no license registry — attribution lives in free-text strings only.

## 6. Checks — verified results on the baseline

| Check | Command | Result |
|---|---|---|
| Install | `bun install` | OK (440 pkgs) — **but no lockfile committed**; CI uses `bun install --frozen-lockfile \|\| bun install` (silent fallback — must be removed) |
| Lint | `bun run lint` (`eslint .`) | ✅ 0 errors |
| **Typecheck** | `bunx tsc --noEmit` | ❌ **FAILS — exit 1, 3 errors** |
| Production build | `bun run build:static` | ✅ passes **only because** `next.config.ts` sets `typescript.ignoreBuildErrors: true` and prints "Skipping validation of types" |
| Tests | — | **None exist. No runner, no fixtures, no CI test job.** |

Baseline type errors (exact):
1. `src/components/firstlight/map/map-view.tsx(222,18) TS2345` — features pushed into untyped `const feats = []` → inferred `never[]` (the MapLibre GeoJSON inference failure).
2. `src/lib/firstlight/exports.ts(13,3) TS2305` — `ReviewOverrides` is defined in `decision.ts` but imported from `types`.
3. `src/lib/firstlight/sitrep.ts(13,3) TS2305` — same missing export.

## 7. Dependency & security inventory

- Runtime deps: 20 (see `package.json`) — all mainstream; no pinning (all `^` ranges), lockfile absent.
- Dev deps: 8. `@prisma/client` is imported by `src/lib/db.ts` but **absent from dependencies** — importing that module would crash at runtime today.
- Security posture: no auth, no sessions, no RBAC (nothing to protect — no server); no CSP/security headers; no secret handling (no secrets exist); `next.config.ts` disables strict React mode; `allowJs` + `noImplicitAny: false` in tsconfig weaken the type gate.
- `truthCorrect` seeded flags exist on `Building` — demo-benchmark only; must never leak into operational validation.

## 8. Migration-risk list

| Risk | Item | Disposition |
|---|---|---|
| HIGH | `typescript.ignoreBuildErrors: true` | **Remove**; make `tsc --noEmit` a hard CI gate before any feature work |
| HIGH | `src/lib/db.ts` orphan Prisma import | Replace with a real, migration-backed persistence layer (pilot: SQLite via Prisma; documented PostGIS path) |
| HIGH | CI `--frozen-lockfile \|\| bun install` fallback | Remove fallback; commit lockfile; reproducible CI |
| MED | `generate.ts` running unconditionally | Isolate as `DemoScenarioProvider` behind a mode flag; never in operational mode without labeling |
| MED | `floodShare` point-sampling | Replace with area-weighted polygon clipping |
| MED | Global-max normalization + heuristic affectedPop | Version the score formula; label exposure method; add robust option + uncertainty |
| MED | FNV-1a "audit hash" | Replace with SHA-256 chain server-side; keep FNV only as demo compat |
| MED | Review workflow (no identity/reason/immutability) | Server tasks + append-only decisions + optimistic concurrency |
| LOW | `Rng.gauss` approximation, planar geometry | Retain (demo scale), document limits |
| RETAIN | Dijkstra engine, dual-map UI, H3 zoning, sitrep tool-call concept, export builders, dark EOC design | Keep; upgrade in place |

## 9. Transformation scope decision (phases)

This repository will be upgraded in vertical slices per the transformation brief, with the app runnable after every phase: **Phase 0** (correctness gate: tsc green, lockfile, tests, demo isolation, banners) → **Phase 1** (operational foundation: persistence, auth/RBAC, validated API, audit chain) → **Phase 2** (open-data adapters: USGS / Open-Meteo flood / NWS alerts / Copernicus STAC live-capable; FIRMS blocked-by-key with contract+fixtures; OSM + WorldPop contract+fixtures) → **Phase 3** (scoring v2: versioned manifests, uncertainty, sensitivity, missingness, area-weighted flood; review persistence) → **Phase 4** (server-backed claims, approval freezing, SHA-256 exports, offline bundle v2) → **Phase 5-lite** (security docs, runbooks, CI hardening, e2e). Capabilities requiring paid/partner data or GPU inference are implemented as **adapter contracts + fixtures + explicit "blocked" documentation**, never fabricated.
