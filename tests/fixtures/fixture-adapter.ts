/* Fixture-backed DataSourceAdapter for integration tests — no network. */

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
} from '@/lib/server/adapters/types';
import { registerAdapter } from '@/lib/server/adapters/registry';

function license(): LicenseRecord {
  return { name: 'fixture-license (no external rights)', attribution: 'Test Fixture' };
}

export const fixtureDemoAdapter: DataSourceAdapter = {
  id: 'fixture-demo',
  label: 'Fixture Demo Adapter (tests only)',
  kind: 'hazard',
  health: 'fixtures-only',
  healthNote: 'Deterministic fixture adapter for integration tests.',
  license,

  async discover(req: DiscoveryRequest, _deps: AdapterDeps = {}): Promise<DiscoveredAsset[]> {
    const n = typeof req.params?.n === 'number' ? Math.min(10, Math.max(0, req.params.n)) : 3;
    const out: DiscoveredAsset[] = [];
    for (let i = 0; i < n; i++) {
      out.push({
        externalId: `fixture:asset-${i}`,
        title: `Fixture asset ${i}`,
        assetType: 'hazard.fixture',
        acquiredAt: new Date('2025-06-16T10:00:00Z').toISOString(),
        publishedAt: new Date('2025-06-16T11:00:00Z').toISOString(),
        url: `https://fixture.test/a/${i}`,
        quality: { index: i, productClass: 'fixture' },
        geometry: { type: 'Point', coordinates: [req.aoi.lng + i * 0.001, req.aoi.lat] },
        license: license(),
        raw: { i },
      });
    }
    return out;
  },

  async acquire(_asset, dest: AcquireDestination): Promise<AcquiredAsset> {
    void dest;
    return { mode: 'reference', sizeBytes: 0, sha256: null };
  },

  async validate(asset, _acquired): Promise<ValidationReport> {
    return {
      ok: Boolean(asset.externalId && asset.geometry),
      checks: [
        { name: 'fixture.externalId', ok: Boolean(asset.externalId) },
        { name: 'fixture.geometry', ok: Boolean(asset.geometry) },
      ],
    };
  },

  async normalize(asset, acquired, _ctx: ProcessingContext): Promise<NormalizedProduct[]> {
    return [
      {
        adapterId: 'fixture-demo',
        provider: 'Fixture',
        assetType: 'hazard.fixture',
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
        simulated: true,
      },
    ];
  },
};

let registered = false;
export function registerFixtureAdapter(): void {
  if (registered) return;
  registerAdapter(fixtureDemoAdapter);
  registered = true;
}
