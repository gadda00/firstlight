/* ==========================================================================
 * FirstLight - Twitter (X) Adapter
 * 
 * Provides access to Twitter data for OSINT (Open Source Intelligence) including:
 * - Tweets with geolocation
 * - Real-time tweet streams
 * - Historical tweet search
 * - User information
 * - Trending topics
 * 
 * Requires Twitter API v2 access: https://developer.twitter.com/
 * 
 * API Documentation:
 * - https://developer.twitter.com/en/docs/twitter-api
 * - https://developer.twitter.com/en/docs/twitter-api/early-access
 * ========================================================================== */

import type { DataSourceAdapter, DiscoveredAsset, DiscoveryRequest, ProcessingContext, NormalizedProduct, AdapterDeps } from '../types';
import { requireEnv, validGeometry, aoiToBbox, BlockedDependencyError } from '../types';
import { httpClient } from '../http-client';

export interface TwitterConfig {
  bearerToken: string;
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  baseUrl: string;
  timeoutMs: number;
}

const DEFAULT_CONFIG: TwitterConfig = {
  bearerToken: '',
  apiKey: '',
  apiSecret: '',
  accessToken: '',
  accessTokenSecret: '',
  baseUrl: 'https://api.twitter.com/2',
  timeoutMs: 30000,
};

function getConfig(deps?: AdapterDeps): TwitterConfig {
  return {
    ...DEFAULT_CONFIG,
    bearerToken: requireEnv('FIRSTLIGHT_TWITTER_BEARER_TOKEN', 'twitter', 'Get from https://developer.twitter.com/'),
  };
}

/** Twitter data types */
export type TwitterDataType = 
  | 'tweets'
  | 'users'
  | 'spaces'
  | 'lists'
  | 'trends';

/** Twitter asset types */
export interface TwitterAssetType {
  id: string;
  label: string;
  dataType: TwitterDataType;
  category: 'social' | 'osint' | 'realtime';
  maxResults: number;
}

/** Predefined asset types for Twitter */
export const TWITTER_ASSET_TYPES: TwitterAssetType[] = [
  {
    id: 'twitter-tweets',
    label: 'Tweets',
    dataType: 'tweets',
    category: 'social',
    maxResults: 100,
  },
  {
    id: 'twitter-geo-tweets',
    label: 'Geolocated Tweets',
    dataType: 'tweets',
    category: 'osint',
    maxResults: 100,
  },
  {
    id: 'twitter-users',
    label: 'User Information',
    dataType: 'users',
    category: 'social',
    maxResults: 100,
  },
  {
    id: 'twitter-trends',
    label: 'Trending Topics',
    dataType: 'trends',
    category: 'osint',
    maxResults: 50,
  },
];

/** Twitter license information */
const TWITTER_LICENSE = {
  name: 'Twitter API',
  attribution: 'Data provided by Twitter',
  url: 'https://developer.twitter.com/en/developer-terms/agreement-and-policy',
  requiresReview: true,
};

/**
 * Discover Twitter data for an AOI and time window
 */
