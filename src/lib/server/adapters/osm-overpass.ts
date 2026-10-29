/* ==========================================================================
 * OpenStreetMap Overpass adapter (Phase 2 — bounded + cached, live-capable).
 *
 * The transformation brief is explicit: never query public Overpass from
 * every browser. This adapter runs SERVER-SIDE ONLY, with:
 *  - a hard AOI cap (≤ 0.35° bbox — about a 30 km box) so pilot queries stay
 *    small and polite,
 *  - dedupe against the event's existing catalog records (idempotent
 *    ingestion) so repeated runs do not re-query the provider,
 *  - the required attribution (ODbL) on every record,
 *  - honest status: OSM completeness is uneven; facility operational status
 *    is UNKNOWN until confirmed — never silently 'operational'.
 *
 * Production refresh path (documented, deferred): Geofabrik/reglication
 * extracts loaded into PostGIS, or a managed provider.
 * ========================================================================== */

import { fetchJson } from './http-client';
import type {
  AcquiredAsset,
  AcquireDestination,
  AdapterDeps,
  DataSourceAdapter,
  DiscoveredAsset,
  DiscoveryRequest,
  GeoJSONGeometry,
  LicenseRecord,
  NormalizedProduct,
  ProcessingContext,
  ValidationReport,
} from './types';
import { aoiToBbox } from './types';

const HOSTS = ['overpass-api.de', 'overpass.kumi.systems'] as const;
const MAX_BBOX_DEG = 0.35;
const MAX_ELEMENTS = 500;

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

function license(): LicenseRecord {
  return {
    name: 'ODbL 1.0 — OpenStreetMap data',
    attribution: '© OpenStreetMap contributors (ODbL)',
    url: 'https://wiki.openstreetmap.org/wiki/Overpass_API',
    requiresReview: false,
  };
}

const FACILITY_MAP: Record<string, string> = {
  hospital: 'hospital',
  clinic: 'hospital',
  school: 'school',
  kindergarten: 'school',
  university: 'school',
  shelter: 'shelter',
  fire_station: 'fire_station',
  police: 'fire_station',
  water_works: 'water',
  water_tank: 'water',
  pumping_station: 'water',
  substation: 'power',
  plant: 'power',
};

function overpassQuery(bb: { west: number; south: number; east: number; north: number }): string {
  // Facilities + road skeleton for a bounded AOI. Deliberately minimal for
  // the pilot: full road-network ingest belongs to the PostGIS phase.
  const bbox = `${bb.south},${bb.west},${bb.north},${bb.east}`;
  return `[out:json][timeout:25][maxsize:10485760];(
    nwr["amenity"~"^(hospital|clinic|school|kindergarten|university|shelter|fire_station|police|community_centre)$"](${bbox});
    nwr["man_made"~"^(water_works|water_tank|pumping_station|reservoir_covered)$"](${bbox});
    nwr["power"~"^(substation|plant)$"](${bbox});
    way["highway"~"^(motorway|trunk|primary|secondary)$"](${bbox});
  );out center tags ${MAX_ELEMENTS};`;
}

function classify(tags: Record<string, string>): { type: string; name: string } | null {
  if (tags.amenity && FACILITY_MAP[tags.amenity]) {
    return { type: FACILITY_MAP[tags.amenity], name: tags.name ?? tags.amenity };
  }
  if (tags.man_made && FACILITY_MAP[tags.man_made]) {
    return { type: FACILITY_MAP[tags.man_made], name: tags.name ?? tags.man_made };
  }
  if (tags.power && FACILITY_MAP[tags.power]) {
    return { type: FACILITY_MAP[tags.power], name: tags.name ?? tags.power };
  }
  return null;
}

