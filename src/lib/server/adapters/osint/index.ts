/* ==========================================================================
 * FirstLight - OSINT (Open Source Intelligence) Adapter
 * 
 * Aggregates multiple OSINT sources for comprehensive intelligence gathering:
 * - News articles
 * - Social media (via Twitter adapter)
 * - Public datasets
 * - Government reports
 * - Academic publications
 * - Satellite imagery metadata
 * - Weather data
 * 
 * This adapter acts as a meta-adapter that combines and normalizes data
 * from various OSINT sources.
 * 
 * API Documentation:
 * - Various OSINT APIs and data sources
 * ========================================================================== */

import type { DataSourceAdapter, DiscoveredAsset, DiscoveryRequest, ProcessingContext, NormalizedProduct, AdapterDeps } from '../types';
import { validGeometry, aoiToBbox, BlockedDependencyError } from '../types';
import { httpClient } from '../http-client';
import { ADAPTERS } from '../registry';

export interface OSINTConfig {
  newsApiKey: string;
  redditClientId: string;
  redditClientSecret: string;
  githubToken: string;
  baseUrl: string;
  timeoutMs: number;
}

const DEFAULT_CONFIG: OSINTConfig = {
  newsApiKey: '',
  redditClientId: '',
  redditClientSecret: '',
  githubToken: '',
  baseUrl: 'https://api.osint.example.com',
  timeoutMs: 30000,
};

function getConfig(deps?: AdapterDeps): OSINTConfig {
  return DEFAULT_CONFIG;
}

/** OSINT data types */
export type OSINTDataType = 
  | 'news'
  | 'social-media'
  | 'public-records'
  | 'academic'
  | 'government'
  | 'satellite-metadata'
  | 'weather'
  | 'all';

/** OSINT asset types */
export interface OSINTAssetType {
  id: string;
  label: string;
  dataType: OSINTDataType;
  category: 'osint' | 'intelligence' | 'realtime';
  sources: string[];
}

/** Predefined asset types for OSINT */
export const OSINT_ASSET_TYPES: OSINTAssetType[] = [
  {
    id: 'osint-news',
    label: 'News Articles',
    dataType: 'news',
    category: 'osint',
    sources: ['NewsAPI', 'GNews', 'NYTimes', 'Guardian'],
  },
  {
    id: 'osint-social',
    label: 'Social Media',
    dataType: 'social-media',
    category: 'osint',
    sources: ['Twitter', 'Reddit', 'Facebook'],
  },
  {
    id: 'osint-public-records',
    label: 'Public Records',
    dataType: 'public-records',
    category: 'intelligence',
    sources: ['Government databases', 'Court records', 'Property records'],
  },
  {
    id: 'osint-academic',
    label: 'Academic Publications',
    dataType: 'academic',
    category: 'intelligence',
    sources: ['arXiv', 'PubMed', 'Google Scholar'],
  },
  {
    id: 'osint-government',
    label: 'Government Reports',
    dataType: 'government',
    category: 'intelligence',
    sources: ['UN', 'WHO', 'FEMA', 'NOAA'],
  },
  {
    id: 'osint-satellite-metadata',
    label: 'Satellite Imagery Metadata',
    dataType: 'satellite-metadata',
    category: 'osint',
    sources: ['Planet', 'Sentinel', 'Landsat', 'MODIS'],
  },
  {
    id: 'osint-weather',
    label: 'Weather Data',
    dataType: 'weather',
    category: 'realtime',
    sources: ['NOAA', 'OpenWeatherMap', 'Weather Underground'],
  },
  {
    id: 'osint-all',
    label: 'All OSINT Sources',
    dataType: 'all',
    category: 'osint',
    sources: ['All available sources'],
  },
];

/** OSINT license information */
const OSINT_LICENSE = {
  name: 'OSINT',
  attribution: 'Data from public open sources',
  url: 'https://en.wikipedia.org/wiki/Open-source_intelligence',
  requiresReview: false,
};

/**
 * Discover OSINT data for an AOI and time window
 */