async function discoverTwitter(
  req: DiscoveryRequest,
  config: TwitterConfig,
  deps?: AdapterDeps,
): Promise<DiscoveredAsset[]> {
  const { aoi, timeWindow, params } = req;
  const dataType = (params?.dataType as TwitterDataType) || 'tweets';
  const assetType = TWITTER_ASSET_TYPES.find(t => t.dataType === dataType) || TWITTER_ASSET_TYPES[0];

  const bbox = aoiToBbox(aoi);
  const startTime = timeWindow.from ? new Date(timeWindow.from).toISOString() : undefined;
  const endTime = timeWindow.to ? new Date(timeWindow.to).toISOString() : undefined;

  try {
    const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);
    
    if (dataType === 'tweets' || dataType === 'geo-tweets') {
      // Search for tweets
      const query = params?.query || '';
      const maxResults = params?.limit || assetType.maxResults;

      // Build geo query if we have a bounding box
      let geoQuery = '';
      if (bbox && dataType === 'geo-tweets') {
        geoQuery = `point_radius:[${bbox.west} ${bbox.south} ${bbox.east} ${bbox.north}]`;
      }

      // Build time query
      let timeQuery = '';
      if (startTime && endTime) {
        timeQuery = ` start_time:${startTime} end_time:${endTime}`;
      } else if (startTime) {
        timeQuery = ` start_time:${startTime}`;
      } else if (endTime) {
        timeQuery = ` end_time:${endTime}`;
      }

      // Twitter API v2 search endpoint
      const searchUrl = `${config.baseUrl}/tweets/search/recent`;
      const searchParams = new URLSearchParams({
        query: `${query}${geoQuery}${timeQuery}`,
        'tweet.fields': 'created_at,geo,author_id,text,lang,source,public_metrics',
        'user.fields': 'name,username,location,description',
        'expansions': 'author_id,geo.place_id',
        'place.fields': 'full_name,country,geometry',
        max_results: String(Math.min(maxResults, 100)),
      });

      const url = `${searchUrl}?${searchParams.toString()}`;

      const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.bearerToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Twitter API error: ${response.status} ${response.statusText} - ${error}`);
      }

      const data = await response.json();
      const tweets = data.data || [];

      // Create assets from tweets
      const assets: DiscoveredAsset[] = tweets.map((tweet: any) => {
        const geometry = tweet.geo ? {
          type: 'Point',
          coordinates: tweet.geo.coordinates?.coordinates || [0, 0],
        } : undefined;

        const place = tweet.geo?.place_id ? data.includes?.places?.find((p: any) => p.id === tweet.geo.place_id) : null;

        return {
          externalId: tweet.id,
          title: tweet.text?.substring(0, 100) || `Tweet ${tweet.id}`,
          assetType: `social.twitter.${dataType}`,
          acquiredAt: tweet.created_at,
          publishedAt: tweet.created_at,
          url: `https://twitter.com/i/web/status/${tweet.id}`,
          quality: {
            author: tweet.author_id,
            language: tweet.lang,
            retweets: tweet.public_metrics?.retweet_count || 0,
            likes: tweet.public_metrics?.like_count || 0,
            replies: tweet.public_metrics?.reply_count || 0,
          },
          geometry: validGeometry(geometry) ? geometry : undefined,
          license: TWITTER_LICENSE,
          raw: {
            tweetId: tweet.id,
            authorId: tweet.author_id,
            text: tweet.text,
            lang: tweet.lang,
            source: tweet.source,
            place: place ? {
              id: place.id,
              name: place.full_name,
              country: place.country,
              bbox: place.geometry?.bbox,
            } : null,
          },
        };
      });

      return assets;
    } else if (dataType === 'users') {
      // Search for users
      const query = params?.query || '';
      const maxResults = params?.limit || assetType.maxResults;

      const searchUrl = `${config.baseUrl}/users/by/username/${query}`;

      const response = await fetchImpl(searchUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.bearerToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Twitter API error: ${response.status} ${response.statusText} - ${error}`);
      }

      const data = await response.json();
      const user = data.data;

      if (user) {
        return [{
          externalId: user.id,
          title: user.name || `@${user.username}`,
          assetType: 'social.twitter.user',
          acquiredAt: user.created_at,
          publishedAt: user.created_at,
          url: `https://twitter.com/${user.username}`,
          quality: {
            followers: user.public_metrics?.followers_count || 0,
            following: user.public_metrics?.following_count || 0,
            tweets: user.public_metrics?.tweet_count || 0,
          },
          geometry: validGeometry(aoi) ? aoi : undefined,
          license: TWITTER_LICENSE,
          raw: {
            userId: user.id,
            username: user.username,
            name: user.name,
            description: user.description,
            location: user.location,
          },
        }];
      }
    } else if (dataType === 'trends') {
      // Get trending topics
      const woeid = params?.woeid || '1'; // Default: worldwide

      const trendsUrl = `${config.baseUrl}/trends/place/${woeid}`;

      const response = await fetchImpl(trendsUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.bearerToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Twitter API error: ${response.status} ${response.statusText} - ${error}`);
      }

      const data = await response.json();
      const trends = data.data?.[0]?.trends || [];

      return trends.map((trend: any) => ({
        externalId: trend.name,
        title: trend.name,
        assetType: 'social.twitter.trend',
        acquiredAt: new Date().toISOString(),
        publishedAt: new Date().toISOString(),
        url: trend.url || `https://twitter.com/search?q=${encodeURIComponent(trend.name)}`,
        quality: {
          tweetVolume: trend.tweet_volume,
          rank: trend.rank,
        },
        geometry: validGeometry(aoi) ? aoi : undefined,
        license: TWITTER_LICENSE,
        raw: {
          trend: trend.name,
          tweetVolume: trend.tweet_volume,
          rank: trend.rank,
        },
      }));
    }

    return [];
  } catch (error) {
    if (error instanceof BlockedDependencyError) {
      throw error;
    }
    console.error('Twitter discovery error:', error);
    return [];
  }
}

