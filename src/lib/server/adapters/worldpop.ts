/* ==========================================================================
 * WorldPop gridded-population adapter (Phase 2 — contract + fixture).
 *
 * WorldPop rasters live on HDX / worldpop.org as large GeoTIFFs. Actually
 * intersecting them with hazard footprints is a raster workflow
 * (rasterio/rioxarray) belonging to the Python worker phase — deferred with
 * the imagery processing. What this adapter ships NOW, honestly:
 *  - a catalog-reference record for the correct dataset for the event's
 *    country (year, resolution, license, methodology, download URL),
 *  - fixture tests for the contract,
 *  - explicit 'reference' status — no fabricated population counts.
 *
 * Exposure numbers in sitreps continue to come from the labeled synthetic
 * layer (or future raster products) — never from a record like this one.
 * ========================================================================== */

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

const KNOWN = [
  { iso3: 'USA', year: 2020, resolutionM: 100, methodology: 'constrained top-down, UN-adjusted' },
  { iso3: 'TUR', year: 2020, resolutionM: 100, methodology: 'constrained top-down, UN-adjusted' },
  { iso3: 'KEN', year: 2020, resolutionM: 100, methodology: 'constrained top-down, UN-adjusted' },
] as const;

function license(): LicenseRecord {
  return {
    name: 'CC BY 4.0 — WorldPop',
    attribution: 'WorldPop, University of Southampton',
    url: 'https://www.worldpop.org/datacatalog/',
    requiresReview: false,
  };
}

function iso3For(country: string): string {
  const map: Record<string, string> = {
    'united states': 'USA',
    usa: 'USA',
    'türkiye': 'TUR',
    turkey: 'TUR',
    kenya: 'KEN',
  };
  return map[country.trim().toLowerCase()] ?? 'UNKNOWN';
}

export const worldPopAdapter: DataSourceAdapter = {
  id: 'worldpop',
  label: 'WorldPop — gridded population (catalog reference)',
  kind: 'exposure',
  health: 'fixtures-only',
  healthNote:
    'Catalog reference only: raster intersection is deferred to the Python worker phase. No population counts are fabricated; exposure estimates remain labeled.',
  license,

  async discover(req: DiscoveryRequest, deps: AdapterDeps = {}): Promise<DiscoveredAsset[]> {
    const country = String(req.params?.country ?? 'United States');
    const iso3 = iso3For(country);
    const dataset = KNOWN.find((k) => k.iso3 === iso3);
    if (!dataset) {
      // Unknown country → honest empty result, not a guessed dataset.
      return [];
    }
    const now = (deps.now ?? (() => new Date()))();
    return [
      {
        externalId: `worldpop:${iso3}:${dataset.year}:ppp:${dataset.resolutionM}m:UNadj`,
        title: `WorldPop ${iso3} ${dataset.year} — population count ${dataset.resolutionM} m (UN-adjusted)`,
        assetType: 'exposure.population',
        publishedAt: now.toISOString(),
        url: `https://www.worldpop.org/datacatalog/${iso3.toLowerCase()}/`,
        quality: {
          iso3,
          datasetYear: dataset.year,
          resolutionM: dataset.resolutionM,
          units: 'persons per pixel',
          methodology: dataset.methodology,
          uncertainty: 'model-based; treat as exposure estimate, not exact count',
          resampling: 'not resampled (raster intersection deferred)',
          productClass: 'catalog-reference',
        },
        geometry: undefined,
        license: license(),
        raw: { iso3, year: dataset.year },
      },
    ];
  },

  async acquire(_asset, dest): Promise<AcquiredAsset> {
    void dest;
    return { mode: 'reference', sizeBytes: 0, sha256: null };
  },

  async validate(asset, _acquired): Promise<ValidationReport> {
    const checks = [
      { name: 'product.class', ok: asset.quality.productClass === 'catalog-reference' },
      { name: 'year.present', ok: typeof asset.quality.datasetYear === 'number' },
      { name: 'units.present', ok: asset.quality.units === 'persons per pixel' },
      { name: 'uncertainty.labeled', ok: typeof asset.quality.uncertainty === 'string' },
    ];
    return { ok: checks.every((c) => c.ok), checks };
  },

  async normalize(asset, acquired, _ctx: ProcessingContext): Promise<NormalizedProduct[]> {
    return [
      {
        adapterId: 'worldpop',
        provider: 'WorldPop',
        assetType: 'exposure.population',
        externalId: asset.externalId,
        title: asset.title,
        acquiredAt: null,
        publishedAt: asset.publishedAt ? new Date(asset.publishedAt) : null,
        license: license().name,
        attribution: license().attribution,
        url: asset.url ?? null,
        checksumSha256: acquired.sha256,
        sizeBytes: acquired.sizeBytes || null,
        quality: asset.quality,
        geometry: asset.geometry ?? null,
        status: 'discovered',
        simulated: false,
      },
    ];
  },
};

export const WORLDPOP_KNOWN = KNOWN;
export const worldpopIso3ForTest = iso3For;
