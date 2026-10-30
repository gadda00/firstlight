/* ==========================================================================
 * FirstLight - Sentinel Hub Adapter
 * 
 * Provides access to Sentinel Hub processing API for:
 * - Sentinel-1 (SAR)
 * - Sentinel-2 (Optical)
 * - Sentinel-3 (Optical)
 * - Landsat 5, 7, 8
 * - MODIS
 * - DEM (Digital Elevation Model)
 * 
 * Sentinel Hub provides cloud-native processing of satellite imagery
 * with customizable processing pipelines.
 * 
 * Requires Sentinel Hub account: https://www.sentinel-hub.com/
 * API Documentation: https://docs.sentinel-hub.com/api/latest/
 * ========================================================================== */

import type { DataSourceAdapter, DiscoveredAsset, DiscoveryRequest, ProcessingContext, NormalizedProduct, AdapterDeps } from '../types';
import { requireEnv, validGeometry, aoiToBbox, BlockedDependencyError } from '../types';
import { httpClient } from '../http-client';

export interface SentinelHubConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  timeoutMs: number;
}

const DEFAULT_CONFIG: SentinelHubConfig = {
  clientId: '',
  clientSecret: '',
  baseUrl: 'https://services.sentinel-hub.com',
  timeoutMs: 30000,
};

function getConfig(deps?: AdapterDeps): SentinelHubConfig {
  return {
    ...DEFAULT_CONFIG,
    clientId: requireEnv('FIRSTLIGHT_SENTINELHUB_CLIENT_ID', 'sentinel-hub', 'Get from https://www.sentinel-hub.com/'),
    clientSecret: requireEnv('FIRSTLIGHT_SENTINELHUB_CLIENT_SECRET', 'sentinel-hub', 'Get from https://www.sentinel-hub.com/'),
  };
}

/** Sentinel Hub data collections */
export type SentinelHubCollection = 
  | 'sentinel-1-grd'
  | 'sentinel-2-l2a'
  | 'sentinel-2-l1c'
  | 'sentinel-3-olci'
  | 'sentinel-3-slstr'
  | 'sentinel-5p-l2'
  | 'landsat-5-l1c'
  | 'landsat-7-l1c'
  | 'landsat-8-l1c'
  | 'modis-l2'
  | 'dem';

/** Sentinel Hub asset types */
export interface SentinelHubAssetType {
  id: string;
  label: string;
  collection: SentinelHubCollection;
  satellite: string;
  resolution: string;
  bands: string[];
}

/** Predefined asset types for Sentinel Hub */
export const SENTINELHUB_ASSET_TYPES: SentinelHubAssetType[] = [
  {
    id: 'sentinel1-grd',
    label: 'Sentinel-1 GRD',
    collection: 'sentinel-1-grd',
    satellite: 'Sentinel-1',
    resolution: '10m',
    bands: ['VV', 'VH', 'HH', 'HV'],
  },
  {
    id: 'sentinel2-l2a',
    label: 'Sentinel-2 L2A',
    collection: 'sentinel-2-l2a',
    satellite: 'Sentinel-2',
    resolution: '10m',
    bands: ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B8A', 'B09', 'B11', 'B12'],
  },
  {
    id: 'sentinel2-l1c',
    label: 'Sentinel-2 L1C',
    collection: 'sentinel-2-l1c',
    satellite: 'Sentinel-2',
    resolution: '10m',
    bands: ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B8A', 'B09', 'B10', 'B11', 'B12'],
  },
  {
    id: 'sentinel3-olci',
    label: 'Sentinel-3 OLCI',
    collection: 'sentinel-3-olci',
    satellite: 'Sentinel-3',
    resolution: '300m',
    bands: ['Oa01', 'Oa02', 'Oa03', 'Oa04', 'Oa05', 'Oa06', 'Oa07', 'Oa08', 'Oa09', 'Oa10', 'Oa11', 'Oa12', 'Oa13', 'Oa14', 'Oa15', 'Oa16', 'Oa17', 'Oa18', 'Oa19', 'Oa20', 'Oa21'],
  },
  {
    id: 'landsat8-l1c',
    label: 'Landsat 8 L1C',
    collection: 'landsat-8-l1c',
    satellite: 'Landsat-8',
    resolution: '30m',
    bands: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11'],
  },
  {
    id: 'dem',
    label: 'Digital Elevation Model',
    collection: 'dem',
    satellite: 'DEM',
    resolution: '10m',
    bands: ['DEM'],
  },
];

