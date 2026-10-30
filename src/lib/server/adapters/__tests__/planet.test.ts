/* ==========================================================================
 * FirstLight - Planet Labs Adapter Tests
 * ========================================================================== */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { planetAdapter, PLANET_ASSET_TYPES, PlanetItemType } from '../planet';
import type { DiscoveryRequest, AdapterDeps } from '../types';

// Mock environment variables
vi.stubEnv('FIRSTLIGHT_PLANET_API_KEY', 'test-api-key');

describe('Planet Labs Adapter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('Configuration', () => {
    it('should have correct adapter ID', () => {
      expect(planetAdapter.id).toBe('planet');
    });

    it('should have correct label', () => {
      expect(planetAdapter.label).toBe('Planet Labs');
    });

    it('should have correct kind', () => {
      expect(planetAdapter.kind).toBe('imagery');
    });

    it('should report blocked health when no API key', () => {
      vi.stubEnv('FIRSTLIGHT_PLANET_API_KEY', '');
      expect(planetAdapter.health).toBe('blocked');
    });
  });

  describe('Asset Types', () => {
    it('should define all Planet item types', () => {
      const expectedTypes: PlanetItemType[] = [
        'PSScene',
        'REScene',
        'SkySatScene',
        'PSOrthoTile',
        'REOrthoTile',
        'SkySatCollect',
      ];

      const definedTypes = PLANET_ASSET_TYPES.map(t => t.itemType);
      expectedTypes.forEach(type => {
        expect(definedTypes).toContain(type);
      });
    });

    it('should have correct resolutions for each item type', () => {
      const resolutions: Record<PlanetItemType, string> = {
        PSScene: '3-5m',
        REScene: '5m',
        SkySatScene: '50cm-1m',
        PSOrthoTile: '3-5m',
        REOrthoTile: '5m',
        SkySatCollect: '50cm-1m',
      };

      PLANET_ASSET_TYPES.forEach(type => {
        expect(type.resolution).toBe(resolutions[type.itemType]);
      });
    });
  });

  describe('License', () => {
    it('should return Planet license information', () => {
      const license = planetAdapter.license();
      expect(license.name).toBe('Planet Labs');
      expect(license.attribution).toContain('Planet Labs');
      expect(license.url).toContain('planet.com');
      expect(license.requiresReview).toBe(true);
    });
  });

  describe('Discover', () => {
    it('should return empty array when API key is missing', async () => {
      vi.stubEnv('FIRSTLIGHT_PLANET_API_KEY', '');
      
      const request: DiscoveryRequest = {
        aoi: {
          type: 'Polygon',
          coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
        },
        timeWindow: {
          from: new Date().toISOString(),
          to: new Date().toISOString(),
        },
      };

      const result = await planetAdapter.discover(request);
      expect(result).toEqual([]);
    });

    it('should handle API errors gracefully', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const deps: AdapterDeps = { fetchImpl: mockFetch };

      const request: DiscoveryRequest = {
        aoi: {
          type: 'Polygon',
          coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
        },
        timeWindow: {
          from: new Date().toISOString(),
          to: new Date().toISOString(),
        },
      };

      const result = await planetAdapter.discover(request, deps);
      expect(result).toEqual([]);
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('Validate', () => {
    it('should validate valid asset', async () => {
      const asset = {
        externalId: 'test-id',
        title: 'Test Scene',
        assetType: 'imagery.planet.psscene',
        acquiredAt: new Date().toISOString(),
        publishedAt: new Date().toISOString(),
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
          coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
        },
        license: { name: 'Planet Labs' },
        raw: {
          itemType: 'PSScene',
          permissions: ['download'],
          instrument: 'PS',
          satelliteId: 'PS1',
          stripId: 'strip1',
        },
      };

      const acquired = {
        mode: 'reference' as const,
        sizeBytes: null,
        sha256: null,
      };

      const result = await planetAdapter.validate(asset, acquired);
      expect(result.ok).toBe(true);
      expect(result.checks.every(c => c.ok)).toBe(true);
    });

    it('should fail validation for missing external ID', async () => {
      const asset = {
        externalId: '',
        title: 'Test Scene',
        assetType: 'imagery.planet.psscene',
        acquiredAt: new Date().toISOString(),
      };

      const acquired = {
        mode: 'reference' as const,
        sizeBytes: null,
        sha256: null,
      };

      const result = await planetAdapter.validate(asset, acquired);
      expect(result.ok).toBe(false);
      expect(result.checks.some(c => c.name === 'external_id_exists' && !c.ok)).toBe(true);
    });

    it('should fail validation for invalid cloud cover', async () => {
      const asset = {
        externalId: 'test-id',
        title: 'Test Scene',
        assetType: 'imagery.planet.psscene',
        acquiredAt: new Date().toISOString(),
        quality: {
          cloudCover: 150, // Invalid: > 100
        },
      };

      const acquired = {
        mode: 'reference' as const,
        sizeBytes: null,
        sha256: null,
      };

      const result = await planetAdapter.validate(asset, acquired);
      expect(result.ok).toBe(false);
      expect(result.checks.some(c => c.name === 'cloud_cover_valid' && !c.ok)).toBe(true);
    });
  });

  describe('Normalize', () => {
    it('should normalize Planet asset to FirstLight catalog', async () => {
      const asset = {
        externalId: 'test-id',
        title: 'Test Scene',
        assetType: 'imagery.planet.psscene',
        acquiredAt: '2024-01-01T00:00:00Z',
        publishedAt: '2024-01-02T00:00:00Z',
        url: 'https://api.planet.com/data/v4/item-types/PSScene/items/test-id',
        quality: {
          cloudCover: 10,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
        },
        license: { name: 'Planet Labs' },
        raw: {
          itemType: 'PSScene',
        },
      };

      const acquired = {
        mode: 'reference' as const,
        sizeBytes: 1024,
        sha256: 'abc123',
      };

      const ctx = {};

      const result = await planetAdapter.normalize(asset, acquired, ctx);
      expect(result.length).toBe(1);
      expect(result[0].adapterId).toBe('planet');
      expect(result[0].provider).toBe('Planet Labs');
      expect(result[0].externalId).toBe('test-id');
      expect(result[0].title).toBe('Test Scene');
      expect(result[0].simulated).toBe(false);
    });
  });
});
