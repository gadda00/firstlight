/* ==========================================================================
 * FirstLight - Maxar Open Data Adapter
 * 
 * Provides access to Maxar Open Data Program imagery:
 * - WorldView-3 (30cm resolution)
 * - WorldView-2 (50cm resolution)
 * - GeoEye-1 (50cm resolution)
 * - QuickBird (60cm resolution)
 * - Ikonos (80cm resolution)
 * 
 * Maxar Open Data is available for specific events (disasters, conflicts, etc.)
 * and requires registration: https://www.maxar.com/open-data
 * 
 * API Documentation: https://developers.digitalglobe.com/
 * ========================================================================== */

import type { DataSourceAdapter, DiscoveredAsset, DiscoveryRequest, ProcessingContext, NormalizedProduct, AdapterDeps } from '../types';
import { requireEnv, validGeometry, aoiToBbox, BlockedDependencyError } from '../types';
import { httpClient } from '../http-client';

export interface MaxarConfig {
  apiKey: string;
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  timeoutMs: number;
}

const DEFAULT_CONFIG: MaxarConfig = {
  apiKey: '',
  clientId: '',
  clientSecret: '',
  baseUrl: 'https://api.digitalglobe.com',
  timeoutMs: 30000,
};

function getConfig(deps?: AdapterDeps): MaxarConfig {
  return {
    ...DEFAULT_CONFIG,
    clientId: requireEnv('FIRSTLIGHT_MAXAR_CLIENT_ID', 'maxar', 'Get from https://www.maxar.com/open-data'),
    clientSecret: requireEnv('FIRSTLIGHT_MAXAR_CLIENT_SECRET', 'maxar', 'Get from https://www.maxar.com/open-data'),
  };
}

/** Maxar satellite types */
export type MaxarSatellite = 'WorldView3' | 'WorldView2' | 'GeoEye1' | 'QuickBird' | 'Ikonos';

/** Maxar asset types */
export interface MaxarAssetType {
  id: string;
  label: string;
  satellite: MaxarSatellite;
  resolution: string;
  bands: string[];
}

/** Predefined asset types for Maxar */
export const MAXAR_ASSET_TYPES: MaxarAssetType[] = [
  {
    id: 'maxar-worldview3',
    label: 'WorldView-3',
    satellite: 'WorldView3',
    resolution: '30cm',
    bands: ['PAN', 'MS', 'SWIR'],
  },
  {
    id: 'maxar-worldview2',
    label: 'WorldView-2',
    satellite: 'WorldView2',
    resolution: '50cm',
    bands: ['PAN', 'MS'],
  },
  {
    id: 'maxar-geoeye1',
    label: 'GeoEye-1',
    satellite: 'GeoEye1',
    resolution: '50cm',
    bands: ['PAN', 'MS'],
  },
  {
    id: 'maxar-quickbird',
    label: 'QuickBird',
    satellite: 'QuickBird',
    resolution: '60cm',
    bands: ['PAN', 'MS'],
  },
  {
    id: 'maxar-ikonos',
    label: 'Ikonos',
    satellite: 'Ikonos',
    resolution: '80cm',
    bands: ['PAN', 'MS'],
  },
];

/** Maxar license information */
const MAXAR_LICENSE = {
  name: 'Maxar Open Data',
  attribution: 'Imagery © Maxar Technologies',
  url: 'https://www.maxar.com/',
  requiresReview: true,
};

/**
 * Get OAuth2 token for Maxar API
 */
async function getMaxarToken(config: MaxarConfig, deps?: AdapterDeps): Promise<string> {
  const tokenUrl = `${config.baseUrl}/auth/realms/prod/protocol/openid-connect/token`;
  
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
    throw new Error(`Maxar OAuth2 error: ${response.status} ${response.statusText} - ${error}`);
  }
  
  const data = await response.json();
  return data.access_token;
}

/**
 * Discover Maxar imagery for an AOI and time window
 */
async function discoverMaxar(
  req: DiscoveryRequest,
  config: MaxarConfig,
  deps?: AdapterDeps,
): Promise<DiscoveredAsset[]> {
  const { aoi, timeWindow, params } = req;
  const satellite = (params?.satellite as MaxarSatellite) || 'WorldView3';
  
  const bbox = aoiToBbox(aoi);
  const startDate = timeWindow.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const endDate = timeWindow.to || new Date().toISOString();
  
  // Get OAuth2 token
  const token = await getMaxarToken(config, deps);
  
  // Build search URL
  const searchUrl = `${config.baseUrl}/catalog/search`;
  
  const searchBody = {
    filter: {
      type: 'AndFilter',
      config: [
        {
          type: 'PermissiveFilter',
          config: {
            permissions: ['ingest:read'],
          },
        },
        {
          type: 'MbrFilter',
          config: {
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [bbox.west, bbox.south],
                [bbox.west, bbox.north],
                [bbox.east, bbox.north],
                [bbox.east, bbox.south],
                [bbox.west, bbox.south],
              ]],
            },
          },
        },
        {
          type: 'DateRangeFilter',
          field_name: 'acquired',
          config: {
            gte: startDate,
            lte: endDate,
          },
        },
        {
          type: 'StringInFilter',
          field_name: 'satellite',
          config: {
            values: [satellite],
          },
        },
      ],
    },
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
      throw new Error(`Maxar API error: ${response.status} ${response.statusText} - ${error}`);
    }
    
    const data = await response.json();
    const items = data.results || [];
    
    const assets: DiscoveredAsset[] = items.map((item: any) => {
      const geometry = item.properties?.geometry ? JSON.parse(item.properties.geometry) : null;
      
      return {
        externalId: item.id,
        title: item.properties?.identifier || item.id,
        assetType: `imagery.maxar.${satellite.toLowerCase()}`,
        acquiredAt: item.properties?.acquired,
        publishedAt: item.properties?.published,
        url: item._links?._self,
        quality: {
          cloudCover: item.properties?.cloud_cover,
          groundSampleDistance: item.properties?.gsd,
          sunAzimuth: item.properties?.sun_azimuth,
          sunElevation: item.properties?.sun_elevation,
          offNadirAngle: item.properties?.off_nadir_angle,
        },
        geometry: validGeometry(geometry) ? geometry : undefined,
        license: MAXAR_LICENSE,
        raw: {
          satellite: item.properties?.satellite,
          sensor: item.properties?.sensor,
          productType: item.properties?.product_type,
          catalogId: item.properties?.catalog_id,
        },
      };
    });
    
    return assets;
  } catch (error) {
    if (error instanceof BlockedDependencyError) {
      throw error;
    }
    console.error('Maxar discovery error:', error);
    return [];
  }
}

