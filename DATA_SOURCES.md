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

## 8. Planet Labs — `planet` (BLOCKED)

| Field | Value |
|---|---|
| Endpoint | `https://api.planet.com/data/v4/` (Planet Data API) |
| **Blocked by** | `FIRSTLIGHT_PLANET_API_KEY` — obtain from [Planet Developer Portal](https://developers.planet.com/) |
| License | **Planet Labs License** — requires review for commercial use; attribution required |
| Product | PlanetScope (3-5m, daily), RapidEye (5m), SkySat (50cm-1m), Ortho Tiles |
| Scope | High-resolution optical imagery; supports search, activation, and download of scenes |
| Quality | GSD: 3-5m (PlanetScope), 5m (RapidEye), 50cm-1m (SkySat); cloud cover filtering available |
| Features | Item types: PSScene, REScene, SkySatScene, PSOrthoTile, REOrthoTile |

## 9. Maxar Open Data — `maxar` (BLOCKED)

| Field | Value |
|---|---|
| Endpoint | `https://api.digitalglobe.com/catalog/search` (Maxar Catalog API) |
| **Blocked by** | `FIRSTLIGHT_MAXAR_CLIENT_ID` + `FIRSTLIGHT_MAXAR_CLIENT_SECRET` — obtain from [Maxar Open Data Program](https://www.maxar.com/open-data) |
| License | **Maxar Open Data License** — free for disaster response; attribution required |
| Product | WorldView-3 (30cm), WorldView-2 (50cm), GeoEye-1 (50cm), QuickBird (60cm), Ikonos (80cm) |
| Scope | Very high-resolution optical imagery for disaster areas; requires OAuth2 authentication |
| Quality | GSD: 30cm-80cm; panchromatic and multispectral bands available |

## 10. Sentinel Hub — `sentinel-hub` (BLOCKED)

| Field | Value |
|---|---|
| Endpoint | `https://services.sentinel-hub.com/api/v1/` (Sentinel Hub Processing API) |
| **Blocked by** | `FIRSTLIGHT_SENTINELHUB_CLIENT_ID` + `FIRSTLIGHT_SENTINELHUB_CLIENT_SECRET` — obtain from [Sentinel Hub](https://www.sentinel-hub.com/) |
| License | **Copernicus Sentinel Data** — free & open; contains modified Copernicus data |
| Product | Sentinel-1 GRD (SAR), Sentinel-2 L2A/L1C (optical), Sentinel-3 OLCI, Landsat 5/7/8, MODIS, DEM |
| Scope | Cloud-native processing; supports custom evalscripts for on-the-fly processing |
| Quality | Resolution: 10m (Sentinel-1/2), 300m (Sentinel-3), 30m (Landsat), 1km (MODIS) |
| Features | Processing API allows custom band combinations, indices, and classifications |

## 11. NOAA — `noaa` (LIVE)

| Field | Value |
|---|---|
| Endpoints | Multiple NOAA APIs: NCEI, Weather Service, GOES, NEXRAD, Storm Events |
| Auth | **None** — all data is public domain |
| License | **Public Domain** — U.S. Government work |
| Products | GOES-16/17/18 (weather satellite), JPSS (polar orbiting), NEXRAD (radar), Storm Events, Weather Observations, Coastal Data, Tides & Currents |
| Scope | Comprehensive environmental data for weather, climate, and disaster monitoring |
| Coverage | Global (GOES: Americas, JPSS: Global); real-time and historical data |
| Quality | Resolution: 500m-2km (GOES), 375m-750m (JPSS), 1km (NEXRAD) |

## 12. ECMWF — `ecmwf` (BLOCKED)

| Field | Value |
|---|---|
| Endpoint | `https://api.ecmwf.int/v1` (ECMWF Web API) + `https://cds.climate.copernicus.eu/` (CDS API) |
| **Blocked by** | `FIRSTLIGHT_ECMWF_API_KEY` — obtain from [ECMWF Web API](https://apps.ecmwf.int/webapi/) |
| License | **ECMWF License** — data provided by ECMWF; check specific dataset licenses |
| Product | ERA5/ERA5-Land (reanalysis), CAMS (atmosphere), Seasonal Forecasts, S2S Forecasts |
| Scope | Global numerical weather prediction and climate reanalysis data |
| Quality | Resolution: 31km (ERA5), 9km (ERA5-Land); temporal: hourly to monthly |
| Features | Comprehensive atmospheric, oceanic, and land surface parameters |

## 13. Twitter (X) — `twitter` (BLOCKED)

| Field | Value |
|---|---|
| Endpoint | `https://api.twitter.com/2/` (Twitter API v2) |
| **Blocked by** | `FIRSTLIGHT_TWITTER_BEARER_TOKEN` — obtain from [Twitter Developer Portal](https://developer.twitter.com/) |
| License | **Twitter API License** — requires review for commercial use; rate limits apply |
| Product | Tweets (with geolocation), User Information, Trending Topics |
| Scope | Real-time and historical social media data for situational awareness |
| Quality | Geolocated tweets provide ground-truth information during disasters |
| Features | Search by location, time, keywords; includes engagement metrics |

## 14. OSINT — `osint` (LIVE, Aggregator)

| Field | Value |
|---|---|
| Endpoints | Multiple OSINT sources: NewsAPI, arXiv, Government databases, Public records |
| Auth | Varies by source; some require API keys (NewsAPI) |
| License | **Mixed** — depends on underlying sources; all public domain or open licenses |
| Product | News Articles, Academic Publications, Government Reports, Public Records, Satellite Metadata |
| Scope | Aggregates multiple OSINT sources for comprehensive intelligence gathering |
| Features | Multi-source data fusion; temporal and spatial filtering |
| Coverage | Global; includes real-time and historical data |

## 15. DemoScenarioProvider — `demo-scenario-provider` (internal, labeled)

Not an external source: the retained procedural generator, isolated in Phase 0. Stamps `demo:{provider,simulated,seed,generatedAt}` on every dataset; refuses to run in operational mode without an explicit opt-in; every derived export/claim carries the `simulated` flag.

---

## Attribution obligations summary (rendered into every export)

- USGS: "U.S. Geological Survey Earthquake Hazards Program" (public domain)
- GloFAS/Open-Meteo: "GloFAS — Copernicus Emergency Management Service, redistributed by Open-Meteo.com under CC BY 4.0"
- NWS: "NOAA National Weather Service" (public domain)
- Copernicus: "Contains modified Copernicus Sentinel data [year], processed by ESA/ESrin"
- Planet: "Imagery © Planet Labs, Inc." (requires review)
- Maxar: "Imagery © Maxar Technologies" (requires review)
- Sentinel Hub: "Contains modified Copernicus Sentinel data" (free & open)
- NOAA: "Data provided by NOAA" (public domain)
- ECMWF: "Data provided by ECMWF" (check dataset license)
- Twitter: "Data provided by Twitter" (requires review)
- OSINT: "Data from public open sources" (mixed licenses)

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
