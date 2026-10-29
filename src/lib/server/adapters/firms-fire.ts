/* ==========================================================================
 * NASA FIRMS fire-hotspot adapter (Phase 2 — contract + fixtures, BLOCKED).
 *
 * Endpoint: https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_TOKEN}/…
 * Requires a server-side MAP_TOKEN issued by NASA FIRMS — there is no
 * keyless mode. This adapter implements the full contract and ships fixture
 * tests, and reports itself as BLOCKED until FIRSTLIGHT_FIRMS_TOKEN is set.
 * Per the transformation brief: "Do not fabricate successful external
 * integrations… label the capability as blocked by an explicit dependency."
 *
 * Scope honesty: hotspots are POINT detections of thermal anomaly. They are
 * never fire perimeters and never confirmed building damage.
 * ========================================================================== */

import { resilientFetch } from './http-client';
import {
  aoiToBbox,
  BlockedDependencyError,
  type AcquiredAsset,
  type AcquireDestination,
  type AdapterDeps,
  type DataSourceAdapter,
  type DiscoveredAsset,
  type DiscoveryRequest,
  type LicenseRecord,
  type NormalizedProduct,
  type ProcessingContext,
  type ValidationReport,
} from './types';

const HOSTS = ['firms.modaps.eosdis.nasa.gov'] as const;
const MAX_ASSETS = 200;
const ENV_TOKEN = 'FIRSTLIGHT_FIRMS_TOKEN';

interface FirmsRow {
  latitude: number;
  longitude: number;
  brightTi31?: number;
  acqDate: string;
  acqTime: string;
  satellite: string;
  confidence: string;
  frp?: number;
  dayNight: 'D' | 'N';
}

function license(): LicenseRecord {
  return {
    name: 'NASA FIRMS — free use with attribution (see provider terms)',
    attribution: 'NASA FIRMS (LANCE/EOSDIS MODIS & VIIRS near-real-time hotspots)',
    url: 'https://firms.modaps.eosdis.nasa.gov/content/academy/data_api/firms_api_use.html',
    requiresReview: true,
  };
}

function parseFirmsCsv(csv: string): FirmsRow[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim());
  const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iLat = idx('latitude');
  const iLng = idx('longitude');
  const iDate = idx('acq_date');
  const iTime = idx('acq_time');
  const iSat = idx('satellite');
  const iConf = idx('confidence');
  const iDay = idx('daynight');
  const iFrp = idx('frp');
  const rows: FirmsRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const lat = Number(cells[iLat]);
    const lng = Number(cells[iLng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    rows.push({
      latitude: lat,
      longitude: lng,
      acqDate: cells[iDate] ?? '',
      acqTime: cells[iTime] ?? '',
      satellite: cells[iSat] ?? '',
      confidence: cells[iConf] ?? '',
      dayNight: (cells[iDay] as 'D' | 'N') ?? 'D',
      frp: iFrp >= 0 ? Number(cells[iFrp]) : undefined,
    });
  }
  return rows;
}

export const firmsFireAdapter: DataSourceAdapter = {
  id: 'firms-fire',
  label: 'NASA FIRMS — VIIRS/MODIS active fire hotspots',
  kind: 'hazard',
  health: 'blocked',
  healthNote:
    'BLOCKED by missing dependency: FIRSTLIGHT_FIRMS_TOKEN (server-side NASA FIRMS MAP_TOKEN). Contract + fixture tests ship; the capability stays disabled rather than simulated.',
  license,

  async discover(req: DiscoveryRequest, deps: AdapterDeps = {}): Promise<DiscoveredAsset[]> {
    const token = process.env[ENV_TOKEN];
    if (!token || !token.trim()) {
      throw new BlockedDependencyError(
        'firms-fire',
        ENV_TOKEN,
        'Request a MAP_TOKEN from NASA FIRMS (free) and set it in the server environment. See DATA_SOURCES.md.',
      );
    }
    const bb = aoiToBbox(req.aoi);
    const limit = Math.min(req.limit ?? 50, MAX_ASSETS);
    const url =
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(token)}` +
      `/VIIRS_SNPP_NRT/${bb.west},${bb.south},${bb.east},${bb.north}/1`;
    const fetched = await resilientFetch(url, {
      allowedHosts: HOSTS,
      expectedContentType: 'csv',
      correlationId: `firms:${req.eventId}`,
      fetchImpl: deps.fetchImpl,
    });
    const rows = parseFirmsCsv(fetched.text);
    return rows.slice(0, limit).map((r, i) => ({
      externalId: `firms:${r.satellite}:${r.acqDate}:${r.acqTime}:${r.latitude.toFixed(4)},${r.longitude.toFixed(4)}:${i}`,
      title: `Fire hotspot — ${r.satellite} ${r.acqDate} ${r.acqTime}UTC`,
      assetType: 'hazard.fire-hotspot',
      acquiredAt: `${r.acqDate}T${r.acqTime.padStart(4, '0').slice(0, 2)}:${r.acqTime.padStart(4, '0').slice(2, 4)}:00Z`,
      quality: {
        sensor: r.satellite,
        confidence: r.confidence,
        frpMw: r.frp ?? null,
        dayNight: r.dayNight,
        productClass: 'thermal-anomaly-point', // never a fire perimeter
      },
      geometry: { type: 'Point' as const, coordinates: [r.longitude, r.latitude] },
      license: license(),
      raw: { latitude: r.latitude, longitude: r.longitude, confidence: r.confidence },
    }));
  },

  async acquire(_asset, dest): Promise<AcquiredAsset> {
    void dest;
    return { mode: 'reference', sizeBytes: 0, sha256: null };
  },

  async validate(asset, _acquired): Promise<ValidationReport> {
    const checks = [
      {
        name: 'product.class',
        ok: asset.quality.productClass === 'thermal-anomaly-point',
      },
      { name: 'sensor.present', ok: typeof asset.quality.sensor === 'string' },
      {
        name: 'time.acquired',
        ok: Boolean(asset.acquiredAt) && !Number.isNaN(Date.parse(asset.acquiredAt!)),
      },
    ];
    return { ok: checks.every((c) => c.ok), checks };
  },

  async normalize(asset, acquired, _ctx: ProcessingContext): Promise<NormalizedProduct[]> {
    return [
      {
        adapterId: 'firms-fire',
        provider: 'NASA FIRMS',
        assetType: 'hazard.fire-hotspot',
        externalId: asset.externalId,
        title: asset.title,
        acquiredAt: asset.acquiredAt ? new Date(asset.acquiredAt) : null,
        publishedAt: null,
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

export const FIRMS_HOSTS = HOSTS;
export const FIRMS_ENV_TOKEN = ENV_TOKEN;
export const parseFirmsCsvForTest = parseFirmsCsv; // fixture tests
