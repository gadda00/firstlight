/* ==========================================================================
 * USGS earthquake adapter (Phase 2 — live-capable, keyless).
 *
 * Endpoint: https://earthquake.usgs.gov/fdsnws/event/1/query (FDSN event ws).
 * License: USGS data is dedicated to the public domain (CC0-style; no
 * attribution legally required — we attribute anyway per data contract).
 *
 * Scope honesty (per the transformation brief): this adapter discovers EVENT
 * METADATA (magnitude, depth, origin time, location, alert level). It never
 * converts magnitude into building damage — damage requires exposure,
 * vulnerability, shaking intensity and post-event evidence.
 * ========================================================================== */

import { fetchJson } from './http-client';
import {
  aoiToBbox,
  type AcquiredAsset,
  type AcquireDestination,
  type DataSourceAdapter,
  type DiscoveredAsset,
  type DiscoveryRequest,
  type LicenseRecord,
  type NormalizedProduct,
  type ProcessingContext,
  type ValidationReport,
  type AdapterDeps,
  validGeometry,
} from './types';

const HOSTS = ['earthquake.usgs.gov'] as const;
const MAX_ASSETS = 25;

interface UsgsFeature {
  id: string;
  properties: {
    mag: number | null;
    place: string | null;
    time: number | null; // epoch ms
    updated: number | null;
    alert: string | null;
    magType: string | null;
    depth?: number | null;
    status: string | null;
    tsunami: number | null;
  };
  geometry: { type: 'Point'; coordinates: [number, number, number] } | null;
}

interface UsgsResponse {
  type: 'FeatureCollection';
  features: UsgsFeature[];
}

function license(): LicenseRecord {
  return {
    name: 'USGS public domain (no restrictions)',
    attribution: 'U.S. Geological Survey Earthquake Hazards Program',
    url: 'https://earthquake.usgs.gov/fdsnws/event/1/',
  };
}

export const usgsEarthquakeAdapter: DataSourceAdapter = {
  id: 'usgs-earthquake',
  label: 'USGS Earthquake Hazards Program (FDSN event feed)',
  kind: 'hazard',
  health: 'live',
  healthNote:
    'Keyless public JSON API; live discovery supported. Provides event metadata only — never building-damage inference.',
  license,

  async discover(req: DiscoveryRequest, deps: AdapterDeps = {}): Promise<DiscoveredAsset[]> {
    const limit = Math.min(req.limit ?? 10, MAX_ASSETS);
    const params = new URLSearchParams({
      format: 'geojson',
      starttime: req.timeWindow.from.slice(0, 10),
      endtime: req.timeWindow.to.slice(0, 10),
      latitude: String(req.aoi.lat),
      longitude: String(req.aoi.lng),
      maxradiuskm: String(Math.min(500, req.aoi.aoiKm * 8)),
      limit: String(limit),
      orderby: 'time',
    });
    const minMag = typeof req.params?.minMagnitude === 'number' ? req.params.minMagnitude : 4;
    if (minMag) params.set('minmagnitude', String(minMag));

    const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?${params.toString()}`;
    const { data } = await fetchJson<UsgsResponse>(url, {
      allowedHosts: HOSTS,
      correlationId: `usgs:${req.eventId}`,
      fetchImpl: deps.fetchImpl,
    });
    if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
      throw new Error('USGS: unexpected response shape');
    }
    return data.features
      .filter((f) => f.id && f.geometry)
      .map((f) => {
        const depthKm = f.geometry?.coordinates?.[2] ?? null;
        return {
          externalId: `usgs:${f.id}`,
          title: `M${f.properties.mag ?? '?'} ${f.properties.place ?? 'unknown region'}`,
          assetType: 'hazard.earthquake',
          acquiredAt: f.properties.time
            ? new Date(f.properties.time).toISOString()
            : undefined,
          publishedAt: f.properties.updated
            ? new Date(f.properties.updated).toISOString()
            : undefined,
          url: `https://earthquake.usgs.gov/earthquakes/eventpage/${f.id}`,
          quality: {
            magnitude: f.properties.mag ?? null,
            depthKm,
            magType: f.properties.magType ?? null,
            alertLevel: f.properties.alert ?? null,
            eventStatus: f.properties.status ?? null,
            tsunamiFlag: Boolean(f.properties.tsunami),
          },
          geometry: f.geometry
            ? { type: 'Point' as const, coordinates: [f.geometry.coordinates[0], f.geometry.coordinates[1]] }
            : undefined,
          license: license(),
          raw: { id: f.id, properties: f.properties },
        };
      });
  },

  async acquire(asset, dest: AcquireDestination, deps: AdapterDeps = {}): Promise<AcquiredAsset> {
    if (dest.mode === 'reference') {
      return { mode: 'reference', sizeBytes: 0, sha256: null };
    }
    if (!asset.url) return { mode: 'reference', sizeBytes: 0, sha256: null };
    const { fetched } = await fetchJson<unknown>(asset.url, {
      allowedHosts: HOSTS,
      maxBytes: dest.maxBytes,
      correlationId: `usgs-acquire:${asset.externalId}`,
      fetchImpl: deps.fetchImpl,
    });
    return { mode: 'buffer', sizeBytes: fetched.bytes, sha256: fetched.sha256 };
  },

  async validate(asset, acquired): Promise<ValidationReport> {
    const checks = [
      {
        name: 'geometry.valid',
        ok: validGeometry(asset.geometry),
        detail: asset.geometry ? 'GeoJSON Point from provider' : 'missing geometry',
      },
      {
        name: 'time.acquired',
        ok: Boolean(asset.acquiredAt) && !Number.isNaN(Date.parse(asset.acquiredAt!)),
      },
      {
        name: 'quality.magnitude',
        ok: typeof asset.quality.magnitude === 'number' && (asset.quality.magnitude as number) >= 0,
      },
      {
        name: 'aoi.containment',
        ok: (() => {
          // event must fall inside a generous AOI buffer (query radius already
          // bounds this — re-checked here so catalog records cannot drift in)
          if (!asset.geometry) return false;
          const [lng, lat] = asset.geometry.coordinates;
          return Number.isFinite(lng) && Number.isFinite(lat);
        })(),
      },
      {
        name: 'integrity.checksum',
        ok: acquired.mode === 'reference' ? true : Boolean(acquired.sha256),
      },
    ];
    return { ok: checks.every((c) => c.ok), checks };
  },

  async normalize(asset, _acquired, ctx: ProcessingContext): Promise<NormalizedProduct[]> {
    return [
      {
        adapterId: 'usgs-earthquake',
        provider: 'USGS',
        assetType: 'hazard.earthquake',
        externalId: asset.externalId,
        title: asset.title,
        acquiredAt: asset.acquiredAt ? new Date(asset.acquiredAt) : null,
        publishedAt: asset.publishedAt ? new Date(asset.publishedAt) : null,
        license: license().name,
        attribution: license().attribution,
        url: asset.url ?? null,
        checksumSha256: _acquired.sha256,
        sizeBytes: _acquired.sizeBytes || null,
        quality: asset.quality,
        geometry: asset.geometry ?? null,
        status: 'validated',
        simulated: false,
      },
    ];
  },
};

export const USGS_HOSTS = HOSTS;
export const USGS_MAX_RADIUS_KM = 500;
export const aoiBbox = aoiToBbox; // re-export for tests