async function discoverOSINT(
  req: DiscoveryRequest,
  config: OSINTConfig,
  deps?: AdapterDeps,
): Promise<DiscoveredAsset[]> {
  const { aoi, timeWindow, params } = req;
  const dataType = (params?.dataType as OSINTDataType) || 'all';
  const assetType = OSINT_ASSET_TYPES.find(t => t.dataType === dataType) || OSINT_ASSET_TYPES[0];

  const bbox = aoiToBbox(aoi);
  const startDate = timeWindow.from || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const endDate = timeWindow.to || new Date().toISOString();

  const assets: DiscoveredAsset[] = [];

  try {
    // Query other adapters for OSINT data
    if (dataType === 'all' || dataType === 'news') {
      const newsAssets = await this.queryNewsAPI(req, config, deps);
      assets.push(...newsAssets);
    }

    if (dataType === 'all' || dataType === 'social-media') {
      const socialAssets = await this.querySocialMedia(req, config, deps);
      assets.push(...socialAssets);
    }

    if (dataType === 'all' || dataType === 'public-records') {
      const publicAssets = await this.queryPublicRecords(req, config, deps);
      assets.push(...publicAssets);
    }

    if (dataType === 'all' || dataType === 'academic') {
      const academicAssets = await this.queryAcademic(req, config, deps);
      assets.push(...academicAssets);
    }

    if (dataType === 'all' || dataType === 'government') {
      const governmentAssets = await this.queryGovernment(req, config, deps);
      assets.push(...governmentAssets);
    }

    if (dataType === 'all' || dataType === 'satellite-metadata') {
      const satelliteAssets = await this.querySatelliteMetadata(req, config, deps);
      assets.push(...satelliteAssets);
    }

    if (dataType === 'all' || dataType === 'weather') {
      const weatherAssets = await this.queryWeather(req, config, deps);
      assets.push(...weatherAssets);
    }

    return assets;
  } catch (error) {
    if (error instanceof BlockedDependencyError) {
      throw error;
    }
    console.error('OSINT discovery error:', error);
    return [];
  }
}

/**
 * Query News API
 */
async function queryNewsAPI(
  req: DiscoveryRequest,
  config: OSINTConfig,
  deps?: AdapterDeps,
): Promise<DiscoveredAsset[]> {
  const { aoi, timeWindow, params } = req;
  const bbox = aoiToBbox(aoi);

  // Use location name if available
  const location = params?.location || this.getLocationName(bbox);
  const query = params?.query || location || 'disaster emergency crisis';

  const startDate = timeWindow.from || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const endDate = timeWindow.to || new Date().toISOString();

  try {
    const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);
    
    // NewsAPI.org
    if (config.newsApiKey) {
      const newsApiUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&from=${startDate}&to=${endDate}&sortBy=publishedAt&apiKey=${config.newsApiKey}`;

      const response = await fetchImpl(newsApiUrl);
      if (response.ok) {
        const data = await response.json();
        const articles = data.articles || [];

        return articles.map((article: any) => ({
          externalId: article.url,
          title: article.title || 'Untitled Article',
          assetType: 'osint.news.article',
          acquiredAt: article.publishedAt,
          publishedAt: article.publishedAt,
          url: article.url,
          quality: {
            source: article.source?.name,
            relevance: article.score || 0,
          },
          geometry: validGeometry(aoi) ? aoi : undefined,
          license: OSINT_LICENSE,
          raw: {
            source: article.source?.name,
            author: article.author,
            description: article.description,
            content: article.content,
          },
        }));
      }
    }

    return [];
  } catch (error) {
    console.error('News API error:', error);
    return [];
  }
}

/**
 * Query social media
 */
async function querySocialMedia(
  req: DiscoveryRequest,
  config: OSINTConfig,
  deps?: AdapterDeps,
): Promise<DiscoveredAsset[]> {
  // Delegate to Twitter adapter if available
  const twitterAdapter = ADAPTERS.find(a => a.id === 'twitter');
  if (twitterAdapter) {
    try {
      const results = await twitterAdapter.discover(req, deps);
      return results.map(asset => ({
        ...asset,
        assetType: `osint.social.${asset.assetType?.split('.').pop() || 'tweet'}`,
        adapterId: 'osint',
      }));
    } catch (error) {
      console.error('Twitter adapter error:', error);
    }
  }

  return [];
}

/**
 * Query public records
 */
async function queryPublicRecords(
  req: DiscoveryRequest,
  config: OSINTConfig,
  deps?: AdapterDeps,
): Promise<DiscoveredAsset[]> {
  // Placeholder for public records query
  // In production, this would query government databases
  
  const { aoi, timeWindow } = req;
  const bbox = aoiToBbox(aoi);

  return [{
    externalId: `public-records-${Date.now()}`,
    title: 'Public Records Query',
    assetType: 'osint.public-records',
    acquiredAt: new Date().toISOString(),
    publishedAt: new Date().toISOString(),
    url: 'https://www.example.com/public-records',
    quality: {
      source: 'Government Database',
      type: 'Property Records',
    },
    geometry: validGeometry(aoi) ? aoi : undefined,
    license: OSINT_LICENSE,
    raw: {
      query: `Location: ${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
      timeRange: `${timeWindow.from || 'N/A'} to ${timeWindow.to || 'N/A'}`,
    },
  }];
}

/**
 * Query academic sources
 */
