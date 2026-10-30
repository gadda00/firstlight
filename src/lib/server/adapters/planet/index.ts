/* ==========================================================================
 * FirstLight - Planet Labs Adapter
 * 
 * Provides access to Planet Labs satellite imagery including:
 * - PlanetScope (3-5m resolution, daily)
 * - RapidEye (5m resolution)
 * - SkySat (50cm-1m resolution)
 * - PSB.SD (SuperDove, 3m resolution)
 * 
 * Requires Planet API key: https://developers.planet.com/
 * 
 * API Documentation: https://developers.planet.com/docs/api/
 * ========================================================================== */

import type { DataSourceAdapter, DiscoveredAsset, DiscoveryRequest, ProcessingContext, NormalizedProduct, AdapterDeps } from '../types';
import { requireEnv, validGeometry, aoiToBbox, BlockedDependencyError } from '../types';
import { httpClient } from '../http-client';

export interface PlanetConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

const DEFAULT_CONFIG: PlanetConfig = {
  apiKey: '',
  baseUrl: 'https://api.planet.com',
  timeoutMs: 30000,
};

function getConfig(deps?: AdapterDeps): PlanetConfig {
  return {
    ...DEFAULT_CONFIG,
    apiKey: requireEnv('FIRSTLIGHT_PLANET_API_KEY', 'planet', 'Get from https://developers.planet.com/'),
  };
}

/** Planet item types */
export type PlanetItemType = 'PSScene' | 'REScene' | 'SkySatScene' | 'PSOrthoTile' | 'REOrthoTile' | 'SkySatCollect';

/** Planet asset types */
export interface PlanetAssetType {
  id: string;
  label: string;
  itemType: PlanetItemType;
  resolution: string;
  bands: string[];
}

/** Predefined asset types for Planet */
export const PLANET_ASSET_TYPES: PlanetAssetType[] = [
  {
    id: 'planet-psscene',
    label: 'PlanetScope Scene',
    itemType: 'PSScene',
    resolution: '3-5m',
    bands: ['B', 'G', 'R', 'N', 'RE'],
  },
  {
    id: 'planet-rescene',
    label: 'RapidEye Scene',
    itemType: 'REScene',
    resolution: '5m',
    bands: ['B', 'G', 'R', 'RE', 'N'],
  },
  {
    id: 'planet-skysatscene',
    label: 'SkySat Scene',
    itemType: 'SkySatScene',
    resolution: '50cm-1m',
    bands: ['B', 'G', 'R', 'N'],
  },
  {
    id: 'planet-psorthotile',
    label: 'PlanetScope Ortho Tile',
    itemType: 'PSOrthoTile',
    resolution: '3-5m',
    bands: ['B', 'G', 'R', 'N'],
  },
  {
    id: 'planet-reorthotile',
    label: 'RapidEye Ortho Tile',
    itemType: 'REOrthoTile',
    resolution: '5m',
    bands: ['B', 'G', 'R', 'RE', 'N'],
  },
];

/** Planet license information */
const PLANET_LICENSE = {
  name: 'Planet Labs',
  attribution: 'Imagery © Planet Labs, Inc.',
  url: 'https://www.planet.com/',
  requiresReview: true,
};

/**
 * Discover Planet imagery for an AOI and time window
 */
