/* ==========================================================================
 * FirstLight — Planet Labs adapter contract tests (bun:test).
 *
 * Covers: identity/metadata, blocked-dependency honesty, fixture-backed
 * discovery round trip, validation checks, and catalog normalization —
 * all against the CURRENT shared adapter contracts (no network).
 * ========================================================================== */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { planetAdapter, PLANET_ASSET_TYPES } from '../planet';
import type { PlanetItemType } from '../planet';
import type { DiscoveryRequest, AdapterDeps, DiscoveredAsset, AcquiredAsset, ProcessingContext } from '../types';
import { BlockedDependencyError } from '../types';

const KEY = 'FIRSTLIGHT_PLANET_API_KEY';

beforeEach(() => {
  process.env[KEY] = 'test-api-key';
});

afterEach(() => {
  delete process.env[KEY];
});

const REQ: DiscoveryRequest = {
  eventId: 'evt-test',
  aoi: { lat: -1.29, lng: 36.82, aoiKm: 30 },
  timeWindow: { from: '2026-10-01T00:00:00Z', to: '2026-10-08T00:00:00Z' },
};

const CTX: ProcessingContext = { eventId: 'evt-test', orgId: 'org-test' };

/** A Planet Data API quick-search shaped payload (fixture, no network). */
function planetSearchResponse(): Record<string, unknown> {
  return {
    _items: [
      {
        id: '20261001_0123456789',
        type: 'PSScene',
        geometry: JSON.stringify({
          type: 'Polygon',
          coordinates: [
            [
              [36.7, -1.35],
              [36.95, -1.35],
              [36.95, -1.23],
              [36.7, -1.23],
              [36.7, -1.35],
            ],
          ],
        }),
        properties: {
          acquired: '2026-10-01T08:22:00Z',
          published: '2026-10-01T09:00:00Z',
          cloud_cover: 12,
          quality_category: 'standard',
          gsd: 3.7,
          sun_azimuth: 142.5,
          sun_elevation: 58.2,
          permissions: ['assets:download'],
          instrument: 'PSB.SD',
          satellite_id: '105e',
        },
        _links: { _self: 'https://api.planet.com/data/v4/item-types/PSScene/items/20261001_0123456789' },
      },
    ],
  };
}

function jsonRes(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 500,
    headers: { 'content-type': 'application/json' },
  });
}

describe('planet adapter — identity & metadata', () => {
  it('exposes the registered id, label and kind', () => {
    expect(planetAdapter.id).toBe('planet');
    expect(planetAdapter.label).toBe('Planet Labs');
    expect(planetAdapter.kind).toBe('imagery');
  });

  it('reports blocked health (no fabricated live capability)', () => {
    expect(planetAdapter.health).toBe('blocked');
    expect(planetAdapter.healthNote).toContain(KEY);
  });

  it('defines all six Planet item types with resolutions', () => {
    const expected: PlanetItemType[] = [
      'PSScene',
      'REScene',
      'SkySatScene',
      'PSOrthoTile',
      'REOrthoTile',
      'SkySatCollect',
    ];
    const defined = PLANET_ASSET_TYPES.map((t) => t.itemType);
    for (const t of expected) expect(defined).toContain(t);
  });

  it('carries a Planet license record requiring review', () => {
    const license = planetAdapter.license();
    expect(license.name).toBe('Planet Labs');
    expect(license.attribution).toContain('Planet Labs');
    expect(license.url).toContain('planet.com');
    expect(license.requiresReview).toBe(true);
  });
});

describe('planet adapter — discovery honesty', () => {
  it('throws BlockedDependencyError naming the env var when the key is missing', async () => {
    delete process.env[KEY];
    let caught: unknown;
    try {
      await planetAdapter.discover(REQ);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BlockedDependencyError);
    const blocked = caught as BlockedDependencyError;
    expect(blocked.adapterId).toBe('planet');
    expect(blocked.missing).toBe(KEY);
  });

  it('returns [] (never throws) on a network failure with a key present', async () => {
    const deps: AdapterDeps = {
      fetchImpl: (() => Promise.reject(new Error('Network error'))) as unknown as typeof fetch,
    };
    const result = await planetAdapter.discover(REQ, deps);
    expect(result).toEqual([]);
  });

  it('maps a fixture-backed quick-search response into DiscoveredAsset records', async () => {
    const calls: string[] = [];
    const deps: AdapterDeps = {
      fetchImpl: (async (url: string | URL | Request) => {
        calls.push(String(url));
        return jsonRes(planetSearchResponse());
      }) as unknown as typeof fetch,
    };

    const assets = await planetAdapter.discover(REQ, deps);

    expect(assets).toHaveLength(1);
    const a = assets[0] as DiscoveredAsset;
    expect(a.externalId).toBe('20261001_0123456789');
    expect(a.assetType).toBe('imagery.planet.psscene');
    expect(a.acquiredAt).toBe('2026-10-01T08:22:00Z');
    expect(a.url).toContain('api.planet.com');
    expect(a.quality.cloudCover).toBe(12);
    expect(a.geometry?.type).toBe('Polygon');
    expect(a.license.name).toBe('Planet Labs');
    expect(a.raw?.itemType).toBe('PSScene');
    // The search must hit the Planet Data API host.
    expect(calls[0]).toContain('api.planet.com');
  });
});

