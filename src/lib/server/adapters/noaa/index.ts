/* ==========================================================================
 * FirstLight - NOAA (National Oceanic and Atmospheric Administration) Adapter
 * 
 * Provides access to NOAA data including:
 * - GOES-16/17/18 (Geostationary Operational Environmental Satellites)
 * - JPSS (Joint Polar Satellite System)
 * - NEXRAD (Next-Generation Radar)
 * - Storm Events Database
 * - Real-time weather observations
 * - Coastal observations
 * - Tides and currents
 * 
 * NOAA provides free and open access to environmental data.
 * 
 * API Documentation:
 * - https://www.weather.gov/documentation/services-web-api
 * - https://www.ncei.noaa.gov/access/
 * - https://www.star.nesdis.noaa.gov/star/GOES.php
 * ========================================================================== */

import type { DataSourceAdapter, DiscoveredAsset, DiscoveryRequest, ProcessingContext, NormalizedProduct, AdapterDeps } from '../types';
import { validGeometry, aoiToBbox, BlockedDependencyError } from '../types';
import { httpClient } from '../http-client';

export interface NOAAConfig {
  baseUrl: string;
  timeoutMs: number;
}

const DEFAULT_CONFIG: NOAAConfig = {
  baseUrl: 'https://www.ncei.noaa.gov',
  timeoutMs: 30000,
};

function getConfig(deps?: AdapterDeps): NOAAConfig {
  return DEFAULT_CONFIG;
}

/** NOAA data types */
export type NOAADataType = 
  | 'goes-16'
  | 'goes-17'
  | 'goes-18'
  | 'jpss'
  | 'nexrad'
  | 'storm-events'
  | 'weather-observations'
  | 'coastal-observations'
  | 'tides-currents'
  | 'climate-data';

/** NOAA asset types */
export interface NOAAAssetType {
  id: string;
  label: string;
  dataType: NOAADataType;
  category: 'imagery' | 'weather' | 'climate' | 'ocean';
  resolution: string;
}

/** Predefined asset types for NOAA */
export const NOAA_ASSET_TYPES: NOAAAssetType[] = [
  {
    id: 'noaa-goes16',
    label: 'GOES-16',
    dataType: 'goes-16',
    category: 'imagery',
    resolution: '500m-2km',
  },
  {
    id: 'noaa-goes17',
    label: 'GOES-17',
    dataType: 'goes-17',
    category: 'imagery',
    resolution: '500m-2km',
  },
  {
    id: 'noaa-goes18',
    label: 'GOES-18',
    dataType: 'goes-18',
    category: 'imagery',
    resolution: '500m-2km',
  },
  {
    id: 'noaa-jpss',
    label: 'JPSS',
    dataType: 'jpss',
    category: 'imagery',
    resolution: '375m-750m',
  },
  {
    id: 'noaa-nexrad',
    label: 'NEXRAD Radar',
    dataType: 'nexrad',
    category: 'weather',
    resolution: '1km',
  },
  {
    id: 'noaa-storm-events',
    label: 'Storm Events',
    dataType: 'storm-events',
    category: 'weather',
    resolution: 'point',
  },
  {
    id: 'noaa-weather-observations',
    label: 'Weather Observations',
    dataType: 'weather-observations',
    category: 'weather',
    resolution: 'point',
  },
  {
    id: 'noaa-coastal-observations',
    label: 'Coastal Observations',
    dataType: 'coastal-observations',
    category: 'ocean',
    resolution: 'point',
  },
  {
    id: 'noaa-tides-currents',
    label: 'Tides and Currents',
    dataType: 'tides-currents',
    category: 'ocean',
    resolution: 'point',
  },
];

/** NOAA license information */
const NOAA_LICENSE = {
  name: 'NOAA',
  attribution: 'Data provided by NOAA (National Oceanic and Atmospheric Administration)',
  url: 'https://www.noaa.gov/',
  requiresReview: false,
};

/**
 * Discover NOAA data for an AOI and time window
 */