async function discoverPlanet(
  req: DiscoveryRequest,
  config: PlanetConfig,
  deps?: AdapterDeps,
): Promise<DiscoveredAsset[]> {
  const { aoi, timeWindow, params } = req;
  const itemType = (params?.itemType as PlanetItemType) || 'PSScene';
  
  const bbox = aoiToBbox(aoi);
  const startDate = timeWindow.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const endDate = timeWindow.to || new Date().toISOString();
  
  // Build Planet API search URL
  const searchUrl = `${config.baseUrl}/data/v4/item-types/${itemType}/search`;
  
  const searchParams = new URLSearchParams({
    'bbox': `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    'start_date': startDate,
    'end_date': endDate,
    'limit': String(params?.limit || 100),
  });
  
  // Add quality filter if specified
  if (params?.quality) {
    searchParams.set('quality', String(params.quality));
  }
  
  // Add cloud cover filter if specified
  if (params?.cloudCover) {
    searchParams.set('cloud_cover', String(params.cloudCover));
  }
  
  const url = `${searchUrl}?${searchParams.toString()}`;
  
  try {
    const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${config.apiKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Planet API error: ${response.status} ${response.statusText} - ${error}`);
    }
    
    const data = await response.json();
    const items = data._items || [];
    
    const assets: DiscoveredAsset[] = items.map((item: any) => {
      const geometry = item.geometry ? JSON.parse(item.geometry) : null;
      
      return {
        externalId: item.id,
        title: item.properties?.name || item.id,
        assetType: `imagery.planet.${itemType.toLowerCase()}`,
        acquiredAt: item.properties?.acquired,
        publishedAt: item.properties?.published,
        url: item._links?._self,
        quality: {
          cloudCover: item.properties?.cloud_cover,
          qualityCategory: item.properties?.quality_category,
          groundSampleDistance: item.properties?.gsd,
          sunAzimuth: item.properties?.sun_azimuth,
          sunElevation: item.properties?.sun_elevation,
        },
        geometry: validGeometry(geometry) ? geometry : undefined,
        license: PLANET_LICENSE,
        raw: {
          itemType: item.type,
          permissions: item.properties?.permissions,
          instrument: item.properties?.instrument,
          satelliteId: item.properties?.satellite_id,
          stripId: item.properties?.strip_id,
        },
      };
    });
    
    return assets;
  } catch (error) {
    if (error instanceof BlockedDependencyError) {
      throw error;
    }
    console.error('Planet discovery error:', error);
    return [];
  }
}

/**
 * Acquire Planet asset (get download URL)
 */