export const osmOverpassAdapter: DataSourceAdapter = {
  id: 'osm-overpass',
  label: 'OpenStreetMap — facilities & road skeleton (bounded Overpass query)',
  kind: 'roads',
  health: 'live',
  healthNote:
    'Server-side only, hard-bounded AOI, deduped by idempotent ingestion. Volunteer mapping is valuable but incomplete: facility status is UNKNOWN until confirmed. Production refresh = Geofabrik/replication into PostGIS.',
  license,

  async discover(req: DiscoveryRequest, deps: AdapterDeps = {}): Promise<DiscoveredAsset[]> {
    const bb = aoiToBbox(req.aoi);
    const bboxDeg = Math.max(bb.east - bb.west, bb.north - bb.south);
    if (bboxDeg > MAX_BBOX_DEG) {
      throw new Error(
        `OSM Overpass pilot cap: AOI bbox ${bboxDeg.toFixed(2)}° exceeds ${MAX_BBOX_DEG}°. Reduce the event AOI or use the PostGIS bulk-load path.`,
      );
    }
    const url = 'https://overpass-api.de/api/interpreter';
    const { data } = await fetchJson<OverpassResponse>(url, {
      allowedHosts: HOSTS,
      method: 'POST',
      body: `data=${encodeURIComponent(overpassQuery(bb))}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      timeoutMs: 30_000,
      correlationId: `osm:${req.eventId}`,
      fetchImpl: deps.fetchImpl,
    });
    const elements = Array.isArray(data.elements) ? data.elements : [];
    const assets: DiscoveredAsset[] = [];
    for (const el of elements) {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (typeof lat !== 'number' || typeof lng !== 'number') continue;
      const tags = el.tags ?? {};
      const facility = classify(tags);
      const isRoad = typeof tags.highway === 'string';
      if (!facility && !isRoad) continue;
      const geometry: GeoJSONGeometry = { type: 'Point', coordinates: [lng, lat] };
      assets.push({
        externalId: `osm:${el.type}/${el.id}`,
        title: facility
          ? `${facility.name} (${facility.type})`
          : `${tags.highway} ${el.type}/${el.id}`,
        assetType: facility ? 'roads.facility' : 'roads.osm',
        acquiredAt: undefined,
        publishedAt: undefined,
        quality: {
          osmType: el.type,
          osmId: el.id,
          osmVersion: tags['osm_version'] ?? null,
          facilityType: facility?.type ?? null,
          highwayClass: tags.highway ?? null,
          surface: tags.surface ?? null,
          bridge: tags.bridge ?? null,
          maxspeed: tags.maxspeed ?? null,
          /** Operational status is UNKNOWN until field-confirmed — the
           *  catalog must render "unknown", never "operational". */
          operationalStatus: 'unknown',
          sourceCompleteness: 'volunteer-mapped; completeness varies by region',
        },
        geometry,
        license: license(),
        raw: { id: el.id, type: el.type, tags },
      });
      if (assets.length >= MAX_ELEMENTS) break;
    }
    return assets;
  },

  async acquire(_asset, dest): Promise<AcquiredAsset> {
    void dest;
    return { mode: 'reference', sizeBytes: 0, sha256: null };
  },

  async validate(asset, _acquired): Promise<ValidationReport> {
    const checks = [
      {
        name: 'geometry.point',
        ok: asset.geometry?.type === 'Point',
      },
      {
        name: 'osm.id',
        ok: typeof asset.quality.osmId === 'number' && typeof asset.quality.osmType === 'string',
      },
      {
        name: 'attribution.odbl',
        ok: Boolean(asset.license.attribution?.includes('OpenStreetMap')),
      },
      {
        name: 'status.unknown_not_operational',
        ok: asset.quality.operationalStatus === 'unknown',
        detail: 'unconfirmed facilities must stay UNKNOWN, never silently operational',
      },
    ];
    return { ok: checks.every((c) => c.ok), checks };
  },

  async normalize(asset, acquired, _ctx: ProcessingContext): Promise<NormalizedProduct[]> {
    return [
      {
        adapterId: 'osm-overpass',
        provider: 'OpenStreetMap (Overpass API)',
        assetType: asset.assetType,
        externalId: asset.externalId,
        title: asset.title,
        acquiredAt: null,
        publishedAt: new Date(),
        license: license().name,
        attribution: license().attribution,
        url: null,
        checksumSha256: acquired.sha256,
        sizeBytes: acquired.sizeBytes || null,
        quality: asset.quality,
        geometry: asset.geometry ?? null,
        status: 'validated',
        simulated: false,
      },
    ];
  },
};

export const OSM_HOSTS = HOSTS;
export const OSM_MAX_BBOX_DEG = MAX_BBOX_DEG;
export const overpassQueryForTest = overpassQuery;
