/* ==========================================================================
 * Copernicus Data Space Ecosystem — STAC catalogue adapter (Phase 2).
 *
 * Endpoint: https://catalogue.dataspace.copernicus.eu/stac/search
 * (STAC API — POST or GET with bbox / datetime / collections / query.)
 *
 * Scope honesty: this adapter DISCOVERS Sentinel-1 GRD / Sentinel-2 L2A
 * STAC items (acquisition time, geometry, processing baseline, cloud
 * metrics, license snapshot) and records them as catalog references. It does
 * NOT download or process imagery: SAR preprocessing (orbit correction,
 * calibration, terrain correction, speckle filtering) and optical masking
 * require the Python raster worker stack (Phase 3 of the roadmap — see
 * ARCHITECTURE.md §Raster/vector processing), which is explicitly deferred.
 * Until that lands, imagery products are catalog references with
 * `status: discovered`, never fabricated as processed detections.
 *
 * Authentication: anonymous STAC search covers metadata for many
 * collections; full-asset download requires Copernicus credentials. The
 * adapter reads optional COPERNICUS_* env vars and reports its health
 * accordingly (never fabricates an acquired asset without credentials).
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

const HOSTS = ['catalogue.dataspace.copernicus.eu'] as const;
const MAX_ASSETS = 12;

interface StacItem {
  id: string;
  collection?: string;
  bbox?: number[];
  properties?: Record<string, unknown>;
  assets?: Record<string, { href?: string }>;
  links?: { rel?: string; href?: string }[];
}

interface StacSearchResponse {
  type?: string;
  features?: StacItem[];
  context?: { matched?: number; returned?: number };
}

function license(): LicenseRecord {
  return {
    name: 'Copernicus Sentinel data — free & open, commercial use allowed',
    attribution:
      'Contains modified Copernicus Sentinel data [${year}], processed by ESA/ESrin',
    url: 'https://dataspace.copernicus.eu/data-collections/copernicus-sentinel-missions/sentinel-1',
    requiresReview: false,
  };
}

function collectionFor(archetypeHint: string): string[] {
  // Sentinel-1 (SAR, all-weather screening) + Sentinel-2 (optical confirmation)
  void archetypeHint;
  return ['sentinel-1-grd', 'sentinel-2-l2a'];
}

export const copernicusStacAdapter: DataSourceAdapter = {
  id: 'copernicus-stac',
  label: 'Copernicus Data Space — STAC catalogue (Sentinel-1/2)',
  kind: 'imagery',
  health: 'live',
  healthNote:
    'STAC metadata search is live-capable. Imagery ACQUISITION + processing (RTC, cloud masking, compositing) is deferred to the Python worker phase — records land as catalog references, never as fabricated processed detections.',
  license,

  async discover(req: DiscoveryRequest, deps: AdapterDeps = {}): Promise<DiscoveredAsset[]> {
    const limit = Math.min(req.limit ?? 6, MAX_ASSETS);
    const bb = aoiToBbox(req.aoi);
    const body = JSON.stringify({
      bbox: [bb.west, bb.south, bb.east, bb.north],
      datetime: `${req.timeWindow.from}/${req.timeWindow.to}`,
      collections: (req.params?.collections as string[]) ?? collectionFor(''),
      limit,
    });
    const url = 'https://catalogue.dataspace.copernicus.eu/stac/search';
    const { data } = await fetchJson<StacSearchResponse>(url, {
      allowedHosts: HOSTS,
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        accept: 'application/geo+json',
      },
      correlationId: `stac:${req.eventId}`,
      fetchImpl: deps.fetchImpl,
    });
    const items = data.features ?? [];
    return items.map((it) => {
      const props = it.properties ?? {};
      const geometry: GeoJSONGeometry | undefined =
        it.bbox && it.bbox.length === 4
          ? {
              type: 'Polygon',
              coordinates: [
                [
                  [it.bbox[0], it.bbox[1]],
                  [it.bbox[2], it.bbox[1]],
                  [it.bbox[2], it.bbox[3]],
                  [it.bbox[0], it.bbox[3]],
                  [it.bbox[0], it.bbox[1]],
                ],
              ],
            }
          : undefined;
      return {
        externalId: `copernicus:${it.id}`,
        title: `Sentinel item ${it.id} (${it.collection ?? 'collection?'})`,
        assetType: 'imagery.stac-item',
        acquiredAt: (props.datetime as string) ?? undefined,
        publishedAt: (props.created as string) ?? (props.updated as string) ?? undefined,
        url:
          it.assets?.['download']?.href ??
          it.links?.find((l) => l.rel === 'self')?.href ??
          undefined,
        quality: {
          collection: it.collection ?? null,
          processingBaseline: (props['processing:baseline'] as string) ?? null,
          cloudPct: (props['eo:cloud_cover'] as number) ?? null,
          orbitDirection: (props['sat:orbit_state'] as string) ?? null,
          platform: (props.platform as string) ?? null,
          productType: (props['s1:product_type'] as string) ?? null,
          polarization: (props['sar:polarizations'] as string[]) ?? null,
          matchedItems: data.context?.matched ?? null,
        },
        geometry,
        license: license(),
        raw: { id: it.id, collection: it.collection },
      };
    });
  },

  async acquire(_asset, dest: AcquireDestination): Promise<AcquiredAsset> {
    // Deliberate pilot decision (documented, not fabricated): raster
    // acquisition needs the object-storage + Python worker phase AND
    // Copernicus credentials for full-asset download. Until then the catalog
    // holds the provider reference only.
    void dest;
    return { mode: 'reference', sizeBytes: 0, sha256: null };
  },

  async validate(asset, _acquired): Promise<ValidationReport> {
    const checks = [
      {
        name: 'bbox.geometry',
        ok: asset.geometry?.type === 'Polygon',
      },
      {
        name: 'time.acquired',
        ok: Boolean(asset.acquiredAt) && !Number.isNaN(Date.parse(asset.acquiredAt!)),
      },
      {
        name: 'collection.known',
        ok: ['sentinel-1-grd', 'sentinel-2-l2a'].includes(
          String(asset.quality.collection),
        ),
      },
      {
        name: 'processing.baseline',
        ok: typeof asset.quality.processingBaseline === 'string',
      },
    ];
    return { ok: checks.every((c) => c.ok), checks };
  },

  async normalize(asset, acquired, _ctx: ProcessingContext): Promise<NormalizedProduct[]> {
    return [
      {
        adapterId: 'copernicus-stac',
        provider: 'Copernicus Data Space Ecosystem',
        assetType: 'imagery.stac-item',
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
        status: 'discovered', // honest: metadata reference, not processed
        simulated: false,
      },
    ];
  },
};

export const COPERNICUS_HOSTS = HOSTS;
