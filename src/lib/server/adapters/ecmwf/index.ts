/* ==========================================================================
 * FirstLight - ECMWF (European Centre for Medium-Range Weather Forecasts) Adapter
 * 
 * Provides access to ECMWF weather and climate data including:
 * - ERA5 reanalysis data
 * - CAMS (Copernicus Atmosphere Monitoring Service) data
 * - Seasonal forecasts
 * - Climate projections
 * - Real-time weather observations
 * 
 * ECMWF provides high-quality global numerical weather prediction data.
 * 
 * API Documentation:
 * - https://confluence.ecmwf.int/display/WEBAPI
 * - https://apps.ecmwf.int/webapi/
 * - https://cds.climate.copernicus.eu/
 * ========================================================================== */

import type { DataSourceAdapter, DiscoveredAsset, DiscoveryRequest, ProcessingContext, NormalizedProduct, AdapterDeps } from '../types';
import { requireEnv, validGeometry, aoiToBbox, BlockedDependencyError } from '../types';
import { httpClient } from '../http-client';

export interface ECMWFConfig {
  apiKey: string;
  baseUrl: string;
  cdsBaseUrl: string;
  timeoutMs: number;
}

const DEFAULT_CONFIG: ECMWFConfig = {
  apiKey: '',
  baseUrl: 'https://api.ecmwf.int/v1',
  cdsBaseUrl: 'https://cds.climate.copernicus.eu/api/v2',
  timeoutMs: 60000,
};

function getConfig(deps?: AdapterDeps): ECMWFConfig {
  return {
    ...DEFAULT_CONFIG,
    apiKey: requireEnv('FIRSTLIGHT_ECMWF_API_KEY', 'ecmwf', 'Get from https://apps.ecmwf.int/webapi/'),
  };
}

/** ECMWF data types */
export type ECMWFDataType = 
  | 'era5'
  | 'era5-land'
  | 'cams'
  | 'seasonal-forecast'
  | 'climate-projection'
  | 'realtime-observation'
  | 's2s-forecast';

/** ECMWF asset types */
export interface ECMWFAssetType {
  id: string;
  label: string;
  dataType: ECMWFDataType;
  category: 'weather' | 'climate' | 'forecast';
  resolution: string;
  temporalResolution: string;
  parameters: string[];
}

/** Predefined asset types for ECMWF */
export const ECMWF_ASSET_TYPES: ECMWFAssetType[] = [
  {
    id: 'ecmwf-era5',
    label: 'ERA5 Reanalysis',
    dataType: 'era5',
    category: 'climate',
    resolution: '31km',
    temporalResolution: 'hourly',
    parameters: ['temperature', 'precipitation', 'wind', 'pressure', 'humidity'],
  },
  {
    id: 'ecmwf-era5-land',
    label: 'ERA5-Land',
    dataType: 'era5-land',
    category: 'climate',
    resolution: '9km',
    temporalResolution: 'hourly',
    parameters: ['temperature', 'precipitation', 'soil_moisture', 'snow'],
  },
  {
    id: 'ecmwf-cams',
    label: 'CAMS Atmosphere',
    dataType: 'cams',
    category: 'weather',
    resolution: '40km',
    temporalResolution: '3-hourly',
    parameters: ['aerosol', 'ozone', 'co2', 'pm25', 'pm10'],
  },
  {
    id: 'ecmwf-seasonal',
    label: 'Seasonal Forecast',
    dataType: 'seasonal-forecast',
    category: 'forecast',
    resolution: '50km',
    temporalResolution: 'monthly',
    parameters: ['temperature', 'precipitation', 'sea_ice'],
  },
  {
    id: 'ecmwf-s2s',
    label: 'Sub-seasonal to Seasonal Forecast',
    dataType: 's2s-forecast',
    category: 'forecast',
    resolution: '50km',
    temporalResolution: 'daily',
    parameters: ['temperature', 'precipitation', 'wind'],
  },
  {
    id: 'ecmwf-realtime',
    label: 'Real-time Observations',
    dataType: 'realtime-observation',
    category: 'weather',
    resolution: 'point',
    temporalResolution: 'real-time',
    parameters: ['temperature', 'wind', 'pressure', 'humidity'],
  },
];

/** ECMWF license information */
const ECMWF_LICENSE = {
  name: 'ECMWF',
  attribution: 'Data provided by ECMWF',
  url: 'https://www.ecmwf.int/',
  requiresReview: false,
};

/**
 * Discover ECMWF data for an AOI and time window
 */
