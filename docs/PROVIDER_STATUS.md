# Provider & source registry

> **Generated file** — from `src/lib/firstlight/provider-status.json` via `bun run scripts/render-provider-status.ts`. Do not hand-edit.
> Status vocabulary: live (adapter implemented, test-exercised) · blocked (credentials absent) · fixtures-only · catalog-only · candidate (research lead, access NOT verified) · not connected.
> A catalog listing is **not** an acquisition; a downloaded asset is **not** a processed product; no provider supplies a processed product to this project.
> **Deployment status:** No public operational deployment of FirstLight exists. The GitHub Pages site is a static simulated exercise; the operational mode is a locally-runnable, server-backed pilot only.

## Implemented adapters (local pilot)

_Last verified 2026-11-11 — statuses reflect code + tests in this repository, not the desired roadmap._

| Provider | Dataset | Pilot status | Public demo | Data role (honest) | License |
|---|---|---|---|---|---|
| USGS Earthquake Hazards Program |  earthquakes GeoJSON feed (event metadata only) | live | not connected | hazard metadata — earthquake magnitude/location/time; NOT building damage | USGS public domain (no restrictions) |
| NOAA National Weather Service |  alerts/v2 endpoint | live | not connected | official alert polygons/text — NOT damage assessment | U.S. Government public domain (no restrictions) |
| NOAA environmental data |  public data services (NOAA cornfield adapters) | live | not connected | hazard context | U.S. Government public domain (no restrictions) |
| Open-Meteo (GloFAS discharge) |  GloFAS-derived river discharge API | live | not connected | river discharge forecasts — NOT flood outlines | CC BY 4.0 (Open-Meteo) |
| Copernicus Data Space Ecosystem |  STAC catalog discovery for Sentinel-1/2 products | live (catalog only) | not connected | catalog metadata — listing is not an acquisition | Copernicus Sentinel data: free, full and open access under the Copernicus data licence / Data Space legal notice |
| OpenStreetMap via Overpass API |  bounded road/facility queries (AOI-limited) | live | not connected | road/facility context — passability is NEVER implied | ODbL 1.0 |
| OSINT aggregator |  open news/social/public-records feeds (fixture-backed in tests) | live (aggregated open feeds) | not connected | context leads — always unverified until corroborated | per-source; feed items carry their own terms |
| NASA FIRMS |  thermal anomalies (fire) API | blocked — requires free FIRSTLIGHT_FIRMS_TOKEN (MAP_TOKEN) | not connected | thermal anomalies — NOT confirmed fire perimeters | NASA open data |
| WorldPop |  UN-adjusted population grids | fixtures-only — raster intersection deferred | synthetic illustrative grid (clearly labeled, NOT WorldPop data) | population context (modelled estimates with vintage/uncertainty) | CC BY 4.0 |
| Planet Labs |  Planet APIs (SuperDove tasking/search) | blocked — requires FIRSTLIGHT_PLANET_API_KEY | not connected (demo sensor entries are illustrative metadata only) | high-resolution imagery (commercial) | commercial terms apply per contract |
| Maxar Open Data |  event-release imagery | blocked — requires FIRSTLIGHT_MAXAR_CLIENT_ID/SECRET | not connected (demo sensor entries are illustrative metadata only) | high-resolution event imagery | event-release terms — verify before derivative/commercial use |
| Sentinel Hub (Sinergise) |  processed Sentinel/Landsat/DEM via OGC APIs | blocked — requires FIRSTLIGHT_SENTINELHUB_CLIENT_ID/SECRET | not connected | raster processing services | commercial/subscription tiers |
| ECMWF |  open-data/forecast APIs | blocked — requires FIRSTLIGHT_ECMWF_API_KEY | not connected | weather/forecast context | ECMWF open data terms |
| X/Twitter API |  post/disaster keyword search | blocked — requires FIRSTLIGHT_TWITTER_BEARER_TOKEN | not connected | OSINT context only | X API terms |

## Researched candidates (NOT connected — access/terms not verified)

| Provider | Dataset | Status | Terms researched | Next owner action |
|---|---|---|---|---|
| Copernicus Data Space Ecosystem (assets) | Sentinel-1 SAR GRD, Sentinel-2 MSI L2A — asset download + processing | candidate — catalog discovery live; asset download/processing NOT implemented | Sentinel data free/full/open per Copernicus data licence; attribution 'contains modified Copernicus Sentinel data [year]'; registration required for API/OData access | Register account, verify OAuth client-credentials flow server-side, download one dated scene with checksum, then build raster pipeline seam |
| NASA OPERA via PO.DAAC/CMR | DSWx-S1 (30 m surface water from Sentinel-1), DSWx-HLS (from Landsat/S2) | candidate — not implemented | NASA open data; products contain modified Copernicus Sentinel data; access via Earthdata login + CMR/PO.DAAC | Earthdata account + CMR granule search for AOI/date; verify product docs for mask semantics; integrate as observed source layer |
| China NSMC Fengyun Data Portal | FY-series image/atmosphere/land/ocean/radiation/space-weather products | candidate — access not verified (account review + product order + FTP route not tested) | UNKNOWN until tested: registration review, product ordering, API/automation, quotas, retention, attribution, redistribution, commercial rights | Register, order one test product for an AOI/date, and seek written answers on API/automation, delivery, quotas, attribution and commercial rights; otherwise leave 'candidate / access not verified' |
| CNSA/CRESDA Gaofen international sharing | Gaofen series (moderate-resolution multispectral) | candidate — portal availability/product availability for AOI+date not verified | UNKNOWN until tested: account rules, bulk/API access, delivery timing, license/reuse rights, image metadata | Verify portal works, find products for a target AOI/date, test account + download route, and obtain written reuse terms; screening-only use (not building-level) |
| ISPRS benchmark datasets (e.g. Vaihingen) | aerial orthophotos + DSM + labels | candidate — discovery index only; per-dataset access/license must be checked | per-dataset: not all ISPRS-linked datasets share access or licensing | Pick one dataset page; verify bands, resolution, dates, label semantics and exact terms before any training use |
| xBD / xView2 | pre/post disaster imagery with building damage labels | candidate — research/training/retrospective evaluation only | CC BY-NC-SA 4.0 (non-commercial, share-alike); underlying imagery terms add further restrictions — a commercial-use gate | For any commercial path, replace with commercially-clear imagery/labels; benchmark scores are never event validation |
| Sen1Floods11 | Sentinel-1 + Sentinel-2 chips with surface-water labels | candidate — research/retrospective evaluation only; access/terms not re-verified from this repo | access and current terms must be re-verified before use | Re-verify current hosting, license, and split semantics before training/eval use |
| OpenAerialMap | community/UAV imagery per-asset | candidate — optional source-discovery layer | per-asset: acquisition date, footprint, resolution, license and availability vary per upload | Inspect each asset's date/footprint/resolution/license before use; skip assets without acceptable coverage/rights |
| EC GHSL | global human settlement layers | candidate — not implemented | EC/JRC open data with attribution | Verify current terms + AOI coverage before integrating |
| NASA GPM IMERG / CHIRPS | satellite precipitation estimates | candidate — not implemented | NASA open data / UCSB CHIRPS terms (verify before use) | Verify terms + latency + resolution; integrate as hazard context only |