/**
 * Acquire Maxar asset (get download URL)
 */
async function acquireMaxar(
  asset: DiscoveredAsset,
  dest: { mode: 'reference' | 'buffer'; maxBytes: number },
  config: MaxarConfig,
  deps?: AdapterDeps,
): Promise<{ mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }> {
  const token = await getMaxarToken(config, deps);
  
  // Build download URL
  const downloadUrl = `${config.baseUrl}/catalog/items/${asset.externalId}/assets`;
  
  try {
    const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);
    const response = await fetchImpl(downloadUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Maxar assets error: ${response.status} ${response.statusText} - ${error}`);
    }
    
    const data = await response.json();
    
    // Find the ortho_analytic asset (or similar)
    const orthoAsset = data.results?.find((a: any) => a.name === 'ortho_analytic') || data.results?.[0];
    
    if (!orthoAsset) {
      throw new Error('No downloadable asset found');
    }
    
    // For reference mode, return the asset URL
    if (dest.mode === 'reference') {
      return {
        mode: 'reference',
        sizeBytes: orthoAsset.size || null,
        sha256: null,
      };
    }
    
    // For buffer mode, we would download the file
    // Note: Maxar typically provides download URLs that require authentication
    return {
      mode: 'reference',
      sizeBytes: orthoAsset.size || null,
      sha256: null,
    };
  } catch (error) {
    console.error('Maxar acquisition error:', error);
    return {
      mode: dest.mode,
      sizeBytes: null,
      sha256: null,
    };
  }
}

/**
 * Validate Maxar asset
 */
async function validateMaxar(
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
      name: 'gsd_valid',
      ok: !asset.quality?.groundSampleDistance || asset.quality.groundSampleDistance > 0,
      detail: asset.quality?.groundSampleDistance ? undefined : 'Invalid GSD value',
    },
  ];
  
  const ok = checks.every(c => c.ok);
  
  return { ok, checks };
}

/**
 * Normalize Maxar asset to FirstLight catalog
 */
async function normalizeMaxar(
  asset: DiscoveredAsset,
  acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null },
  ctx: ProcessingContext,
): Promise<NormalizedProduct[]> {
  const satellite = asset.raw?.satellite || 'WorldView3';
  const assetType = MAXAR_ASSET_TYPES.find(t => t.satellite === satellite);
  
  return [
    {
      adapterId: 'maxar',
      provider: 'Maxar',
      assetType: `imagery.maxar.${satellite.toLowerCase()}`,
      externalId: asset.externalId,
      title: asset.title,
      acquiredAt: asset.acquiredAt ? new Date(asset.acquiredAt) : null,
      publishedAt: asset.publishedAt ? new Date(asset.publishedAt) : null,
      license: MAXAR_LICENSE.name,
      attribution: MAXAR_LICENSE.attribution,
      url: asset.url,
      checksumSha256: acquired.sha256,
      sizeBytes: acquired.sizeBytes,
      quality: {
        ...asset.quality,
        provider: 'Maxar',
        satellite,
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
 * Maxar adapter
 */
export const maxarAdapter: DataSourceAdapter = {
  id: 'maxar',
  label: 'Maxar Open Data',
  kind: 'imagery',
  health: 'blocked',
  healthNote: 'Requires FIRSTLIGHT_MAXAR_CLIENT_ID and FIRSTLIGHT_MAXAR_CLIENT_SECRET from https://www.maxar.com/open-data',
  
  license() {
    return MAXAR_LICENSE;
  },
  
  async discover(req: DiscoveryRequest, deps?: AdapterDeps): Promise<DiscoveredAsset[]> {
    const config = getConfig(deps);
    return discoverMaxar(req, config, deps);
  },
  
  async acquire(asset: DiscoveredAsset, dest: { mode: 'reference' | 'buffer'; maxBytes: number }, deps?: AdapterDeps): Promise<{ mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }> {
    const config = getConfig(deps);
    return acquireMaxar(asset, dest, config, deps);
  },
  
  async validate(asset: DiscoveredAsset, acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }): Promise<{ ok: boolean; checks: Array<{ name: string; ok: boolean; detail?: string }> }> {
    return validateMaxar(asset, acquired);
  },
  
  async normalize(asset: DiscoveredAsset, acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }, ctx: ProcessingContext): Promise<NormalizedProduct[]> {
    return normalizeMaxar(asset, acquired, ctx);
  },
};

export default maxarAdapter;