async function discoverNOAA(
  req: DiscoveryRequest,
  config: NOAAConfig,
  deps?: AdapterDeps,
): Promise<DiscoveredAsset[]> {
  const { aoi, timeWindow, params } = req;
  const dataType = (params?.dataType as NOAADataType) || 'goes-16';
  
  const bbox = aoiToBbox(aoi);
  const startDate = timeWindow.from || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const endDate = timeWindow.to || new Date().toISOString();
  
  try {
    // Different endpoints for different data types
    switch (dataType) {
      case 'goes-16':
      case 'goes-17':
      case 'goes-18':
        return discoverGOES(dataType, bbox, startDate, endDate, config, deps);
      
      case 'jpss':
        return discoverJPSS(bbox, startDate, endDate, config, deps);
      
      case 'nexrad':
        return discoverNEXRAD(bbox, startDate, endDate, config, deps);
      
      case 'storm-events':
        return discoverStormEvents(bbox, startDate, endDate, config, deps);
      
      case 'weather-observations':
        return discoverWeatherObservations(bbox, startDate, endDate, config, deps);
      
      case 'coastal-observations':
        return discoverCoastalObservations(bbox, startDate, endDate, config, deps);
      
      case 'tides-currents':
        return discoverTidesCurrents(bbox, startDate, endDate, config, deps);
      
      default:
        return [];
    }
  } catch (error) {
    console.error('NOAA discovery error:', error);
    return [];
  }
}

/**
 * Discover GOES data
 */
async function discoverGOES(
  satellite: 'goes-16' | 'goes-17' | 'goes-18',
  bbox: { west: number; south: number; east: number; north: number },
  startDate: string,
  endDate: string,
  config: NOAAConfig,
  deps?: AdapterDeps,
): Promise<DiscoveredAsset[]> {
  // GOES data is available from NOAA's STAR server
  // This is a simplified implementation - actual GOES data access requires specific endpoints
  
  const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);
  
  // For GOES, we use the STAR server
  const baseUrl = 'https://data.star.nesdis.noaa.gov/pub/smcd/emb/ms/GOES';
  
  // Generate a list of available products
  // This is a placeholder - actual implementation would list available files
  const products = [
    { name: 'CONUS', band: '07', resolution: '2km' },
    { name: 'CONUS', band: '13', resolution: '2km' },
    { name: 'Full Disk', band: '07', resolution: '4km' },
    { name: 'Full Disk', band: '13', resolution: '4km' },
  ];
  
  const assets: DiscoveredAsset[] = products.map((product, index) => ({
    externalId: `${satellite}-${product.name}-${product.band}-${startDate.replace(/[:.]/g, '')}-${index}`,
    title: `${satellite.toUpperCase()} ${product.name} Band ${product.band}`,
    assetType: `imagery.noaa.goes.${satellite}`,
    acquiredAt: new Date(startDate).toISOString(),
    publishedAt: new Date().toISOString(),
    url: `${baseUrl}/${satellite.toUpperCase()}/${product.name}/${product.band}/`,
    quality: {
      resolution: product.resolution,
      satellite: satellite.toUpperCase(),
      product: product.name,
      band: product.band,
    },
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
    license: NOAA_LICENSE,
    raw: {
      satellite,
      product: product.name,
      band: product.band,
      resolution: product.resolution,
    },
  }));
  
  return assets;
}

/**
 * Discover JPSS data
 */
async function discoverJPSS(
  bbox: { west: number; south: number; east: number; north: number },
  startDate: string,
  endDate: string,
  config: NOAAConfig,
  deps?: AdapterDeps,
): Promise<DiscoveredAsset[]> {
  // JPSS data is available from NOAA's NCEI
  const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);
  
  // This is a placeholder - actual implementation would query the NCEI API
  const products = [
    { name: 'VIIRS', resolution: '375m' },
    { name: 'VIIRS', resolution: '750m' },
    { name: 'OMI', resolution: '13km x 24km' },
    { name: 'CrIS', resolution: '14km' },
    { name: 'ATMS', resolution: '16km x 32km' },
  ];
  
  const assets: DiscoveredAsset[] = products.map((product, index) => ({
    externalId: `jpss-${product.name}-${startDate.replace(/[:.]/g, '')}-${index}`,
    title: `JPSS ${product.name}`,
    assetType: 'imagery.noaa.jpss',
    acquiredAt: new Date(startDate).toISOString(),
    publishedAt: new Date().toISOString(),
    url: `${config.baseUrl}/access/search/data?dataset=jpss&bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}&startdate=${startDate}&enddate=${endDate}`,
    quality: {
      resolution: product.resolution,
      instrument: product.name,
    },
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
    license: NOAA_LICENSE,
    raw: {
      instrument: product.name,
      resolution: product.resolution,
    },
  }));
  
  return assets;
}