async function acquirePlanet(
  asset: DiscoveredAsset,
  dest: { mode: 'reference' | 'buffer'; maxBytes: number },
  config: PlanetConfig,
  deps?: AdapterDeps,
): Promise<{ mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }> {
  // Get activation URL for the asset
  const activationUrl = `${config.baseUrl}/data/v4/item-types/${asset.raw?.itemType || 'PSScene'}/${asset.externalId}/activate`;
  
  try {
    const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);
    const response = await fetchImpl(activationUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${config.apiKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        delivery: {
          archive_type: 'zip',
          single_archive: true,
        },
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Planet activation error: ${response.status} ${response.statusText} - ${error}`);
    }
    
    const activationData = await response.json();
    
    // Wait for activation to complete (polling)
    const statusUrl = activationData._links?._status || `${activationUrl}/status`;
    let statusResponse = await fetchImpl(statusUrl, {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${config.apiKey}:`).toString('base64')}`,
      },
    });
    
    let statusData = await statusResponse.json();
    let attempts = 0;
    const maxAttempts = 30;
    const delayMs = 5000;
    
    while ((statusData.state !== 'success' && statusData.state !== 'failed') && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      statusResponse = await fetchImpl(statusUrl, {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${config.apiKey}:`).toString('base64')}`,
        },
      });
      statusData = await statusResponse.json();
      attempts++;
    }
    
    if (statusData.state === 'failed') {
      throw new Error(`Planet activation failed: ${JSON.stringify(statusData)}`);
    }
    
    if (statusData.state !== 'success') {
      throw new Error('Planet activation timed out');
    }
    
    // Get download location
    const downloadUrl = statusData._links?._download || statusData.location;
    
    // For reference mode, return the download URL
    if (dest.mode === 'reference') {
      return {
        mode: 'reference',
        sizeBytes: null,
        sha256: null,
      };
    }
    
    // For buffer mode, download the file
    const downloadResponse = await fetchImpl(downloadUrl, {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${config.apiKey}:`).toString('base64')}`,
      },
    });
    
    if (!downloadResponse.ok) {
      throw new Error(`Planet download error: ${downloadResponse.status} ${downloadResponse.statusText}`);
    }
    
    const sizeBytes = Number(downloadResponse.headers.get('content-length') || 0);
    const sha256 = null; // Would need to compute from the stream
    
    return {
      mode: 'buffer',
      sizeBytes,
      sha256,
    };
  } catch (error) {
    console.error('Planet acquisition error:', error);
    return {
      mode: dest.mode,
      sizeBytes: null,
      sha256: null,
    };
  }
}

/**
 * Validate Planet asset
 */
async function validatePlanet(
  asset: DiscoveredAsset,
  acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null },
): Promise<{ ok: boolean; checks: Array<{ name: string; ok: boolean; detail?: string }> }> {
  const checks = [
    {
      name: 'external_id_exists',
      ok: !!asset.externalId,
      detail: asset.externalId ? undefined : 'Missing external ID',
    },
    {
      name: 'title_exists',
      ok: !!asset.title,
      detail: asset.title ? undefined : 'Missing title',
    },
    {
      name: 'acquired_at_exists',
      ok: !!asset.acquiredAt,
      detail: asset.acquiredAt ? undefined : 'Missing acquisition date',
    },
    {
      name: 'geometry_valid',
      ok: !asset.geometry || validGeometry(asset.geometry),
      detail: validGeometry(asset.geometry) ? undefined : 'Invalid geometry',
    },
    {
      name: 'quality_data_exists',
      ok: !!asset.quality && Object.keys(asset.quality).length > 0,
      detail: asset.quality ? undefined : 'Missing quality data',
    },
    {
      name: 'cloud_cover_valid',
      ok: !asset.quality?.cloudCover || (asset.quality.cloudCover >= 0 && asset.quality.cloudCover <= 100),
      detail: asset.quality?.cloudCover ? undefined : 'Invalid cloud cover value',
    },
  ];
  
  const ok = checks.every(c => c.ok);
  
  return { ok, checks };
}

/**
 * Normalize Planet asset to FirstLight catalog
 */
async function normalizePlanet(
  asset: DiscoveredAsset,
  acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null },
  ctx: ProcessingContext,
): Promise<NormalizedProduct[]> {
  const itemType = asset.raw?.itemType || 'PSScene';
  
  return [
    {
      adapterId: 'planet',
      provider: 'Planet Labs',
      assetType: `imagery.planet.${itemType.toLowerCase()}`,
      externalId: asset.externalId,
      title: asset.title,
      acquiredAt: asset.acquiredAt ? new Date(asset.acquiredAt) : null,
      publishedAt: asset.publishedAt ? new Date(asset.publishedAt) : null,
      license: PLANET_LICENSE.name,
      attribution: PLANET_LICENSE.attribution,
      url: asset.url,
      checksumSha256: acquired.sha256,
      sizeBytes: acquired.sizeBytes,
      quality: {
        ...asset.quality,
        provider: 'Planet Labs',
        itemType,
        resolution: PLANET_ASSET_TYPES.find(t => t.itemType === itemType)?.resolution || 'unknown',
        bands: PLANET_ASSET_TYPES.find(t => t.itemType === itemType)?.bands || [],
      },
      geometry: asset.geometry,
      status: 'discovered',
      simulated: false,
    },
  ];
}

/**
 * Planet Labs adapter
 */
export const planetAdapter: DataSourceAdapter = {
  id: 'planet',
  label: 'Planet Labs',
  kind: 'imagery',
  health: 'blocked',
  healthNote: 'Requires FIRSTLIGHT_PLANET_API_KEY from https://developers.planet.com/',
  
  license() {
    return PLANET_LICENSE;
  },
  
  async discover(req: DiscoveryRequest, deps?: AdapterDeps): Promise<DiscoveredAsset[]> {
    const config = getConfig(deps);
    return discoverPlanet(req, config, deps);
  },
  
  async acquire(asset: DiscoveredAsset, dest: { mode: 'reference' | 'buffer'; maxBytes: number }, deps?: AdapterDeps): Promise<{ mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }> {
    const config = getConfig(deps);
    return acquirePlanet(asset, dest, config, deps);
  },
  
  async validate(asset: DiscoveredAsset, acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }): Promise<{ ok: boolean; checks: Array<{ name: string; ok: boolean; detail?: string }> }> {
    return validatePlanet(asset, acquired);
  },
  
  async normalize(asset: DiscoveredAsset, acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }, ctx: ProcessingContext): Promise<NormalizedProduct[]> {
    return normalizePlanet(asset, acquired, ctx);
  },
};

export default planetAdapter;