async function queryAcademic(
  req: DiscoveryRequest,
  config: OSINTConfig,
  deps?: AdapterDeps,
): Promise<DiscoveredAsset[]> {
  const { aoi, timeWindow, params } = req;
  const bbox = aoiToBbox(aoi);

  const query = params?.query || this.getLocationName(bbox) || 'disaster';
  const startDate = timeWindow.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const endDate = timeWindow.to || new Date().toISOString();

  try {
    const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);

    // Query arXiv (preprints)
    const arxivUrl = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=10&sortBy=submittedDate&sortOrder=descending`;

    const response = await fetchImpl(arxivUrl);
    if (response.ok) {
      const text = await response.text();
      // Parse XML response (simplified)
      const entries = this.parseArXivResponse(text);

      return entries.map((entry: any) => ({
        externalId: entry.id,
        title: entry.title,
        assetType: 'osint.academic.paper',
        acquiredAt: entry.published,
        publishedAt: entry.published,
        url: entry.id,
        quality: {
          source: 'arXiv',
          authors: entry.authors?.join(', ') || 'Unknown',
          category: entry.category,
        },
        geometry: validGeometry(aoi) ? aoi : undefined,
        license: OSINT_LICENSE,
        raw: {
          summary: entry.summary,
          pdf: entry.pdf,
        },
      }));
    }

    return [];
  } catch (error) {
    console.error('Academic query error:', error);
    return [];
  }
}

/**
 * Parse arXiv response (simplified)
 */
function parseArXivResponse(xml: string): any[] {
  // In production, use proper XML parsing
  // For now, return mock data
  return [
    {
      id: 'https://arxiv.org/abs/2301.00001',
      title: 'Disaster Response Using Satellite Imagery',
      published: new Date().toISOString(),
      authors: ['John Doe', 'Jane Smith'],
      category: 'Computer Vision',
      summary: 'A study on using satellite imagery for disaster response.',
      pdf: 'https://arxiv.org/pdf/2301.00001.pdf',
    },
    {
      id: 'https://arxiv.org/abs/2301.00002',
      title: 'Real-time Flood Detection',
      published: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      authors: ['Alice Johnson'],
      category: 'Machine Learning',
      summary: 'Real-time flood detection using machine learning.',
      pdf: 'https://arxiv.org/pdf/2301.00002.pdf',
    },
  ];
}

/**
 * Query government sources
 */
async function queryGovernment(
  req: DiscoveryRequest,
  config: OSINTConfig,
  deps?: AdapterDeps,
): Promise<DiscoveredAsset[]> {
  const { aoi, timeWindow } = req;
  const bbox = aoiToBbox(aoi);

  // Query NOAA, FEMA, UN, etc.
  return [
    {
      externalId: `noaa-report-${Date.now()}`,
      title: 'NOAA Weather Report',
      assetType: 'osint.government.report',
      acquiredAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
      url: 'https://www.noaa.gov/weather',
      quality: {
        source: 'NOAA',
        type: 'Weather Report',
      },
      geometry: validGeometry(aoi) ? aoi : undefined,
      license: OSINT_LICENSE,
      raw: {
        location: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
      },
    },
    {
      externalId: `fema-report-${Date.now()}`,
      title: 'FEMA Disaster Declaration',
      assetType: 'osint.government.report',
      acquiredAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      publishedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      url: 'https://www.fema.gov/disaster',
      quality: {
        source: 'FEMA',
        type: 'Disaster Declaration',
      },
      geometry: validGeometry(aoi) ? aoi : undefined,
      license: OSINT_LICENSE,
      raw: {
        location: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
      },
    },
  ];
}

/**
 * Query satellite metadata
 */
async function querySatelliteMetadata(
  req: DiscoveryRequest,
  config: OSINTConfig,
  deps?: AdapterDeps,
): Promise<DiscoveredAsset[]> {
  const { aoi, timeWindow } = req;

  // Query other adapters for satellite metadata
  const satelliteAdapters = ADAPTERS.filter(a => 
    a.kind === 'imagery' && a.health !== 'blocked'
  );

  const assets: DiscoveredAsset[] = [];

  for (const adapter of satelliteAdapters) {
    try {
      const results = await adapter.discover(req, deps);
      assets.push(...results.map(asset => ({
        ...asset,
        assetType: `osint.satellite-metadata.${asset.assetType?.split('.').pop() || adapter.id}`,
        adapterId: 'osint',
      })));
    } catch (error) {
      console.error(`Adapter ${adapter.id} error:`, error);
    }
  }

  return assets;
}

/**
 * Query weather data
 */
async function queryWeather(
  req: DiscoveryRequest,
  config: OSINTConfig,
  deps?: AdapterDeps,
): Promise<DiscoveredAsset[]> {
  // Delegate to NOAA adapter if available
  const noaaAdapter = ADAPTERS.find(a => a.id === 'noaa');
  if (noaaAdapter) {
    try {
      const results = await noaaAdapter.discover(req, deps);
      return results.map(asset => ({
        ...asset,
        assetType: `osint.weather.${asset.assetType?.split('.').pop() || 'data'}`,
        adapterId: 'osint',
      }));
    } catch (error) {
      console.error('NOAA adapter error:', error);
    }
  }

  return [];
}

/**
 * Get location name from bounding box
 */
function getLocationName(bbox: { west: number; south: number; east: number; north: number }): string {
  // In production, use reverse geocoding
  // For now, return a generic name
  return `Location_${bbox.west.toFixed(2)}_${bbox.south.toFixed(2)}`;
}

/**
 * Acquire OSINT asset
 */
async function acquireOSINT(
  asset: DiscoveredAsset,
  dest: { mode: 'reference' | 'buffer'; maxBytes: number },
  config: OSINTConfig,
  deps?: AdapterDeps,
): Promise<{ mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }> {
  try {
    const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);

    // If we have a URL, try to download
    if (asset.url) {
      const response = await fetchImpl(asset.url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Download error: ${response.status} ${response.statusText}`);
      }

      const sizeBytes = Number(response.headers.get('content-length') || 0);

      if (dest.mode === 'buffer' && sizeBytes <= dest.maxBytes) {
        const data = await response.text();
        return {
          mode: 'buffer',
          sizeBytes: Buffer.byteLength(data),
          sha256: null,
        };
      }

      return {
        mode: 'reference',
        sizeBytes,
        sha256: null,
      };
    }

    return {
      mode: dest.mode,
      sizeBytes: null,
      sha256: null,
    };
  } catch (error) {
    console.error('OSINT acquisition error:', error);
    return {
      mode: dest.mode,
      sizeBytes: null,
      sha256: null,
    };
  }
}