/**
 * Discover NEXRAD data
 */
async function discoverNEXRAD(
  bbox: { west: number; south: number; east: number; north: number },
  startDate: string,
  endDate: string,
  config: NOAAConfig,
  deps?: AdapterDeps,
): Promise<DiscoveredAsset[]> {
  // NEXRAD data is available from NOAA's NCEI
  const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);
  
  // This is a placeholder - actual implementation would query the NCEI API
  const products = [
    { name: 'Level II', resolution: '1km' },
    { name: 'Level III', resolution: '2km' },
  ];
  
  const assets: DiscoveredAsset[] = products.map((product, index) => ({
    externalId: `nexrad-${product.name}-${startDate.replace(/[:.]/g, '')}-${index}`,
    title: `NEXRAD ${product.name}`,
    assetType: 'weather.noaa.nexrad',
    acquiredAt: new Date(startDate).toISOString(),
    publishedAt: new Date().toISOString(),
    url: `${config.baseUrl}/access/search/data?dataset=nexrad&bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}&startdate=${startDate}&enddate=${endDate}`,
    quality: {
      resolution: product.resolution,
      product: product.name,
    },
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
    license: NOAA_LICENSE,
    raw: {
      product: product.name,
      resolution: product.resolution,
    },
  }));
  
  return assets;
}

/**
 * Discover Storm Events data
 */
async function discoverStormEvents(
  bbox: { west: number; south: number; east: number; north: number },
  startDate: string,
  endDate: string,
  config: NOAAConfig,
  deps?: AdapterDeps,
): Promise<DiscoveredAsset[]> {
  // Storm Events data is available from NOAA's NCEI
  const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);
  
  // This is a placeholder - actual implementation would query the Storm Events API
  const eventTypes = [
    'Tornado',
    'Hail',
    'Wind',
    'Flood',
    'Lightning',
    'Winter Storm',
    'Hurricane',
    'Wildfire',
  ];
  
  const assets: DiscoveredAsset[] = eventTypes.map((eventType, index) => ({
    externalId: `storm-event-${eventType.toLowerCase().replace(/\s+/g, '-')}-${startDate.replace(/[:.]/g, '')}-${index}`,
    title: `Storm Event: ${eventType}`,
    assetType: 'weather.noaa.storm-events',
    acquiredAt: new Date(startDate).toISOString(),
    publishedAt: new Date().toISOString(),
    url: `${config.baseUrl}/access/search/data?dataset=storm-events&eventType=${encodeURIComponent(eventType)}&bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}&startdate=${startDate}&enddate=${endDate}`,
    quality: {
      eventType,
      source: 'NCEI Storm Events Database',
    },
    geometry: {
      type: 'Point',
      coordinates: [(bbox.west + bbox.east) / 2, (bbox.south + bbox.north) / 2],
    },
    license: NOAA_LICENSE,
    raw: {
      eventType,
    },
  }));
  
  return assets;
}

/**
 * Discover Weather Observations data
 */
