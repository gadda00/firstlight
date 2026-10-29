# DATA_SOURCES.md — FirstLight provider catalog

Every external source is wired through a `DataSourceAdapter` (see `ARCHITECTURE.md` §6) with retries, backoff, timeouts, bounded bodies, SSRF host allowlists, and license records surfaced in the data catalog, exports, and sitrep appendix. Health is published live at `GET /api/meta`.

## Status legend

- **live** — keyless (or credentialed) discovery works now; verified by the browser smoke suite over real network.
- **fixtures-only** — contract + fixtures shipped; the remaining step is explicitly deferred (never simulated).
- **blocked** — an explicit external dependency is missing; the adapter refuses to run and reports 503 `blocked_dependency` naming it. **Never fabricated.**

---

## 1. USGS Earthquake Hazards Program — `usgs-earthquake` (LIVE)

| Field | Value |
|---|---|
| Endpoint | `https://earthquake.usgs.gov/fdsnws/event/1/query` (FDSN event WS, GeoJSON) |
| Auth | None (public) |
| Rate limits | Generous; no published hard cap — we bound requests per ingestion run and cache by idempotency key |
| License | USGS public domain (no restrictions); attribution given voluntarily |
| Refresh | On-demand ingestion; idempotent (same event+params+adapter → replay) |
| Fallback | Empty feature list is a valid result (no events in window) |
| Scope | **Event metadata only**: magnitude, depth, origin time, alert level. Magnitude is NEVER converted into building damage. |
| Coverage gap | Global catalog; national agency feeds (e.g. EMSC, AFAD) can be added through the provider abstraction |

## 2. Open-Meteo Global Flood API (GloFAS) — `open-meteo-flood` (LIVE)

| Field | Value |
|---|---|
| Endpoint | `https://flood-api.open-meteo.com/v1/flood` |
| Auth | None for pilot volumes; commercial tier above 10k calls/day |
| License | **CC BY 4.0** — attribution: GloFAS (Copernicus EMS), redistributed by Open-Meteo |
| Product | River **discharge forecast** series (m³/s, ensemble min/median/max) |
| Scope | Labeled `forecast-risk`. NEVER an observed flood polygon, NEVER depth. Direct Copernicus/GloFAS access adapter is a documented extension when licensing permits. |
| Fallback | Grid cells with no river return an honest empty result |

## 3. NOAA National Weather Service — `nws-alerts` (LIVE)

| Field | Value |
|---|---|
| Endpoint | `https://api.weather.gov/alerts/active?point=lat,lng` (note: no `limit` query param — it 400s; pagination is via Link headers) |
| Auth | None; requires identifying `User-Agent` (set) |
| License | U.S. Government work — public domain |
| Product | CAP-style alert metadata: severity, urgency, certainty, area, issuer, expiry |
| Scope | Advisory metadata. US coverage only — provider abstraction exists for national met agencies |
| Refresh | On-demand; open-ended alerts are valid (no expiry) |

## 4. Copernicus Data Space STAC — `copernicus-stac` (LIVE, metadata)

| Field | Value |
|---|---|
| Endpoint | `https://catalogue.dataspace.copernicus.eu/stac/search` (STAC API, POST) |
| Auth | Anonymous search covers metadata; **full-asset download requires Copernicus credentials** (optional env `FIRSTLIGHT_COPERNICUS_*`, currently unset) |
| License | Copernicus Sentinel data — free & open, commercial use allowed; attribution template stored per record |
| Product | Sentinel-1 GRD / Sentinel-2 L2A STAC items: acquisition time, bbox, processing baseline, cloud metrics, polarization |
| Scope | **Catalog references only.** Records land with `status: "discovered"`. SAR RTC / cloud masking / compositing is deferred to the Python raster worker phase — imagery is never reported as processed detections. `truthCorrect`-style synthetic accuracy claims are forbidden. |

## 5. NASA FIRMS — `firms-fire` (BLOCKED)

| Field | Value |
|---|---|
| Endpoint | `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_TOKEN}/VIIRS_SNPP_NRT/{bbox}/1` |
| **Blocked by** | `FIRSTLIGHT_FIRMS_TOKEN` — a free MAP_TOKEN from NASA FIRMS. Request one, set it server-side, and the adapter goes live with zero code changes. |
| License | Free use with attribution; provider terms require review for derivatives |
| Product | VIIRS/MODIS thermal-anomaly **points** (confidence, FRP, day/night) |
| Scope | Hotspots are never fire perimeters and never confirmed building damage |
| Shipped anyway | Full contract implementation + CSV parser + fixture tests; health reports `blocked` with the dependency named |

## 6. OpenStreetMap Overpass — `osm-overpass` (LIVE, bounded)

| Field | Value |
|---|---|
| Endpoint | `https://overpass-api.de/api/interpreter` (POST; mirror `overpass.kumi.systems` allowlisted) |
| Auth | None |
| License | **ODbL 1.0** — © OpenStreetMap contributors (attribution on every record and export) |
| Guardrails | Server-side only (never from the browser); hard AOI cap ≤ 0.35° bbox; `maxsize`/`timeout` set; idempotent dedupe so repeated runs do not re-query |
| Scope | Facilities + road skeleton. **Operational status is `unknown` until field-confirmed** — the catalog renders "unknown", never "operational". Volunteer mapping is valuable but incomplete; completeness is labeled per record. |
| Production path | Geofabrik/replication extracts into PostGIS (deferred) |

## 7. WorldPop — `worldpop` (FIXTURES-ONLY)

| Field | Value |
|---|---|
| Source | `https://www.worldpop.org/` / HDX catalog |
| License | **CC BY 4.0** — WorldPop, University of Southampton |
| Shipped | Catalog-reference records (year, resolution, methodology, uncertainty note) for known countries (USA/TUR/KEN); unknown countries return empty — never a guessed dataset |
| Deferred | Raster intersection (dasymetric exposure) — requires the Python worker stack. Until then, population exposure in sitreps comes only from the **labeled synthetic layer** and is marked UNCALIBRATED. |

## 8. DemoScenarioProvider — `demo-scenario-provider` (internal, labeled)

Not an external source: the retained procedural generator, isolated in Phase 0. Stamps `demo:{provider,simulated,seed,generatedAt}` on every dataset; refuses to run in operational mode without an explicit opt-in; every derived export/claim carries the `simulated` flag.

---

## Attribution obligations summary (rendered into every export)

- USGS: "U.S. Geological Survey Earthquake Hazards Program" (public domain)
- GloFAS/Open-Meteo: "GloFAS — Copernicus Emergency Management Service, redistributed by Open-Meteo.com under CC BY 4.0"
- NWS: "NOAA National Weather Service" (public domain)
- Copernicus: "Contains modified Copernicus Sentinel data [year], processed by ESA/ESrin"
- OSM: "© OpenStreetMap contributors (ODbL)"
- WorldPop: "WorldPop, University of Southampton (CC BY 4.0)"
- Demo basemaps: © Esri, © OpenStreetMap contributors, © CARTO

## Adding a provider

1. Implement `DataSourceAdapter` in `src/lib/server/adapters/`.
2. Register it in `registry.ts`; declare honest `health` + `healthNote`.
3. Add fixture-backed contract tests (`tests/adapters.test.ts`) covering happy path, malformed payload, provider error, timeout, empty result.
4. Document license + rate limits + fallback here; the catalog UI surfaces all of it from the manifest.
5. Commercial/partner sources (Planet, Maxar, drone) additionally require a signed license record, allowed-use scope, retention period, and export restrictions — behind feature flags until then.
