# Capability matrix — what runs, where, with what data

> Companion to `docs/EVIDENCE_LEDGER.md`. Labels: **public demo** (GitHub Pages static site) · **local pilot** (runnable from this repo) · **real-data catalog** (genuine external metadata/assets ingested) · **processed product** (algorithm output derived from real rasters) · **validated output** (independently or field-validated). Only the first two exist; a catalog listing is never conflated with an acquisition.

| Capability | Public demo | Local pilot | Real-data catalog | Processed product | Validated output |
|---|---|---|---|---|---|
| Scenario generation (seeded, deterministic) | ✅ generated fiction | ✅ (labeled synthetic layer) | — | — | — |
| Basemap display (© OSM · Esri · CARTO) | ✅ real tiles | ✅ real tiles | (tiles only) | — | — |
| H3 res-8 zoning + need scores (uncertainty, sensitivity, missingness) | ✅ on generated data | ✅ server-authoritative | — | — | — |
| Route & isolation analysis | ✅ toy graph, tabletop | ✅ toy graph, labeled | — | — | — |
| Review queue | ✅ ephemeral (browser memory) | ✅ persisted, immutable decisions, versioned | — | — | — |
| Sitrep generation | ✅ synthetic-exercise report | ✅ grounded, two-person approval, claim freeze | — | — | — |
| Exports (GeoJSON/CSV/audit/bundle) | ✅ `simulated:true` stamped | ✅ checksummed, provenance-stamped | — | — | — |
| Demo integrity checksums (FNV-1a) | ✅ honestly non-cryptographic | — | — | — | — |
| SHA-256 audit chain | — | ✅ server workflow | — | — | — |
| Auth + RBAC + org isolation | — | ✅ (seeded tokens; OIDC seam documented) | — | — | — |
| Hazard metadata ingestion (USGS/NWS/Open-Meteo/OSM) | — | ✅ live adapters, test-pinned | ✅ catalog records only | — | — |
| Copernicus STAC discovery | — | ✅ metadata search | ✅ listings only — no asset acquired | — | — |
| Imagery asset download + validation | — | — | ❌ not implemented | — | — |
| Raster processing (SAR RTC, cloud mask, compositing) | — | ❌ worker reports `blocked_scaffold` | — | — | — |
| Damage/flood ML inference | — | ❌ no model exists | — | — | — |
| Affected-population model | ✅ synthetic illustrative grid | ✅ labeled heuristic v1/v2 (uncalibrated) | — | — | — |
| Field validation of any output | — | — | — | — | ❌ none exists anywhere |
| Public operational deployment | ❌ does not exist (static Pages only) | — | — | — | — |

**Reading rule:** a ✅ in "real-data catalog" means metadata is genuinely ingested and checksummed by a tested adapter — it does **not** mean imagery was acquired, processed, or validated. Every cell above is backed by the evidence cited in the ledger.