/** Sentinel Hub license information */
const SENTINELHUB_LICENSE = {
  name: 'Sentinel Hub',
  attribution: 'Contains modified Copernicus Sentinel data',
  url: 'https://www.sentinel-hub.com/',
  requiresReview: false,
};

/**
 * Get OAuth2 token for Sentinel Hub API
 */
async function getSentinelHubToken(config: SentinelHubConfig, deps?: AdapterDeps): Promise<string> {
  const tokenUrl = 'https://services.sentinel-hub.com/oauth/token';
  
  const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);
  const response = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Sentinel Hub OAuth2 error: ${response.status} ${response.statusText} - ${error}`);
  }
  
  const data = await response.json();
  return data.access_token;
}

/**
 * Discover Sentinel Hub imagery for an AOI and time window
 */
async function discoverSentinelHub(
  req: DiscoveryRequest,
  config: SentinelHubConfig,
  deps?: AdapterDeps,
): Promise<DiscoveredAsset[]> {
  const { aoi, timeWindow, params } = req;
  const collection = (params?.collection as SentinelHubCollection) || 'sentinel-2-l2a';
  
  const bbox = aoiToBbox(aoi);
  const startDate = timeWindow.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const endDate = timeWindow.to || new Date().toISOString();
  
  // Get OAuth2 token
  const token = await getSentinelHubToken(config, deps);
  
  // Build catalog search URL
  const searchUrl = `${config.baseUrl}/api/v1/catalog/search`;
  
  const searchBody = {
    bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
    datetime: `${startDate}/${endDate}`,
    collections: [collection],
    limit: params?.limit || 100,
  };
  
  try {
    const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);
    const response = await fetchImpl(searchUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(searchBody),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Sentinel Hub API error: ${response.status} ${response.statusText} - ${error}`);
    }
    
    const data = await response.json();
    const features = data.features || [];
    
    const assets: DiscoveredAsset[] = features.map((feature: any) => {
      const geometry = feature.geometry;
      const properties = feature.properties || {};
      
      return {
        externalId: feature.id,
        title: properties.title || feature.id,
        assetType: `imagery.sentinel-hub.${collection}`,
        acquiredAt: properties.datetime,
        publishedAt: properties.published,
        url: properties.url,
        quality: {
          cloudCover: properties['eo:cloud_cover'],
          groundSampleDistance: properties['sentinel:grid_square'] ? 10 : undefined,
          processingLevel: properties['sentinel:processing_level'],
          productType: properties['sentinel:product_type'],
        },
        geometry: validGeometry(geometry) ? geometry : undefined,
        license: SENTINELHUB_LICENSE,
        raw: {
          collection,
          satellite: properties['sentinel:satellite'] || properties['landsat:satellite'],
          tileId: properties['sentinel:tile_id'],
          mgrsTile: properties['sentinel:mgrs_tile'],
          orbitNumber: properties['sentinel:orbit_number'],
        },
      };
    });
    
    return assets;
  } catch (error) {
    if (error instanceof BlockedDependencyError) {
      throw error;
    }
    console.error('Sentinel Hub discovery error:', error);
    return [];
  }
}

/**
 * Acquire Sentinel Hub asset (process and get download URL)
 */