async function discoverECMWF(
  req: DiscoveryRequest,
  config: ECMWFConfig,
  deps?: AdapterDeps,
): Promise<DiscoveredAsset[]> {
  const { aoi, timeWindow, params } = req;
  const dataType = (params?.dataType as ECMWFDataType) || 'era5';
  const assetType = ECMWF_ASSET_TYPES.find(t => t.dataType === dataType) || ECMWF_ASSET_TYPES[0];

  const bbox = aoiToBbox(aoi);
  const startDate = timeWindow.from || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const endDate = timeWindow.to || new Date().toISOString();

  // Build CDS API request
  const requestBody = {
    stream: dataType === 'era5' ? 'oper' : undefined,
    expver: '1',
    class: 'ea',
    type: dataType === 'era5' ? 'an' : undefined,
    param: this.getParametersForDataType(dataType),
    levtype: 'sfc',
    levelist: 'surface',
    date: this.formatDateRange(startDate, endDate),
    time: this.getTimeList(dataType),
    step: '0',
    area: [bbox.north, bbox.west, bbox.south, bbox.east],
    grid: [assetType.resolution.includes('km') ? '0.25/0.25' : '1.0/1.0'],
    format: 'grib',
  };

  try {
    const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);
    const url = `${config.cdsBaseUrl}/resources/reanalysis-era5-single-levels`;
    
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ECMWF CDS API error: ${response.status} ${response.statusText} - ${error}`);
    }

    const data = await response.json();
    
    // Parse CDS response and create assets
    const assets: DiscoveredAsset[] = [];
    
    // For CDS, we typically get a request ID that we need to poll
    if (data.request_id) {
      // Poll for results
      const result = await this.pollCDSRequest(config, data.request_id, deps);
      
      if (result.state === 'completed') {
        // Create assets from the result
        const asset = this.createAssetFromCDSResult(result, assetType, aoi);
        assets.push(asset);
      }
    }

    return assets;
  } catch (error) {
    if (error instanceof BlockedDependencyError) {
      throw error;
    }
    console.error('ECMWF discovery error:', error);
    return [];
  }
}

/**
 * Poll CDS request for completion
 */
async function pollCDSRequest(
  config: ECMWFConfig,
  requestId: string,
  deps?: AdapterDeps,
  maxAttempts: number = 30,
  delayMs: number = 5000,
): Promise<any> {
  const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);
  const url = `${config.cdsBaseUrl}/tasks/${requestId}`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetchImpl(url, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`CDS polling error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.state === 'completed' || data.state === 'failed') {
      return data;
    }

    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  throw new Error('CDS request timed out');
}

/**
 * Create asset from CDS result
 */
function createAssetFromCDSResult(
  result: any,
  assetType: ECMWFAssetType,
  aoi: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): DiscoveredAsset {
  return {
    externalId: result.request_id,
    title: `ECMWF ${assetType.label} Data`,
    assetType: `weather.ecmwf.${assetType.dataType}`,
    acquiredAt: new Date().toISOString(),
    publishedAt: new Date().toISOString(),
    url: result.location || result.download_url,
    quality: {
      resolution: assetType.resolution,
      temporalResolution: assetType.temporalResolution,
      provider: 'ECMWF',
    },
    geometry: validGeometry(aoi) ? aoi : undefined,
    license: ECMWF_LICENSE,
    raw: {
      dataType: assetType.dataType,
      parameters: assetType.parameters,
      requestId: result.request_id,
      location: result.location,
    },
  };
}

/**
 * Get parameters for data type
 */
function getParametersForDataType(dataType: ECMWFDataType): string[] {
  const assetType = ECMWF_ASSET_TYPES.find(t => t.dataType === dataType);
  if (!assetType) return ['167.128']; // Default: 2m temperature

  // Map parameter names to ECMWF codes
  const paramMap: Record<string, string> = {
    temperature: '167.128', // 2m temperature
    precipitation: '228.128', // Total precipitation
    wind: '165.128/166.128', // U/V component of wind
    pressure: '151.128', // Surface pressure
    humidity: '134.128', // Specific humidity
    soil_moisture: '39.128', // Volumetric soil water
    snow: '141.128', // Snow depth
    aerosol: '203.128', // Aerosol optical depth
    ozone: '206.128', // Ozone mass mixing ratio
    co2: '204.128', // CO2 concentration
    pm25: '203.254', // PM2.5
    pm10: '203.255', // PM10
    sea_ice: '31.128', // Sea ice cover
  };

  return assetType.parameters.map(p => paramMap[p] || '167.128');
}

/**
 * Get time list for data type
 */
function getTimeList(dataType: ECMWFDataType): string {
  switch (dataType) {
    case 'era5':
    case 'era5-land':
      return '00:00:00/01:00:00/02:00:00/03:00:00/04:00:00/05:00:00/06:00:00/07:00:00/08:00:00/09:00:00/10:00:00/11:00:00/12:00:00/13:00:00/14:00:00/15:00:00/16:00:00/17:00:00/18:00:00/19:00:00/20:00:00/21:00:00/22:00:00/23:00:00';
    case 'cams':
      return '00:00:00/06:00:00/12:00:00/18:00:00';
    case 'seasonal-forecast':
      return '00:00:00';
    case 's2s-forecast':
      return '00:00:00/12:00:00';
    default:
      return '00:00:00';
  }
}

