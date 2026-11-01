/* ==========================================================================
 * FirstLight — adapter registry (Phase 2).
 *
 * Single lookup used by /api/meta (provider health surfaced to the UI) and
 * by the ingestion orchestrator. Adding a provider = implement the contract
 * + register here + document in DATA_SOURCES.md + fixture tests.
 * ========================================================================== */

import type { DataSourceAdapter } from './types';
import { usgsEarthquakeAdapter } from './usgs-earthquake';
import { openMeteoFloodAdapter } from './open-meteo-flood';
import { nwsAlertsAdapter } from './nws-alerts';
import { copernicusStacAdapter } from './copernicus-stac';
import { firmsFireAdapter } from './firms-fire';
import { osmOverpassAdapter } from './osm-overpass';
import { worldPopAdapter } from './worldpop';
import { planetAdapter } from './planet';
import { maxarAdapter } from './maxar';
import { sentinelHubAdapter } from './sentinel-hub';
import { noaaAdapter } from './noaa';
import { ecmwfAdapter } from './ecmwf';
import { twitterAdapter } from './twitter';
import { osintAdapter } from './osint';

export const ADAPTERS: DataSourceAdapter[] = [
  usgsEarthquakeAdapter,
  openMeteoFloodAdapter,
  nwsAlertsAdapter,
  copernicusStacAdapter,
  firmsFireAdapter,
  osmOverpassAdapter,
  worldPopAdapter,
  planetAdapter,
  maxarAdapter,
  sentinelHubAdapter,
  noaaAdapter,
  ecmwfAdapter,
  twitterAdapter,
  osintAdapter,
];

const byId = new Map(ADAPTERS.map((a) => [a.id, a]));

export function adapterById(id: string): DataSourceAdapter | undefined {
  return byId.get(id);
}

/** Test/extension hook: register an additional adapter (e.g. fixtures).
 *  Idempotent by id — an already-registered id is left untouched. */
export function registerAdapter(adapter: DataSourceAdapter): void {
  if (!byId.has(adapter.id)) {
    ADAPTERS.push(adapter);
    byId.set(adapter.id, adapter);
  }
}

/** Test hook: install/REPLACE a registered adapter by id. Test files run in
 *  one process and share this registry — without replacement, a fixture
 *  registered by an earlier file silently wins and later files test the
 *  WRONG instance. Production code must never call this. */
export function replaceAdapter(adapter: DataSourceAdapter): void {
  const idx = ADAPTERS.findIndex((a) => a.id === adapter.id);
  if (idx >= 0) ADAPTERS[idx] = adapter;
  else ADAPTERS.push(adapter);
  byId.set(adapter.id, adapter);
}

export function providerManifest() {
  return ADAPTERS.map((a) => ({
    id: a.id,
    label: a.label,
    kind: a.kind,
    health: a.health,
    healthNote: a.healthNote,
    license: a.license().name,
  }));
}