describe('planet adapter — validation', () => {
  const REFERENCE: AcquiredAsset = { mode: 'reference', sizeBytes: 0, sha256: null };

  function baseAsset(overrides: Partial<DiscoveredAsset>): DiscoveredAsset {
    return {
      externalId: 'test-id',
      title: 'Test Scene',
      assetType: 'imagery.planet.psscene',
      acquiredAt: '2026-10-01T08:22:00Z',
      publishedAt: '2026-10-01T09:00:00Z',
      url: 'https://api.planet.com/data/v4/item-types/PSScene/items/test-id',
      quality: {
        cloudCover: 10,
        qualityCategory: 'standard',
        groundSampleDistance: 3,
        sunAzimuth: 180,
        sunElevation: 45,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [0, 1],
            [1, 1],
            [1, 0],
            [0, 0],
          ],
        ],
      },
      license: { name: 'Planet Labs', attribution: 'Imagery © Planet Labs, Inc.' },
      raw: { itemType: 'PSScene' },
      ...overrides,
    };
  }

  it('passes a complete, well-formed asset', async () => {
    const report = await planetAdapter.validate(baseAsset({}), REFERENCE);
    expect(report.ok).toBe(true);
    expect(report.checks.every((c) => c.ok)).toBe(true);
  });

  it('fails external_id_exists for a blank external id', async () => {
    const report = await planetAdapter.validate(baseAsset({ externalId: '' }), REFERENCE);
    expect(report.ok).toBe(false);
    expect(report.checks.some((c) => c.name === 'external_id_exists' && !c.ok)).toBe(true);
  });

  it('fails cloud_cover_valid when cloud cover is out of range', async () => {
    const report = await planetAdapter.validate(
      baseAsset({ quality: { cloudCover: 150 } }),
      REFERENCE,
    );
    expect(report.ok).toBe(false);
    expect(report.checks.some((c) => c.name === 'cloud_cover_valid' && !c.ok)).toBe(true);
  });
});

describe('planet adapter — normalization', () => {
  it('produces one honest catalog record (not simulated) per asset', async () => {
    const asset: DiscoveredAsset = {
      externalId: 'test-id',
      title: 'Test Scene',
      assetType: 'imagery.planet.psscene',
      acquiredAt: '2026-10-01T00:00:00Z',
      publishedAt: '2026-10-02T00:00:00Z',
      url: 'https://api.planet.com/data/v4/item-types/PSScene/items/test-id',
      quality: { cloudCover: 10 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [0, 1],
            [1, 1],
            [1, 0],
            [0, 0],
          ],
        ],
      },
      license: { name: 'Planet Labs', attribution: 'Imagery © Planet Labs, Inc.' },
      raw: { itemType: 'PSScene' },
    };

    const acquired: AcquiredAsset = { mode: 'reference', sizeBytes: 1024, sha256: 'abc123' };
    const products = await planetAdapter.normalize(asset, acquired, CTX);

    expect(products).toHaveLength(1);
    const p = products[0];
    expect(p.adapterId).toBe('planet');
    expect(p.provider).toBe('Planet Labs');
    expect(p.externalId).toBe('test-id');
    expect(p.title).toBe('Test Scene');
    expect(p.assetType).toBe('imagery.planet.psscene');
    expect(p.simulated).toBe(false);
    expect(p.status).toBe('discovered');
    expect(p.sizeBytes).toBe(1024);
    expect(p.checksumSha256).toBe('abc123');
    expect(p.url).toBe('https://api.planet.com/data/v4/item-types/PSScene/items/test-id');
    expect(p.geometry?.type).toBe('Polygon');
  });
});