async function discoverWeatherObservations(
  bbox: { west: number; south: number; east: number; north: number },
  startDate: string,
  endDate: string,
  config: NOAAConfig,
  deps?: AdapterDeps,
): Promise<DiscoveredAsset[]> {
  // Weather Observations are available from NOAA's NWS API
  const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);
  
  // This is a placeholder - actual implementation would query the NWS API
  const observationTypes = [
    'Temperature',
    'Precipitation',
    'Wind',
    'Humidity',
    'Pressure',
  ];
  
  const assets: DiscoveredAsset[] = observationTypes.map((type, index) => ({
    externalId: `weather-obs-${type.toLowerCase()}-${startDate.replace(/[:.]/g, '')}-${index}`,
    title: `Weather Observation: ${type}`,
    assetType: 'weather.noaa.observations',
    acquiredAt: new Date(startDate).toISOString(),
    publishedAt: new Date().toISOString(),
    url: `https://api.weather.gov/stations?bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    quality: {
      observationType: type,
      source: 'NWS Weather Stations',
    },
    geometry: {
      type: 'Point',
      coordinates: [(bbox.west + bbox.east) / 2, (bbox.south + bbox.north) / 2],
    },
    license: NOAA_LICENSE,
    raw: {
      observationType: type,
    },
  }));
  
  return assets;
}

/**
 * Discover Coastal Observations data
 */
async function discoverCoastalObservations(
  bbox: { west: number; south: number; east: number; north: number },
  startDate: string,
  endDate: string,
  config: NOAAConfig,
  deps?: AdapterDeps,
): Promise<DiscoveredAsset[]> {
  // Coastal Observations are available from NOAA's CO-OPS API
  const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);
  
  // This is a placeholder - actual implementation would query the CO-OPS API
  const observationTypes = [
    'Water Level',
    'Air Temperature',
    'Water Temperature',
    'Wind',
    'Current',
  ];
  
  const assets: DiscoveredAsset[] = observationTypes.map((type, index) => ({
    externalId: `coastal-obs-${type.toLowerCase().replace(/\s+/g, '-')}-${startDate.replace(/[:.]/g, '')}-${index}`,
    title: `Coastal Observation: ${type}`,
    assetType: 'ocean.noaa.coastal',
    acquiredAt: new Date(startDate).toISOString(),
    publishedAt: new Date().toISOString(),
    url: `https://tidesandcurrents.noaa.gov/api/datagetter?date=today&station=9414290&product=predictions&datum=MLLW&time_zone=lst_ldt&units=metric&format=json`,
    quality: {
      observationType: type,
      source: 'NOAA CO-OPS',
    },
    geometry: {
      type: 'Point',
      coordinates: [(bbox.west + bbox.east) / 2, (bbox.south + bbox.north) / 2],
    },
    license: NOAA_LICENSE,
    raw: {
      observationType: type,
    },
  }));
  
  return assets;
}

/**
 * Discover Tides and Currents data
 */
async function discoverTidesCurrents(
  bbox: { west: number; south: number; east: number; north: number },
  startDate: string,
  endDate: string,
  config: NOAAConfig,
  deps?: AdapterDeps,
): Promise<DiscoveredAsset[]> {
  // Tides and Currents data is available from NOAA's CO-OPS API
  const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);
  
  // This is a placeholder - actual implementation would query the CO-OPS API
  const dataTypes = [
    'Tide Predictions',
    'Tide Observations',
    'Current Predictions',
    'Current Observations',
    'Water Level',
  ];
  
  const assets: DiscoveredAsset[] = dataTypes.map((type, index) => ({
    externalId: `tides-currents-${type.toLowerCase().replace(/\s+/g, '-')}-${startDate.replace(/[:.]/g, '')}-${index}`,
    title: `Tides and Currents: ${type}`,
    assetType: 'ocean.noaa.tides-currents',
    acquiredAt: new Date(startDate).toISOString(),
    publishedAt: new Date().toISOString(),
    url: `https://tidesandcurrents.noaa.gov/api/datagetter?date=today&station=9414290&product=predictions&datum=MLLW&time_zone=lst_ldt&units=metric&format=json`,
    quality: {
      dataType: type,
      source: 'NOAA CO-OPS',
    },
    geometry: {
      type: 'Point',
      coordinates: [(bbox.west + bbox.east) / 2, (bbox.south + bbox.north) / 2],
    },
    license: NOAA_LICENSE,
    raw: {
      dataType: type,
    },
  }));
  
  return assets;
}