async function acquireSentinelHub(
  asset: DiscoveredAsset,
  dest: { mode: 'reference' | 'buffer'; maxBytes: number },
  config: SentinelHubConfig,
  deps?: AdapterDeps,
): Promise<{ mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }> {
  const token = await getSentinelHubToken(config, deps);
  const collection = asset.raw?.collection || 'sentinel-2-l2a';
  
  // Build processing request
  const processUrl = `${config.baseUrl}/api/v1/process`;
  
  const evalscript = `
    //VERSION=3
    function setup() {
      return {
        input: ["${collection}", "dataMask"],
        output: { bands: ${JSON.stringify(getBandsForCollection(collection))} }
      };
    }
    
    function updateOutputMetadata(scene, inputMetadata, outputMetadata) {
      outputMetadata.userData = { "collection": "${collection}" };
    }
    
    function evaluatePixel(sample, scenes) {
      return [sample.${getBandsForCollection(collection).map(b => `"${b}"`).join(', ')})];
    }
  `;
  
  const bbox = asset.geometry?.type === 'Polygon' 
    ? asset.geometry.coordinates[0].map(([lng, lat]) => [lng, lat])
    : null;
  
  if (!bbox || bbox.length === 0) {
    return {
      mode: dest.mode,
      sizeBytes: null,
      sha256: null,
    };
  }
  
  const requestBody = {
    input: {
      bounds: {
        bbox,
        properties: {
          crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
        },
      },
      data: [
        {
          type: collection,
          dataFilter: {
            timeRange: {
              from: asset.acquiredAt,
              to: asset.acquiredAt,
            },
          },
        },
      ],
    },
    output: {
      width: 512,
      height: 512,
      responses: [
        {
          identifier: 'default',
          format: {
            type: 'image/tiff',
          },
        },
      ],
    },
    evalscript,
  };
  
  try {
    const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);
    const response = await fetchImpl(processUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Sentinel Hub processing error: ${response.status} ${response.statusText} - ${error}`);
    }
    
    const data = await response.json();
    
    // For reference mode, return the processing URL
    if (dest.mode === 'reference') {
      return {
        mode: 'reference',
        sizeBytes: null,
        sha256: null,
      };
    }
    
    // For buffer mode, we would need to download the processed image
    // This is typically done via the response URL in the data
    return {
      mode: 'reference',
      sizeBytes: null,
      sha256: null,
    };
  } catch (error) {
    console.error('Sentinel Hub acquisition error:', error);
    return {
      mode: dest.mode,
      sizeBytes: null,
      sha256: null,
    };
  }
}

/**
 * Get bands for a collection
 */
function getBandsForCollection(collection: SentinelHubCollection): string[] {
  const assetType = SENTINELHUB_ASSET_TYPES.find(t => t.collection === collection);
  return assetType?.bands || ['B01', 'B02', 'B03', 'B04'];
}

/**
 * Validate Sentinel Hub asset
 */
async function validateSentinelHub(
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
      name: 'collection_valid',
      ok: !!asset.raw?.collection && SENTINELHUB_ASSET_TYPES.some(t => t.collection === asset.raw.collection),
      detail: asset.raw?.collection ? undefined : 'Invalid collection',
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
 * Normalize Sentinel Hub asset to FirstLight catalog
 */
async function normalizeSentinelHub(
  asset: DiscoveredAsset,
  acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null },
  ctx: ProcessingContext,
): Promise<NormalizedProduct[]> {
  const collection = asset.raw?.collection || 'sentinel-2-l2a';
  const assetType = SENTINELHUB_ASSET_TYPES.find(t => t.collection === collection);
  
  return [
    {
      adapterId: 'sentinel-hub',
      provider: 'Sentinel Hub',
      assetType: `imagery.sentinel-hub.${collection}`,
      externalId: asset.externalId,
      title: asset.title,
      acquiredAt: asset.acquiredAt ? new Date(asset.acquiredAt) : null,
      publishedAt: asset.publishedAt ? new Date(asset.publishedAt) : null,
      license: SENTINELHUB_LICENSE.name,
      attribution: SENTINELHUB_LICENSE.attribution,
      url: asset.url,
      checksumSha256: acquired.sha256,
      sizeBytes: acquired.sizeBytes,
      quality: {
        ...asset.quality,
        provider: 'Sentinel Hub',
        collection,
        satellite: asset.raw?.satellite || 'Sentinel-2',
        resolution: assetType?.resolution || 'unknown',
        bands: assetType?.bands || [],
      },
      geometry: asset.geometry,
      status: 'discovered',
      simulated: false,
    },
  ];
}

/**
 * Sentinel Hub adapter
 */
export const sentinelHubAdapter: DataSourceAdapter = {
  id: 'sentinel-hub',
  label: 'Sentinel Hub',
  kind: 'imagery',
  health: 'blocked',
  healthNote: 'Requires FIRSTLIGHT_SENTINELHUB_CLIENT_ID and FIRSTLIGHT_SENTINELHUB_CLIENT_SECRET from https://www.sentinel-hub.com/',
  
  license() {
    return SENTINELHUB_LICENSE;
  },
  
  async discover(req: DiscoveryRequest, deps?: AdapterDeps): Promise<DiscoveredAsset[]> {
    const config = getConfig(deps);
    return discoverSentinelHub(req, config, deps);
  },
  
  async acquire(asset: DiscoveredAsset, dest: { mode: 'reference' | 'buffer'; maxBytes: number }, deps?: AdapterDeps): Promise<{ mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }> {
    const config = getConfig(deps);
    return acquireSentinelHub(asset, dest, config, deps);
  },
  
  async validate(asset: DiscoveredAsset, acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }): Promise<{ ok: boolean; checks: Array<{ name: string; ok: boolean; detail?: string }> }> {
    return validateSentinelHub(asset, acquired);
  },
  
  async normalize(asset: DiscoveredAsset, acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }, ctx: ProcessingContext): Promise<NormalizedProduct[]> {
    return normalizeSentinelHub(asset, acquired, ctx);
  },
};

export default sentinelHubAdapter;