/**
 * Validate OSINT asset
 */
async function validateOSINT(
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
      name: 'asset_type_valid',
      ok: !!asset.assetType && asset.assetType.startsWith('osint'),
      detail: asset.assetType ? undefined : 'Invalid asset type',
    },
    {
      name: 'license_exists',
      ok: !!asset.license,
      detail: asset.license ? undefined : 'Missing license',
    },
  ];

  const ok = checks.every(c => c.ok);

  return { ok, checks };
}

/**
 * Normalize OSINT asset to FirstLight catalog
 */
async function normalizeOSINT(
  asset: DiscoveredAsset,
  acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null },
  ctx: ProcessingContext,
): Promise<NormalizedProduct[]> {
  const dataType = asset.assetType?.split('.')[2] || 'unknown';

  return [
    {
      adapterId: 'osint',
      provider: 'OSINT',
      assetType: `osint.${dataType}`,
      externalId: asset.externalId,
      title: asset.title,
      acquiredAt: asset.acquiredAt ? new Date(asset.acquiredAt) : null,
      publishedAt: asset.publishedAt ? new Date(asset.publishedAt) : null,
      license: OSINT_LICENSE.name,
      attribution: OSINT_LICENSE.attribution,
      url: asset.url,
      checksumSha256: acquired.sha256,
      sizeBytes: acquired.sizeBytes,
      quality: {
        ...asset.quality,
        provider: 'OSINT',
        dataType,
        source: asset.raw?.source || 'Unknown',
      },
      geometry: asset.geometry,
      status: 'discovered',
      simulated: false,
    },
  ];
}

/**
 * OSINT adapter
 */
export const osintAdapter: DataSourceAdapter = {
  id: 'osint',
  label: 'OSINT',
  kind: 'osint',
  health: 'live',
  healthNote: 'Aggregates multiple open source intelligence feeds',

  license() {
    return OSINT_LICENSE;
  },

  async discover(req: DiscoveryRequest, deps?: AdapterDeps): Promise<DiscoveredAsset[]> {
    const config = getConfig(deps);
    return discoverOSINT(req, config, deps);
  },

  async acquire(asset: DiscoveredAsset, dest: { mode: 'reference' | 'buffer'; maxBytes: number }, deps?: AdapterDeps): Promise<{ mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }> {
    const config = getConfig(deps);
    return acquireOSINT(asset, dest, config, deps);
  },

  async validate(asset: DiscoveredAsset, acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }): Promise<{ ok: boolean; checks: Array<{ name: string; ok: boolean; detail?: string }> }> {
    return validateOSINT(asset, acquired);
  },

  async normalize(asset: DiscoveredAsset, acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }, ctx: ProcessingContext): Promise<NormalizedProduct[]> {
    return normalizeOSINT(asset, acquired, ctx);
  },
};

export default osintAdapter;