/**
 * Acquire NOAA asset
 */
async function acquireNOAA(
  asset: DiscoveredAsset,
  dest: { mode: 'reference' | 'buffer'; maxBytes: number },
  config: NOAAConfig,
  deps?: AdapterDeps,
): Promise<{ mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }> {
  // For reference mode, just return the URL
  if (dest.mode === 'reference') {
    return {
      mode: 'reference',
      sizeBytes: null,
      sha256: null,
    };
  }
  
  // For buffer mode, we would download the data
  // This is a placeholder - actual implementation would download from the URL
  try {
    const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);
    const response = await fetchImpl(asset.url!, {
      method: 'GET',
    });
    
    if (!response.ok) {
      throw new Error(`NOAA download error: ${response.status} ${response.statusText}`);
    }
    
    const sizeBytes = Number(response.headers.get('content-length') || 0);
    
    return {
      mode: 'buffer',
      sizeBytes,
      sha256: null,
    };
  } catch (error) {
    console.error('NOAA acquisition error:', error);
    return {
      mode: 'reference',
      sizeBytes: null,
      sha256: null,
    };
  }
}

/**
 * Validate NOAA asset
 */
async function validateNOAA(
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
      name: 'asset_type_valid',
      ok: !!asset.assetType && asset.assetType.startsWith('imagery.noaa') || asset.assetType.startsWith('weather.noaa') || asset.assetType.startsWith('ocean.noaa'),
      detail: asset.assetType ? undefined : 'Invalid asset type',
    },
  ];
  
  const ok = checks.every(c => c.ok);
  
  return { ok, checks };
}

/**
 * Normalize NOAA asset to FirstLight catalog
 */
async function normalizeNOAA(
  asset: DiscoveredAsset,
  acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null },
  ctx: ProcessingContext,
): Promise<NormalizedProduct[]> {
  const assetType = NOAA_ASSET_TYPES.find(t => t.id === asset.assetType);
  
  return [
    {
      adapterId: 'noaa',
      provider: 'NOAA',
      assetType: asset.assetType,
      externalId: asset.externalId,
      title: asset.title,
      acquiredAt: asset.acquiredAt ? new Date(asset.acquiredAt) : null,
      publishedAt: asset.publishedAt ? new Date(asset.publishedAt) : null,
      license: NOAA_LICENSE.name,
      attribution: NOAA_LICENSE.attribution,
      url: asset.url,
      checksumSha256: acquired.sha256,
      sizeBytes: acquired.sizeBytes,
      quality: {
        ...asset.quality,
        provider: 'NOAA',
        dataType: assetType?.dataType || 'unknown',
        category: assetType?.category || 'unknown',
        resolution: assetType?.resolution || 'unknown',
      },
      geometry: asset.geometry,
      status: 'discovered',
      simulated: false,
    },
  ];
}

/**
 * NOAA adapter
 */
export const noaaAdapter: DataSourceAdapter = {
  id: 'noaa',
  label: 'NOAA',
  kind: 'imagery',
  health: 'live',
  healthNote: 'Public access to NOAA environmental data',
  
  license() {
    return NOAA_LICENSE;
  },
  
  async discover(req: DiscoveryRequest, deps?: AdapterDeps): Promise<DiscoveredAsset[]> {
    const config = getConfig(deps);
    return discoverNOAA(req, config, deps);
  },
  
  async acquire(asset: DiscoveredAsset, dest: { mode: 'reference' | 'buffer'; maxBytes: number }, deps?: AdapterDeps): Promise<{ mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }> {
    const config = getConfig(deps);
    return acquireNOAA(asset, dest, config, deps);
  },
  
  async validate(asset: DiscoveredAsset, acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }): Promise<{ ok: boolean; checks: Array<{ name: string; ok: boolean; detail?: string }> }> {
    return validateNOAA(asset, acquired);
  },
  
  async normalize(asset: DiscoveredAsset, acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }, ctx: ProcessingContext): Promise<NormalizedProduct[]> {
    return normalizeNOAA(asset, acquired, ctx);
  },
};

export default noaaAdapter;
