/* Slow-provider fixture adapter: discover sleeps `state.delayMs` and counts
 * calls — exercises lease/concurrency behavior without a network. */

import type { DataSourceAdapter } from '@/lib/server/adapters/types';
import { registerAdapter } from '@/lib/server/adapters/registry';

export interface SlowAdapterState {
  delayMs: number;
  discoverCalls: number;
}

export function slowAdapter(state: SlowAdapterState): DataSourceAdapter {
  return {
    id: 'slow-test',
    label: 'Slow test adapter',
    kind: 'hazard',
    health: 'fixtures-only',
    healthNote: 'test fixture (slow discover)',
    license: () => ({ name: 'test', attribution: 'test' }),

    async discover(req) {
      state.discoverCalls += 1;
      await new Promise((r) => setTimeout(r, state.delayMs));
      return [
        {
          externalId: 'slow:ok-1',
          title: 'Slow OK asset',
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
    async validate() {
      return { ok: true, checks: [{ name: 'ok', ok: true }] };
    },
    async normalize(asset, acquired) {
      return [
        {
          adapterId: 'slow-test',
          provider: 'SlowTest',
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

export function registerSlowAdapter(state: SlowAdapterState): void {
  registerAdapter(slowAdapter(state));
}
