/* Registry import coverage — the compile-time + load-time safety net.
 *
 * The round3 regression was seven adapters importing a non-existent
 * `httpClient` export: the production build caught it only at bundling and
 * integration tests failed at runtime with a module-resolution error. This
 * file pins that failure mode:
 *
 *  1. importing ADAPTERS forces the full adapter module graph to LOAD —
 *     a missing named export fails this file immediately (and `tsc` flags
 *     it at compile time);
 *  2. every registered adapter must satisfy the DataSourceAdapter contract
 *     invariants (unique id, honest health, callable lifecycle methods);
 *  3. adapters whose provider dependency is unconfigured must fail with
 *     BlockedDependencyError — never fabricate results.
 */

import { describe, expect, test } from 'bun:test';
import { ADAPTERS, adapterById, providerManifest } from '@/lib/server/adapters/registry';
import { BlockedDependencyError } from '@/lib/server/adapters/types';
import type { DataSourceAdapter } from '@/lib/server/adapters/types';

const AOI = { lat: 41.977, lng: -91.665, aoiKm: 9 };
const WINDOW = { from: '2025-06-01T00:00:00Z', to: '2025-06-30T00:00:00Z' };

describe('adapter registry — import coverage (round3 regression guard)', () => {
  test('all 14 registered adapters load through the registry module graph', () => {
    expect(ADAPTERS.length).toBeGreaterThanOrEqual(14);
  });

  test('every registered adapter has a unique id', () => {
    const ids = ADAPTERS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every adapter satisfies the contract invariants', () => {
    for (const a of ADAPTERS as DataSourceAdapter[]) {
      expect(a.id).toBeTruthy();
      expect(a.label).toBeTruthy();
      expect(['hazard', 'imagery', 'exposure', 'roads', 'alert', 'weather', 'osint', 'synthetic']).toContain(a.kind);
      expect(['live', 'fixtures-only', 'blocked']).toContain(a.health);
      expect(a.healthNote).toBeTruthy();

      expect(typeof a.license).toBe('function');
      const lic = a.license();
      expect(lic.name).toBeTruthy();
      // attribution may be null only when the license requires none.
      expect(['string', 'object']).toContain(typeof lic.attribution === 'string' ? 'string' : lic.attribution === null ? 'object' : 'other');

      expect(typeof a.discover).toBe('function');
      expect(typeof a.acquire).toBe('function');
      expect(typeof a.validate).toBe('function');
      expect(typeof a.normalize).toBe('function');
    }
  });

  test('adapterById resolves every registered adapter', () => {
    for (const a of ADAPTERS) {
      expect(adapterById(a.id)?.id).toBe(a.id);
    }
    expect(adapterById('does-not-exist')).toBeUndefined();
  });

  test('providerManifest exposes id/label/kind/health for every adapter', () => {
    const manifest = providerManifest();
    expect(manifest.length).toBe(ADAPTERS.length);
    for (const m of manifest) {
      expect(m.id).toBeTruthy();
      expect(m.label).toBeTruthy();
      expect(m.kind).toBeTruthy();
      expect(m.health).toBeTruthy();
    }
  });

  test('blocked adapters reject discovery with BlockedDependencyError (no fabrication)', async () => {
    // Planet requires FIRSTLIGHT_PLANET_API_KEY; ensure it is unset in this
    // test process so the adapter's honest blocked path is exercised.
    const hadKey = process.env.FIRSTLIGHT_PLANET_API_KEY;
    delete process.env.FIRSTLIGHT_PLANET_API_KEY;
    try {
      const planet = adapterById('planet');
      expect(planet).toBeDefined();
      let caught: unknown;
      try {
        await planet!.discover({ eventId: 'ev-registry', aoi: AOI, timeWindow: WINDOW });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(BlockedDependencyError);
      expect((caught as BlockedDependencyError).missing).toBe('FIRSTLIGHT_PLANET_API_KEY');
    } finally {
      if (hadKey !== undefined) process.env.FIRSTLIGHT_PLANET_API_KEY = hadKey;
    }
  });
});