/**
 * Format date range for CDS API
 */
function formatDateRange(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  
  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];
  
  return `${startStr}/to/${endStr}`;
}

/**
 * Acquire ECMWF asset
 */
async function acquireECMWF(
  asset: DiscoveredAsset,
  dest: { mode: 'reference' | 'buffer'; maxBytes: number },
  config: ECMWFConfig,
  deps?: AdapterDeps,
): Promise<{ mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }> {
  try {
    const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);
    
    // If we have a download URL, use it
    if (asset.url) {
      if (dest.mode === 'reference') {
        return {
          mode: 'reference',
          sizeBytes: null,
          sha256: null,
        };
      }

      // For buffer mode, we would download the file
      // Note: ECMWF files can be very large (GBs)
      const response = await fetchImpl(asset.url, {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`ECMWF download error: ${response.status} ${response.statusText}`);
      }

      const sizeBytes = Number(response.headers.get('content-length') || 0);

      // For large files, we might not want to load into memory
      if (sizeBytes > dest.maxBytes) {
        return {
          mode: 'reference',
          sizeBytes,
          sha256: null,
        };
      }

      return {
        mode: 'buffer',
        sizeBytes,
        sha256: null,
      };
    }

    // If no URL, return reference mode
    return {
      mode: 'reference',
      sizeBytes: null,
      sha256: null,
    };
  } catch (error) {
    console.error('ECMWF acquisition error:', error);
    return {
      mode: dest.mode,
      sizeBytes: null,
      sha256: null,
    };
  }
}

/**
 * Validate ECMWF asset
 */
async function validateECMWF(
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
      name: 'data_type_valid',
      ok: !!asset.raw?.dataType && ECMWF_ASSET_TYPES.some(t => t.dataType === asset.raw.dataType),
      detail: asset.raw?.dataType ? undefined : 'Invalid data type',
    },
    {
      name: 'url_exists',
      ok: !!asset.url,
      detail: asset.url ? undefined : 'Missing download URL',
    },
  ];

  const ok = checks.every(c => c.ok);

  return { ok, checks };
}

/**
 * Normalize ECMWF asset to FirstLight catalog
 */
async function normalizeECMWF(
  asset: DiscoveredAsset,
  acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null },
  ctx: ProcessingContext,
): Promise<NormalizedProduct[]> {
  const dataType = asset.raw?.dataType || 'era5';
  const assetType = ECMWF_ASSET_TYPES.find(t => t.dataType === dataType) || ECMWF_ASSET_TYPES[0];

  return [
    {
      adapterId: 'ecmwf',
      provider: 'ECMWF',
      assetType: `weather.ecmwf.${dataType}`,
      externalId: asset.externalId,
      title: asset.title,
      acquiredAt: asset.acquiredAt ? new Date(asset.acquiredAt) : null,
      publishedAt: asset.publishedAt ? new Date(asset.publishedAt) : null,
      license: ECMWF_LICENSE.name,
      attribution: ECMWF_LICENSE.attribution,
      url: asset.url,
      checksumSha256: acquired.sha256,
      sizeBytes: acquired.sizeBytes,
      quality: {
        ...asset.quality,
        provider: 'ECMWF',
        dataType,
        category: assetType.category,
        resolution: assetType.resolution,
        temporalResolution: assetType.temporalResolution,
        parameters: assetType.parameters,
      },
      geometry: asset.geometry,
      status: 'discovered',
      simulated: false,
    },
  ];
}

/**
 * ECMWF adapter
 */
export const ecmwfAdapter: DataSourceAdapter = {
  id: 'ecmwf',
  label: 'ECMWF',
  kind: 'weather',
  health: 'blocked',
  healthNote: 'Requires FIRSTLIGHT_ECMWF_API_KEY from https://apps.ecmwf.int/webapi/',

  license() {
    return ECMWF_LICENSE;
  },

  async discover(req: DiscoveryRequest, deps?: AdapterDeps): Promise<DiscoveredAsset[]> {
    const config = getConfig(deps);
    return discoverECMWF(req, config, deps);
  },

  async acquire(asset: DiscoveredAsset, dest: { mode: 'reference' | 'buffer'; maxBytes: number }, deps?: AdapterDeps): Promise<{ mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }> {
    const config = getConfig(deps);
    return acquireECMWF(asset, dest, config, deps);
  },

  async validate(asset: DiscoveredAsset, acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }): Promise<{ ok: boolean; checks: Array<{ name: string; ok: boolean; detail?: string }> }> {
    return validateECMWF(asset, acquired);
  },

  async normalize(asset: DiscoveredAsset, acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }, ctx: ProcessingContext): Promise<NormalizedProduct[]> {
    return normalizeECMWF(asset, acquired, ctx);
  },
};

export default ecmwfAdapter;