/**
 * Acquire Twitter asset (get full details)
 */
async function acquireTwitter(
  asset: DiscoveredAsset,
  dest: { mode: 'reference' | 'buffer'; maxBytes: number },
  config: TwitterConfig,
  deps?: AdapterDeps,
): Promise<{ mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }> {
  try {
    const fetchImpl = deps?.fetchImpl || httpClient(config.timeoutMs);

    if (asset.assetType?.includes('tweet')) {
      // Get full tweet details
      const tweetId = asset.raw?.tweetId || asset.externalId;
      const tweetUrl = `${config.baseUrl}/tweets/${tweetId}`;

      const response = await fetchImpl(tweetUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.bearerToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Twitter API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const sizeBytes = Buffer.byteLength(JSON.stringify(data));

      if (dest.mode === 'buffer' && sizeBytes <= dest.maxBytes) {
        return {
          mode: 'buffer',
          sizeBytes,
          sha256: null,
        };
      }

      return {
        mode: 'reference',
        sizeBytes,
        sha256: null,
      };
    }

    if (asset.assetType?.includes('user')) {
      // Get full user details
      const userId = asset.raw?.userId || asset.externalId;
      const userUrl = `${config.baseUrl}/users/${userId}`;

      const response = await fetchImpl(userUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.bearerToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Twitter API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const sizeBytes = Buffer.byteLength(JSON.stringify(data));

      if (dest.mode === 'buffer' && sizeBytes <= dest.maxBytes) {
        return {
          mode: 'buffer',
          sizeBytes,
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
    console.error('Twitter acquisition error:', error);
    return {
      mode: dest.mode,
      sizeBytes: null,
      sha256: null,
    };
  }
}

/**
 * Validate Twitter asset
 */
async function validateTwitter(
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
      name: 'url_exists',
      ok: !!asset.url,
      detail: asset.url ? undefined : 'Missing URL',
    },
    {
      name: 'asset_type_valid',
      ok: !!asset.assetType && asset.assetType.startsWith('social.twitter'),
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
 * Normalize Twitter asset to FirstLight catalog
 */
async function normalizeTwitter(
  asset: DiscoveredAsset,
  acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null },
  ctx: ProcessingContext,
): Promise<NormalizedProduct[]> {
  const dataType = asset.assetType?.split('.').pop() || 'tweet';

  return [
    {
      adapterId: 'twitter',
      provider: 'Twitter',
      assetType: `social.twitter.${dataType}`,
      externalId: asset.externalId,
      title: asset.title,
      acquiredAt: asset.acquiredAt ? new Date(asset.acquiredAt) : null,
      publishedAt: asset.publishedAt ? new Date(asset.publishedAt) : null,
      license: TWITTER_LICENSE.name,
      attribution: TWITTER_LICENSE.attribution,
      url: asset.url,
      checksumSha256: acquired.sha256,
      sizeBytes: acquired.sizeBytes,
      quality: {
        ...asset.quality,
        provider: 'Twitter',
        dataType,
      },
      geometry: asset.geometry,
      status: 'discovered',
      simulated: false,
    },
  ];
}

/**
 * Twitter adapter
 */
export const twitterAdapter: DataSourceAdapter = {
  id: 'twitter',
  label: 'Twitter (X)',
  kind: 'osint',
  health: 'blocked',
  healthNote: 'Requires FIRSTLIGHT_TWITTER_BEARER_TOKEN from https://developer.twitter.com/',

  license() {
    return TWITTER_LICENSE;
  },

  async discover(req: DiscoveryRequest, deps?: AdapterDeps): Promise<DiscoveredAsset[]> {
    const config = getConfig(deps);
    return discoverTwitter(req, config, deps);
  },

  async acquire(asset: DiscoveredAsset, dest: { mode: 'reference' | 'buffer'; maxBytes: number }, deps?: AdapterDeps): Promise<{ mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }> {
    const config = getConfig(deps);
    return acquireTwitter(asset, dest, config, deps);
  },

  async validate(asset: DiscoveredAsset, acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }): Promise<{ ok: boolean; checks: Array<{ name: string; ok: boolean; detail?: string }> }> {
    return validateTwitter(asset, acquired);
  },

  async normalize(asset: DiscoveredAsset, acquired: { mode: 'reference' | 'buffer'; sizeBytes: number | null; sha256: string | null }, ctx: ProcessingContext): Promise<NormalizedProduct[]> {
    return normalizeTwitter(asset, acquired, ctx);
  },
};

export default twitterAdapter;
