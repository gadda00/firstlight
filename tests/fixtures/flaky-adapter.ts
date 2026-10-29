/* Flaky-provider fixture adapter: fails discover while `state.fails` is true,
 * succeeds afterwards — exercises the retry-after-failure ingestion path. */

import type { DataSourceAdapter } from '@/lib/server/adapters/types';
import { registerAdapter } from '@/lib/server/adapters/registry';

export function flakyFetchAdapter(state: { fails: boolean }): DataSourceAdapter {
  return {
    id: 'flaky-test',
    label: 'Flaky test adapter',
    kind: 'hazard',
    health: 'fixtures-only',
    healthNote: 'test fixture',
    license: () => ({ name: 'test', attribution: 'test' }),

    async discover(req) {
      if (state.fails) {
        throw new Error('provider temporarily unavailable (test)');
      }
      return [
        {
          externalId: 'flaky:ok-1',
          title: 'Flaky OK asset',
          assetType: 'hazard.fixture',
          acquiredAt: '2025-06-16T10:00:00Z',
          quality: { ok: true },
          geometry: { type: 'Point', coordinates: [req.aoi.lng, req.aoi.lat] },
          license: { name: 'test', attribution: 'test' },
        },
      ];
    },
    async acquire() {
      return { mode: 'reference' as const, sizeBytes: 0, sha256: null };
    },
    async validate(asset) {
      return { ok: true, checks: [{ name: 'ok', ok: true }] , ...{ detail: asset.externalId } };
    },
    async normalize(asset, acquired) {
      return [
        {
          adapterId: 'flaky-test',
          provider: 'FlakyTest',
          assetType: 'hazard.fixture',
          externalId: asset.externalId,
          title: asset.title,
          acquiredAt: new Date('2025-06-16T10:00:00Z'),
          publishedAt: null,
          license: 'test',
          attribution: 'test',
          url: null,
          checksumSha256: acquired.sha256,
          sizeBytes: null,
          quality: asset.quality,
          geometry: asset.geometry ?? null,
          status: 'validated',
          simulated: true,
        },
      ];
    },
  };
}

/** Local registration helper for dynamically-built adapters. */
export function registerAdapterLocal(adapter: DataSourceAdapter): void {
  registerAdapter(adapter);
}
