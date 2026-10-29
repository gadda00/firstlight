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

export const ADAPTERS: DataSourceAdapter[] = [
  usgsEarthquakeAdapter,
  openMeteoFloodAdapter,
  nwsAlertsAdapter,
  copernicusStacAdapter,
  firmsFireAdapter,
  osmOverpassAdapter,
  worldPopAdapter,
];

const byId = new Map(ADAPTERS.map((a) => [a.id, a]));

export function adapterById(id: string): DataSourceAdapter | undefined {
  return byId.get(id);
}

/** Test/extension hook: register an additional adapter (e.g. fixtures). */
export function registerAdapter(adapter: DataSourceAdapter): void {
  if (!byId.has(adapter.id)) {
    ADAPTERS.push(adapter);
    byId.set(adapter.id, adapter);
  }
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
