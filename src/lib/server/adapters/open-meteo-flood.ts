/* ==========================================================================
 * Open-Meteo Global Flood API adapter (Phase 2 — live-capable, keyless).
 *
 * Endpoint: https://flood-api.open-meteo.com/v1/flood (GloFAS-backed
 * discharge reanalysis + forecast, redistributed by Open-Meteo under CC BY 4.0).
 *
 * Scope honesty: this is a RIVER DISCHARGE FORECAST product — "forecast
 * risk", never an observed flood polygon and never a depth estimate. The
 * transformation brief's four-way distinction (forecast risk / observed
 * water / inferred impact / confirmed field report) is encoded in the asset
 * type and quality metrics so the catalog and sitreps cannot conflate them.
 * ========================================================================== */

import { fetchJson } from './http-client';
import type {
  AcquiredAsset,
  AcquireDestination,
  AdapterDeps,
  DataSourceAdapter,
  DiscoveredAsset,
  DiscoveryRequest,
  LicenseRecord,
  NormalizedProduct,
  ProcessingContext,
  ValidationReport,
} from './types';

const HOSTS = ['flood-api.open-meteo.com'] as const;

interface OpenMeteoFloodResponse {
  latitude: number;
  longitude: number;
  daily: {
    time: string[];
    river_discharge?: number[];
    river_discharge_median?: number[];
    river_discharge_max?: number[];
    river_discharge_min?: number[];
  };
}

function license(): LicenseRecord {
  return {
    name: 'CC BY 4.0 (Open-Meteo redistribution of GloFAS data)',
    attribution:
      'GloFAS — Copernicus Emergency Management Service, redistributed by Open-Meteo.com under CC BY 4.0',
    url: 'https://open-meteo.com/en/docs/flood-api',
  };
}

export const openMeteoFloodAdapter: DataSourceAdapter = {
  id: 'open-meteo-flood',
  label: 'Open-Meteo Global Flood API (GloFAS discharge)',
  kind: 'hazard',
  health: 'live',
  healthNote:
    'Keyless API with generous limits for pilot use. Returns river discharge forecast series — forecast-risk evidence only, never a flood polygon or depth.',
  license,

  async discover(req: DiscoveryRequest, deps: AdapterDeps = {}): Promise<DiscoveredAsset[]> {
    const days = Math.min(
      30,
      typeof req.params?.forecastDays === 'number' ? req.params.forecastDays : 7,
    );
    const params = new URLSearchParams({
      latitude: String(req.aoi.lat),
      longitude: String(req.aoi.lng),
      daily: 'river_discharge,river_discharge_max,river_discharge_median,river_discharge_min',
      forecast_days: String(days),
      timezone: 'UTC',
    });
    const url = `https://flood-api.open-meteo.com/v1/flood?${params.toString()}`;
    const { data } = await fetchJson<OpenMeteoFloodResponse>(url, {
      allowedHosts: HOSTS,
      correlationId: `flood:${req.eventId}`,
      fetchImpl: deps.fetchImpl,
    });
    if (typeof data.latitude !== 'number' || !data.daily || !Array.isArray(data.daily.time)) {
      throw new Error('Open-Meteo flood: unexpected response shape');
    }
    const series = data.daily.river_discharge ?? [];
    if (!series.length) {
      return []; // grid cell with no river — an honest empty result
    }
    const max = Math.max(...series);
    const min = Math.min(...series);
    const peakDay = data.daily.time[series.indexOf(max)];
    return [
      {
        externalId: `openmeteo-flood:${data.latitude.toFixed(4)},${data.longitude.toFixed(4)}:${peakDay}`,
        title: `GloFAS discharge forecast — river cell ${data.latitude.toFixed(3)},${data.longitude.toFixed(3)}`,
        assetType: 'hazard.flood-forecast',
        publishedAt: new Date().toISOString(),
        url: `https://flood-api.open-meteo.com/v1/flood?latitude=${data.latitude}&longitude=${data.longitude}`,
        quality: {
          productClass: 'forecast-risk', // NEVER labeled observed water
          units: 'm³/s',
          forecastDays: series.length,
          peakDischargeM3s: Number(max.toFixed(3)),
          minDischargeM3s: Number(min.toFixed(3)),
          peakValidTime: peakDay,
          ensembleMedianAtPeak:
            data.daily.river_discharge_median?.[series.indexOf(max)] ?? null,
          ensembleMaxAtPeak:
            data.daily.river_discharge_max?.[series.indexOf(max)] ?? null,
          ensembleMinAtPeak:
            data.daily.river_discharge_min?.[series.indexOf(max)] ?? null,
        },
        geometry: { type: 'Point', coordinates: [data.longitude, data.latitude] },
        license: license(),
        raw: {
          latitude: data.latitude,
          longitude: data.longitude,
          seriesLength: series.length,
          peak: max,
        },
      },
    ];
  },

  async acquire(asset, dest: AcquireDestination, deps: AdapterDeps = {}): Promise<AcquiredAsset> {
    if (dest.mode === 'reference' || !asset.url) {
      return { mode: 'reference', sizeBytes: 0, sha256: null };
    }
    const { fetched } = await fetchJson<unknown>(asset.url, {
      allowedHosts: HOSTS,
      maxBytes: dest.maxBytes,
      correlationId: `flood-acquire:${asset.externalId}`,
      fetchImpl: deps.fetchImpl,
    });
    return { mode: 'buffer', sizeBytes: fetched.bytes, sha256: fetched.sha256 };
  },

  async validate(asset, acquired): Promise<ValidationReport> {
    const checks = [
      {
        name: 'product.class',
        ok: asset.quality.productClass === 'forecast-risk',
        detail: 'discharge forecasts must be labeled forecast-risk',
      },
      { name: 'units.present', ok: asset.quality.units === 'm³/s' },
      {
        name: 'series.nonempty',
        ok: Number(asset.quality.forecastDays) > 0,
      },
      {
        name: 'peak.finite',
        ok:
          typeof asset.quality.peakDischargeM3s === 'number' &&
          Number.isFinite(asset.quality.peakDischargeM3s),
      },
      {
        name: 'integrity.checksum',
        ok: acquired.mode === 'reference' ? true : Boolean(acquired.sha256),
      },
    ];
    return { ok: checks.every((c) => c.ok), checks };
  },

  async normalize(asset, acquired, _ctx: ProcessingContext): Promise<NormalizedProduct[]> {
    return [
      {
        adapterId: 'open-meteo-flood',
        provider: 'Open-Meteo (GloFAS)',
        assetType: 'hazard.flood-forecast',
        externalId: asset.externalId,
        title: asset.title,
        acquiredAt: asset.acquiredAt ? new Date(asset.acquiredAt) : null,
        publishedAt: asset.publishedAt ? new Date(asset.publishedAt) : null,
        license: license().name,
        attribution: license().attribution,
        url: asset.url ?? null,
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

export const OPEN_METEO_HOSTS = HOSTS;
