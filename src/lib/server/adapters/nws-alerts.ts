/* ==========================================================================
 * NOAA / NWS active-alerts adapter (Phase 2 — live-capable, keyless).
 *
 * Endpoint: https://api.weather.gov/alerts/active?point=lat,lng
 * License: U.S. Government work — public domain; NWS requires a
 * User-Agent identifying the application (set below).
 *
 * Scope: standards-based CAP-style alert metadata (issuer, severity,
 * urgency, certainty, area description, expiry). Alerts are ADVISORY
 * metadata — not hazard footprints for damage inference.
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

const HOSTS = ['api.weather.gov'] as const;
const USER_AGENT =
  'FirstLight-disaster-intelligence/2.2 (open-data pilot; contact: ops@firstlight.example)';
const MAX_ASSETS = 20;

interface NwsAlert {
  id: string; // IRI
  geometry: unknown | null;
  properties: {
    event?: string;
    headline?: string;
    description?: string;
    severity?: string;
    certainty?: string;
    urgency?: string;
    areaDesc?: string;
    senderName?: string;
    sent?: string;
    effective?: string;
    expires?: string;
    status?: string;
    messageType?: string;
  };
}

interface NwsAlertsResponse {
  features: { properties: NwsAlert['properties']; id: string; geometry: NwsAlert['geometry'] }[];
}

function license(): LicenseRecord {
  return {
    name: 'U.S. Government work — public domain (NWS)',
    attribution: 'NOAA National Weather Service',
    url: 'https://www.weather.gov/documentation/services-web-api',
  };
}

function severityRank(s: string | undefined): number {
  switch (s) {
    case 'Extreme':
      return 4;
    case 'Severe':
      return 3;
    case 'Moderate':
      return 2;
    case 'Minor':
      return 1;
    default:
      return 0;
  }
}

export const nwsAlertsAdapter: DataSourceAdapter = {
  id: 'nws-alerts',
  label: 'NOAA National Weather Service — active alerts (CAP metadata)',
  kind: 'alert',
  health: 'live',
  healthNote:
    'Keyless; US coverage only. Provider abstraction exists so national met agencies / EMSC can be added for other regions.',
  license,

  async discover(req: DiscoveryRequest, deps: AdapterDeps = {}): Promise<DiscoveredAsset[]> {
    const limit = Math.min(req.limit ?? 10, MAX_ASSETS);
    // NOTE: api.weather.gov/alerts/active does NOT accept a `limit` query
    // parameter (it paginates via Link headers) — passing one returns 400.
    const url = `https://api.weather.gov/alerts/active?point=${req.aoi.lat},${req.aoi.lng}`;
    const { data } = await fetchJson<NwsAlertsResponse>(url, {
      allowedHosts: HOSTS,
      headers: { 'user-agent': USER_AGENT, accept: 'application/geo+json' },
      correlationId: `nws:${req.eventId}`,
      fetchImpl: deps.fetchImpl,
    });
    if (!data || !Array.isArray(data.features)) {
      throw new Error('NWS: unexpected response shape');
    }
    return data.features.slice(0, limit).map((f) => {
      const p = f.properties;
      return {
        externalId: `nws:${f.id}`,
        title: p.headline ?? p.event ?? 'NWS alert',
        assetType: 'alert.cap',
        acquiredAt: p.sent ?? p.effective,
        publishedAt: p.effective ?? p.sent,
        url: typeof f.id === 'string' ? f.id : undefined,
        quality: {
          event: p.event ?? null,
          severity: p.severity ?? null,
          severityRank: severityRank(p.severity),
          certainty: p.certainty ?? null,
          urgency: p.urgency ?? null,
          areaDesc: p.areaDesc ?? null,
          issuer: p.senderName ?? null,
          expires: p.expires ?? null,
          messageType: p.messageType ?? null,
        },
        geometry: undefined,
        license: license(),
        raw: { id: f.id, event: p.event, severity: p.severity, areaDesc: p.areaDesc },
      };
    });
  },

  async acquire(_asset, dest): Promise<AcquiredAsset> {
    // Alert metadata is tiny and already fetched by discover; reference mode.
    void dest;
    return { mode: 'reference', sizeBytes: 0, sha256: null };
  },

  async validate(asset, _acquired): Promise<ValidationReport> {
    const checks = [
      { name: 'severity.present', ok: typeof asset.quality.severity === 'string' },
      { name: 'issuer.present', ok: typeof asset.quality.issuer === 'string' },
      {
        name: 'time.effective',
        ok: Boolean(asset.acquiredAt) && !Number.isNaN(Date.parse(asset.acquiredAt!)),
      },
      {
        name: 'expiry.future_or_relevant',
        ok: (() => {
          const exp = asset.quality.expires as string | null | undefined;
          if (!exp) return true; // open-ended alerts are valid
          return !Number.isNaN(Date.parse(exp));
        })(),
      },
    ];
    return { ok: checks.every((c) => c.ok), checks };
  },

  async normalize(asset, acquired, _ctx: ProcessingContext): Promise<NormalizedProduct[]> {
    return [
      {
        adapterId: 'nws-alerts',
        provider: 'NOAA NWS',
        assetType: 'alert.cap',
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

export const NWS_HOSTS = HOSTS;
export const NWS_USER_AGENT = USER_AGENT;
export const nwsSeverityRank = severityRank;
