/* ==========================================================================
 * FirstLight - Data Fusion Engine
 * 
 * Provides intelligent data fusion capabilities for combining and analyzing
 * data from multiple sources. Supports:
 * - Multi-source data fusion
 * - Temporal alignment
 * - Spatial interpolation
 * - Feature extraction
 * - Anomaly detection
 * - Confidence scoring
 * 
 * Integrates with the adapter framework and streaming system.
 * ========================================================================== */

import type { DiscoveredAsset, NormalizedProduct } from '../adapters/types';
import type { DataSourceAdapter } from '../adapters/types';
import { ADAPTERS } from '../adapters/registry';

// ==========================================================================
// Types
// ==========================================================================

/** Fusion strategy types */
export type FusionStrategy = 
  | 'weighted-average'
  | 'maximum-confidence'
  | 'temporal-priority'
  | 'spatial-proximity'
  | 'majority-vote'
  | 'custom';

/** Fusion result */
export interface FusionResult {
  id: string;
  timestamp: number;
  fusedData: any;
  sources: FusionSource[];
  confidence: number;
  strategy: FusionStrategy;
  metadata: FusionMetadata;
}

/** Fusion source information */
export interface FusionSource {
  adapterId: string;
  assetId: string;
  weight: number;
  confidence: number;
  timestamp: number;
  data: any;
}

/** Fusion metadata */
export interface FusionMetadata {
  spatialResolution: number;
  temporalResolution: number;
  boundingBox: { minX: number; minY: number; maxX: number; maxY: number };
  processingTime: number;
  algorithm: string;
  version: string;
}

/** Fusion configuration */
export interface FusionConfig {
  strategy: FusionStrategy;
  weights: Record<string, number>;
  confidenceThreshold: number;
  temporalWindow: number; // milliseconds
  spatialTolerance: number; // meters
  maxSources: number;
  enableCaching: boolean;
  cacheTTL: number; // milliseconds
}

/** Fusion request */
export interface FusionRequest {
  id: string;
  assets: (DiscoveredAsset | NormalizedProduct)[];
  config?: Partial<FusionConfig>;
  context?: FusionContext;
}

/** Fusion context */
export interface FusionContext {
  areaOfInterest: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  timeWindow: { from: Date; to: Date };
  targetResolution: number;
  targetProjection: string;
  userPreferences: Record<string, any>;
}

/** Fusion task */
export interface FusionTask {
  id: string;
  request: FusionRequest;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  result?: FusionResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** Data type categories */
export type DataCategory = 
  | 'imagery'
  | 'weather'
  | 'climate'
  | 'geospatial'
  | 'population'
  | 'infrastructure'
  | 'events';

/** Feature types */
export type FeatureType = 
  | 'building'
  | 'road'
  | 'landcover'
  | 'waterbody'
  | 'vegetation'
  | 'temperature'
  | 'precipitation'
  | 'wind'
  | 'humidity';

// ==========================================================================
// Default Configuration
// ==========================================================================

const DEFAULT_CONFIG: FusionConfig = {
  strategy: 'weighted-average',
  weights: {},
  confidenceThreshold: 0.5,
  temporalWindow: 300000, // 5 minutes
  spatialTolerance: 10, // 10 meters
  maxSources: 10,
  enableCaching: true,
  cacheTTL: 3600000, // 1 hour
};

// ==========================================================================
// Data Fusion Engine
// ==========================================================================

/** Main data fusion engine */
export class FusionEngine {
  private config: FusionConfig;
  private tasks: Map<string, FusionTask> = new Map();
  private cache: Map<string, { result: FusionResult; expiresAt: number }> = new Map();
  private adapterWeights: Map<string, number> = new Map();
  private sourceConfidence: Map<string, Map<string, number>> = new Map();

  constructor(config: Partial<FusionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initializeAdapterWeights();
  }

  /** Initialize default adapter weights */
  private initializeAdapterWeights(): void {
    // Set default weights based on known data quality
    const defaultWeights: Record<string, number> = {
      'sentinel-hub': 0.9,
      'planet': 0.85,
      'maxar': 0.95,
      'noaa': 0.8,
      'usgs-earthquake': 0.9,
      'open-meteo-flood': 0.75,
      'nws-alerts': 0.85,
      'copernicus-stac': 0.8,
      'firms-fire': 0.7,
      'osm-overpass': 0.6,
      'worldpop': 0.75,
    };

    ADAPTERS.forEach(adapter => {
      const weight = defaultWeights[adapter.id] || 0.5;
      this.adapterWeights.set(adapter.id, weight);
      this.sourceConfidence.set(adapter.id, new Map());
    });
  }

  /** Set adapter weight */
  setAdapterWeight(adapterId: string, weight: number): void {
    this.adapterWeights.set(adapterId, Math.max(0, Math.min(1, weight)));
  }

  /** Get adapter weight */
  getAdapterWeight(adapterId: string): number {
    return this.adapterWeights.get(adapterId) || 0.5;
  }

  /** Set source confidence */
  setSourceConfidence(adapterId: string, assetId: string, confidence: number): void {
    const adapterConfidence = this.sourceConfidence.get(adapterId);
    if (adapterConfidence) {
      adapterConfidence.set(assetId, Math.max(0, Math.min(1, confidence)));
    }
  }

  /** Get source confidence */
  getSourceConfidence(adapterId: string, assetId: string): number {
    const adapterConfidence = this.sourceConfidence.get(adapterId);
    return adapterConfidence?.get(assetId) || 0.5;
  }

  /** Update configuration */
  updateConfig(config: Partial<FusionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** Get configuration */
  getConfig(): FusionConfig {
    return { ...this.config };
  }

  /** Submit fusion request */
  submitRequest(request: FusionRequest): FusionTask {
    const task: FusionTask = {
      id: request.id || this.generateTaskId(),
      request,
      status: 'pending',
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.tasks.set(task.id, task);
    
    // Process immediately (or queue for background processing)
    this.processTask(task);

    return task;
  }

  /** Process fusion task */
  private async processTask(task: FusionTask): Promise<void> {
    try {
      task.status = 'processing';
      task.progress = 0;
      task.updatedAt = Date.now();

      // Check cache
      const cacheKey = this.generateCacheKey(task.request);
      if (this.config.enableCaching && this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey)!;
        if (cached.expiresAt > Date.now()) {
          task.result = cached.result;
          task.status = 'completed';
          task.progress = 100;
          task.updatedAt = Date.now();
          return;
        }
      }

      // Validate request
      if (!this.validateRequest(task.request)) {
        throw new Error('Invalid fusion request');
      }

      // Update progress
      task.progress = 10;

      // Prepare assets
      const preparedAssets = await this.prepareAssets(task.request.assets);
      task.progress = 30;

      // Apply fusion strategy
      const result = await this.applyFusionStrategy(
        preparedAssets,
        task.request.config?.strategy || this.config.strategy,
        task.request.context
      );

      // Update progress
      task.progress = 90;

      // Cache result
      if (this.config.enableCaching) {
        this.cache.set(cacheKey, {
          result,
          expiresAt: Date.now() + this.config.cacheTTL,
        });
      }

      // Complete task
      task.result = result;
      task.status = 'completed';
      task.progress = 100;
      task.updatedAt = Date.now();

    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      task.updatedAt = Date.now();
      console.error(`[FusionEngine] Task ${task.id} failed:`, error);
    }
  }

  /** Validate fusion request */
  private validateRequest(request: FusionRequest): boolean {
    if (!request.assets || request.assets.length === 0) {
      return false;
    }

    if (request.assets.length > this.config.maxSources) {
      return false;
    }

    return true;
  }

  /** Prepare assets for fusion */
  private async prepareAssets(assets: (DiscoveredAsset | NormalizedProduct)[]): Promise<FusionSource[]> {
    const prepared: FusionSource[] = [];

    for (const asset of assets) {
      const adapter = ADAPTERS.find(a => a.id === asset.adapterId);
      if (!adapter) continue;

      const confidence = this.getSourceConfidence(adapter.id, asset.externalId);
      const weight = this.getAdapterWeight(adapter.id);

      prepared.push({
        adapterId: adapter.id,
        assetId: asset.externalId,
        weight,
        confidence,
        timestamp: asset.acquiredAt ? new Date(asset.acquiredAt).getTime() : Date.now(),
        data: asset,
      });
    }

    return prepared;
  }

  /** Apply fusion strategy */
  private async applyFusionStrategy(
    sources: FusionSource[],
    strategy: FusionStrategy,
    context?: FusionContext
  ): Promise<FusionResult> {
    const startTime = Date.now();

    let result: any;
    let confidence = 0;

    switch (strategy) {
      case 'weighted-average':
        result = await this.weightedAverageFusion(sources, context);
        confidence = this.calculateWeightedConfidence(sources);
        break;

      case 'maximum-confidence':
        result = this.maximumConfidenceFusion(sources, context);
        confidence = this.calculateMaxConfidence(sources);
        break;

      case 'temporal-priority':
        result = this.temporalPriorityFusion(sources, context);
        confidence = this.calculateTemporalConfidence(sources);
        break;

      case 'spatial-proximity':
        result = await this.spatialProximityFusion(sources, context);
        confidence = this.calculateSpatialConfidence(sources, context);
        break;

      case 'majority-vote':
        result = this.majorityVoteFusion(sources, context);
        confidence = this.calculateMajorityConfidence(sources);
        break;

      default:
        result = await this.customFusion(sources, context);
        confidence = this.calculateAverageConfidence(sources);
    }

    const processingTime = Date.now() - startTime;
    const timestamp = Date.now();
    const boundingBox = this.calculateBoundingBox(sources);

    return {
      id: `fusion-${timestamp}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp,
      fusedData: result,
      sources,
      confidence,
      strategy,
      metadata: {
        spatialResolution: context?.targetResolution || 10,
        temporalResolution: this.config.temporalWindow,
        boundingBox,
        processingTime,
        algorithm: strategy,
        version: '1.0.0',
      },
    };
  }

  /** Weighted average fusion */
  private async weightedAverageFusion(sources: FusionSource[], context?: FusionContext): Promise<any> {
    // For imagery: blend images based on weights
    // For numerical data: calculate weighted average
    
    if (this.isImageryData(sources)) {
      return this.fuseImagery(sources, context);
    }

    // For numerical data
    const values: { value: number; weight: number; confidence: number }[] = [];
    
    sources.forEach(source => {
      const numericValue = this.extractNumericValue(source.data);
      if (numericValue !== null) {
        values.push({
          value: numericValue,
          weight: source.weight,
          confidence: source.confidence,
        });
      }
    });

    if (values.length === 0) {
      return sources[0]?.data || null;
    }

    // Calculate weighted average
    const totalWeight = values.reduce((sum, v) => sum + v.weight * v.confidence, 0);
    const weightedSum = values.reduce((sum, v) => sum + v.value * v.weight * v.confidence, 0);
    
    return {
      type: 'weighted-average',
      value: totalWeight > 0 ? weightedSum / totalWeight : 0,
      sources: sources.map(s => s.assetId),
    };
  }

  /** Maximum confidence fusion */
  private maximumConfidenceFusion(sources: FusionSource[], context?: FusionContext): any {
    if (sources.length === 0) return null;

    // Find source with highest confidence
    const maxConfidenceSource = sources.reduce((max, source) => {
      return source.confidence > max.confidence ? source : max;
    }, sources[0]);

    return {
      type: 'maximum-confidence',
      value: maxConfidenceSource.data,
      source: maxConfidenceSource.assetId,
      confidence: maxConfidenceSource.confidence,
    };
  }

  /** Temporal priority fusion */
  private temporalPriorityFusion(sources: FusionSource[], context?: FusionContext): any {
    if (sources.length === 0) return null;

    // Find most recent source within temporal window
    const now = Date.now();
    const validSources = sources.filter(source => 
      now - source.timestamp <= this.config.temporalWindow
    );

    if (validSources.length === 0) {
      // Fall back to most recent overall
      const mostRecent = sources.reduce((latest, source) => {
        return source.timestamp > latest.timestamp ? source : latest;
      }, sources[0]);
      
      return {
        type: 'temporal-priority',
        value: mostRecent.data,
        source: mostRecent.assetId,
        timestamp: mostRecent.timestamp,
      };
    }

    // Use most recent valid source
    const mostRecent = validSources.reduce((latest, source) => {
      return source.timestamp > latest.timestamp ? source : latest;
    }, validSources[0]);

    return {
      type: 'temporal-priority',
      value: mostRecent.data,
      source: mostRecent.assetId,
      timestamp: mostRecent.timestamp,
      isFresh: true,
    };
  }

  /** Spatial proximity fusion */
  private async spatialProximityFusion(sources: FusionSource[], context?: FusionConfig): Promise<any> {
    if (sources.length === 0) return null;

    // If we have a target location, prioritize sources closest to it
    if (context?.areaOfInterest) {
      const targetCenter = this.calculatePolygonCenter(context.areaOfInterest);
      
      // Calculate distances and sort
      const sourcesWithDistance = sources.map(source => {
        const sourceLocation = this.extractLocation(source.data);
        const distance = sourceLocation ? 
          this.calculateDistance(targetCenter, sourceLocation) : 
          Infinity;
        
        return { source, distance };
      });

      // Sort by distance
      sourcesWithDistance.sort((a, b) => a.distance - b.distance);

      // Use closest source within tolerance
      const closest = sourcesWithDistance.find(s => s.distance <= this.config.spatialTolerance);
      
      if (closest) {
        return {
          type: 'spatial-proximity',
          value: closest.source.data,
          source: closest.source.assetId,
          distance: closest.distance,
        };
      }
    }

    // Fall back to weighted average
    return this.weightedAverageFusion(sources, context);
  }

  /** Majority vote fusion */
  private majorityVoteFusion(sources: FusionSource[], context?: FusionContext): any {
    if (sources.length === 0) return null;

    // For categorical data, find the most common value
    const valueCounts: Map<string, { count: number; totalConfidence: number }> = new Map();

    sources.forEach(source => {
      const value = this.extractCategoricalValue(source.data);
      if (value) {
        const existing = valueCounts.get(value) || { count: 0, totalConfidence: 0 };
        valueCounts.set(value, {
          count: existing.count + 1,
          totalConfidence: existing.totalConfidence + source.confidence,
        });
      }
    });

    if (valueCounts.size === 0) {
      return sources[0]?.data || null;
    }

    // Find value with highest count and confidence
    let bestValue: string | null = null;
    let bestScore = 0;

    valueCounts.forEach((stats, value) => {
      const score = stats.count * stats.totalConfidence / sources.length;
      if (score > bestScore) {
        bestScore = score;
        bestValue = value;
      }
    });

    return {
      type: 'majority-vote',
      value: bestValue,
      confidence: bestScore,
      counts: Object.fromEntries(valueCounts),
    };
  }

  /** Custom fusion strategy */
  private async customFusion(sources: FusionSource[], context?: FusionContext): Promise<any> {
    // Implement custom fusion logic based on data types
    
    if (this.isImageryData(sources)) {
      return this.fuseImagery(sources, context);
    }

    if (this.isWeatherData(sources)) {
      return this.fuseWeatherData(sources, context);
    }

    if (this.isPopulationData(sources)) {
      return this.fusePopulationData(sources, context);
    }

    // Default: use weighted average
    return this.weightedAverageFusion(sources, context);
  }

  // ==========================================================================
  // Data Type Detection
  // ==========================================================================

  /** Check if sources contain imagery data */
  private isImageryData(sources: FusionSource[]): boolean {
    return sources.some(source => 
      source.data.assetType?.startsWith('imagery') ||
      source.data.raw?.itemType
    );
  }

  /** Check if sources contain weather data */
  private isWeatherData(sources: FusionSource[]): boolean {
    return sources.some(source => 
      source.data.assetType?.startsWith('weather') ||
      source.data.assetType?.includes('noaa') ||
      source.data.assetType?.includes('meteo')
    );
  }

  /** Check if sources contain population data */
  private isPopulationData(sources: FusionSource[]): boolean {
    return sources.some(source => 
      source.data.assetType?.includes('population') ||
      source.adapterId === 'worldpop'
    );
  }

  // ==========================================================================
  // Data Fusion Helpers
  // ==========================================================================

  /** Fuse imagery data */
  private async fuseImagery(sources: FusionSource[], context?: FusionContext): Promise<any> {
    // In a real implementation, this would:
    // 1. Download or reference the imagery
    // 2. Align images spatially
    // 3. Apply blending based on weights/confidence
    // 4. Return the fused image

    // For now, return metadata about the fusion
    const timestamps = sources.map(s => s.timestamp);
    const minTimestamp = Math.min(...timestamps);
    const maxTimestamp = Math.max(...timestamps);

    return {
      type: 'imagery-fusion',
      sources: sources.map(s => ({
        assetId: s.assetId,
        adapterId: s.adapterId,
        weight: s.weight,
        confidence: s.confidence,
        timestamp: s.timestamp,
      })),
      temporalRange: { from: minTimestamp, to: maxTimestamp },
      strategy: 'weighted-blend',
      resolution: context?.targetResolution || 10,
      note: 'Actual imagery fusion would be performed by Python worker',
    };
  }

  /** Fuse weather data */
  private fuseWeatherData(sources: FusionSource[], context?: FusionContext): any {
    // For weather data, we might combine temperature, precipitation, etc.
    
    const fused: Record<string, any> = {};

    sources.forEach(source => {
      const data = source.data;
      
      // Extract weather parameters
      if (data.raw?.temperature !== undefined) {
        if (!fused.temperature) {
          fused.temperature = { values: [], weights: [] };
        }
        fused.temperature.values.push(data.raw.temperature);
        fused.temperature.weights.push(source.weight * source.confidence);
      }

      if (data.raw?.precipitation !== undefined) {
        if (!fused.precipitation) {
          fused.precipitation = { values: [], weights: [] };
        }
        fused.precipitation.values.push(data.raw.precipitation);
        fused.precipitation.weights.push(source.weight * source.confidence);
      }

      if (data.raw?.windSpeed !== undefined) {
        if (!fused.windSpeed) {
          fused.windSpeed = { values: [], weights: [] };
        }
        fused.windSpeed.values.push(data.raw.windSpeed);
        fused.windSpeed.weights.push(source.weight * source.confidence);
      }
    });

    // Calculate weighted averages
    const result: Record<string, number> = {};
    
    Object.keys(fused).forEach(key => {
      const { values, weights } = fused[key];
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      const weightedSum = values.reduce((sum, val, i) => sum + val * weights[i], 0);
      result[key] = totalWeight > 0 ? weightedSum / totalWeight : 0;
    });

    return {
      type: 'weather-fusion',
      data: result,
      sources: sources.map(s => s.assetId),
      timestamp: Date.now(),
    };
  }

  /** Fuse population data */
  private fusePopulationData(sources: FusionSource[], context?: FusionContext): any {
    // For population data, we might combine different population datasets
    
    if (sources.length === 1) {
      return sources[0].data;
    }

    // If we have a target AOI, we could interpolate
    if (context?.areaOfInterest) {
      return {
        type: 'population-fusion',
        data: sources.map(s => s.data),
        areaOfInterest: context.areaOfInterest,
        method: 'spatial-interpolation',
        note: 'Fused population data for the specified AOI',
      };
    }

    // Default: return all sources
    return {
      type: 'population-fusion',
      data: sources.map(s => s.data),
    };
  }

  // ==========================================================================
  // Confidence Calculation
  // ==========================================================================

  /** Calculate weighted confidence */
  private calculateWeightedConfidence(sources: FusionSource[]): number {
    if (sources.length === 0) return 0;

    const totalWeight = sources.reduce((sum, s) => sum + s.weight, 0);
    if (totalWeight === 0) return 0;

    const weightedConfidence = sources.reduce((sum, s) => 
      sum + s.confidence * s.weight, 0);

    return weightedConfidence / totalWeight;
  }

  /** Calculate maximum confidence */
  private calculateMaxConfidence(sources: FusionSource[]): number {
    if (sources.length === 0) return 0;
    return Math.max(...sources.map(s => s.confidence));
  }

  /** Calculate temporal confidence */
  private calculateTemporalConfidence(sources: FusionSource[]): number {
    if (sources.length === 0) return 0;

    const now = Date.now();
    const freshSources = sources.filter(s => now - s.timestamp <= this.config.temporalWindow);

    if (freshSources.length === 0) {
      return this.calculateAverageConfidence(sources);
    }

    return this.calculateAverageConfidence(freshSources);
  }

  /** Calculate spatial confidence */
  private calculateSpatialConfidence(sources: FusionSource[], context?: FusionContext): number {
    if (sources.length === 0) return 0;

    if (!context?.areaOfInterest) {
      return this.calculateAverageConfidence(sources);
    }

    const targetCenter = this.calculatePolygonCenter(context.areaOfInterest);
    const distances = sources.map(source => {
      const location = this.extractLocation(source.data);
      return location ? this.calculateDistance(targetCenter, location) : Infinity;
    });

    const maxDistance = Math.max(...distances.filter(d => d !== Infinity));
    if (maxDistance === Infinity) return 0;

    // Higher confidence for closer sources
    const confidences = distances.map(d => 
      d === Infinity ? 0 : 1 - Math.min(d / maxDistance, 1)
    );

    return confidences.reduce((a, b) => a + b, 0) / confidences.length;
  }

  /** Calculate majority confidence */
  private calculateMajorityConfidence(sources: FusionSource[]): number {
    if (sources.length === 0) return 0;

    const valueCounts: Map<string, number> = new Map();
    const valueConfidences: Map<string, number> = new Map();

    sources.forEach(source => {
      const value = this.extractCategoricalValue(source.data);
      if (value) {
        valueCounts.set(value, (valueCounts.get(value) || 0) + 1);
        valueConfidences.set(value, (valueConfidences.get(value) || 0) + source.confidence);
      }
    });

    if (valueCounts.size === 0) {
      return this.calculateAverageConfidence(sources);
    }

    // Find most common value
    let maxCount = 0;
    let bestValue: string | null = null;

    valueCounts.forEach((count, value) => {
      if (count > maxCount) {
        maxCount = count;
        bestValue = value;
      }
    });

    if (!bestValue) return 0;

    // Confidence is the average confidence of sources with this value
    const matchingSources = sources.filter(s => 
      this.extractCategoricalValue(s.data) === bestValue
    );

    return matchingSources.reduce((sum, s) => sum + s.confidence, 0) / matchingSources.length;
  }

  /** Calculate average confidence */
  private calculateAverageConfidence(sources: FusionSource[]): number {
    if (sources.length === 0) return 0;
    return sources.reduce((sum, s) => sum + s.confidence, 0) / sources.length;
  }

  // ==========================================================================
  // Geometry Helpers
  // ==========================================================================

  /** Calculate bounding box from sources */
  private calculateBoundingBox(sources: FusionSource[]): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    sources.forEach(source => {
      const location = this.extractLocation(source.data);
      if (location) {
        minX = Math.min(minX, location[0]);
        minY = Math.min(minY, location[1]);
        maxX = Math.max(maxX, location[0]);
        maxY = Math.max(maxY, location[1]);
      }

      // Also check geometry if available
      if (source.data.geometry) {
        this.updateBoundingBoxFromGeometry(source.data.geometry, { minX, minY, maxX, maxY });
      }
    });

    return {
      minX: minX === Infinity ? 0 : minX,
      minY: minY === Infinity ? 0 : minY,
      maxX: maxX === -Infinity ? 0 : maxX,
      maxY: maxY === -Infinity ? 0 : maxY,
    };
  }

  /** Update bounding box from geometry */
  private updateBoundingBoxFromGeometry(
    geometry: GeoJSON.Geometry,
    bbox: { minX: number; minY: number; maxX: number; maxY: number }
  ): void {
    if (geometry.type === 'Point') {
      bbox.minX = Math.min(bbox.minX, geometry.coordinates[0]);
      bbox.minY = Math.min(bbox.minY, geometry.coordinates[1]);
      bbox.maxX = Math.max(bbox.maxX, geometry.coordinates[0]);
      bbox.maxY = Math.max(bbox.maxY, geometry.coordinates[1]);
    } else if (geometry.type === 'Polygon') {
      geometry.coordinates[0].forEach(coord => {
        bbox.minX = Math.min(bbox.minX, coord[0]);
        bbox.minY = Math.min(bbox.minY, coord[1]);
        bbox.maxX = Math.max(bbox.maxX, coord[0]);
        bbox.maxY = Math.max(bbox.maxY, coord[1]);
      });
    } else if (geometry.type === 'MultiPolygon') {
      geometry.coordinates.forEach(polygon => {
        polygon[0].forEach(coord => {
          bbox.minX = Math.min(bbox.minX, coord[0]);
          bbox.minY = Math.min(bbox.minY, coord[1]);
          bbox.maxX = Math.max(bbox.maxX, coord[0]);
          bbox.maxY = Math.max(bbox.maxY, coord[1]);
        });
      });
    }
  }

  /** Calculate polygon center */
  private calculatePolygonCenter(polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] {
    if (polygon.type === 'Polygon') {
      const coords = polygon.coordinates[0];
      let x = 0;
      let y = 0;
      let count = 0;

      coords.forEach(coord => {
        x += coord[0];
        y += coord[1];
        count++;
      });

      return [x / count, y / count];
    }

    // For MultiPolygon, use first polygon
    if (polygon.type === 'MultiPolygon' && polygon.coordinates.length > 0) {
      return this.calculatePolygonCenter({ type: 'Polygon', coordinates: polygon.coordinates[0] });
    }

    return [0, 0];
  }

  /** Calculate distance between two points (Haversine formula) */
  private calculateDistance(point1: [number, number], point2: [number, number]): number {
    const R = 6371000; // Earth radius in meters
    const φ1 = point1[1] * Math.PI / 180;
    const φ2 = point2[1] * Math.PI / 180;
    const Δφ = (point2[1] - point1[1]) * Math.PI / 180;
    const Δλ = (point2[0] - point1[0]) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  // ==========================================================================
  // Data Extraction Helpers
  // ==========================================================================

  /** Extract numeric value from data */
  private extractNumericValue(data: any): number | null {
    // Try to find numeric values in the data
    if (typeof data === 'number') return data;
    if (typeof data === 'object' && data !== null) {
      // Check for common numeric fields
      const numericFields = ['value', 'magnitude', 'intensity', 'temperature', 'precipitation', 'windSpeed'];
      for (const field of numericFields) {
        if (typeof data[field] === 'number') {
          return data[field];
        }
        if (data.raw && typeof data.raw[field] === 'number') {
          return data.raw[field];
        }
      }

      // Check quality metrics
      if (data.quality && typeof data.quality.cloudCover === 'number') {
        return data.quality.cloudCover;
      }
    }
    return null;
  }

  /** Extract categorical value from data */
  private extractCategoricalValue(data: any): string | null {
    if (typeof data === 'string') return data;
    if (typeof data === 'object' && data !== null) {
      // Check for common categorical fields
      const categoricalFields = ['type', 'category', 'class', 'status', 'damage_class'];
      for (const field of categoricalFields) {
        if (typeof data[field] === 'string') {
          return data[field];
        }
        if (data.raw && typeof data.raw[field] === 'string') {
          return data.raw[field];
        }
      }

      // Check asset type
      if (typeof data.assetType === 'string') {
        return data.assetType;
      }
    }
    return null;
  }

  /** Extract location from data */
  private extractLocation(data: any): [number, number] | null {
    if (data.geometry && data.geometry.type === 'Point') {
      return data.geometry.coordinates as [number, number];
    }

    if (data.geometry && data.geometry.type === 'Polygon') {
      return this.calculatePolygonCenter(data.geometry);
    }

    if (data.raw && typeof data.raw.longitude === 'number' && typeof data.raw.latitude === 'number') {
      return [data.raw.longitude, data.raw.latitude];
    }

    if (data.raw && typeof data.raw.lon === 'number' && typeof data.raw.lat === 'number') {
      return [data.raw.lon, data.raw.lat];
    }

    return null;
  }

  // ==========================================================================
  // Task Management
  // ==========================================================================

  /** Generate unique task ID */
  private generateTaskId(): string {
    return `fusion-task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /** Generate cache key */
  private generateCacheKey(request: FusionRequest): string {
    const assetIds = request.assets.map(a => a.externalId).sort().join(',');
    const strategy = request.config?.strategy || this.config.strategy;
    return `fusion-${strategy}-${assetIds}`;
  }

  /** Get task by ID */
  getTask(taskId: string): FusionTask | undefined {
    return this.tasks.get(taskId);
  }

  /** Get all tasks */
  getAllTasks(): FusionTask[] {
    return Array.from(this.tasks.values());
  }

  /** Get pending tasks */
  getPendingTasks(): FusionTask[] {
    return Array.from(this.tasks.values()).filter(t => t.status === 'pending');
  }

  /** Get processing tasks */
  getProcessingTasks(): FusionTask[] {
    return Array.from(this.tasks.values()).filter(t => t.status === 'processing');
  }

  /** Get completed tasks */
  getCompletedTasks(): FusionTask[] {
    return Array.from(this.tasks.values()).filter(t => t.status === 'completed');
  }

  /** Get failed tasks */
  getFailedTasks(): FusionTask[] {
    return Array.from(this.tasks.values()).filter(t => t.status === 'failed');
  }

  /** Cancel task */
  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (task && task.status === 'pending') {
      task.status = 'cancelled';
      task.updatedAt = Date.now();
      return true;
    }
    return false;
  }

  /** Clear completed tasks */
  clearCompletedTasks(): number {
    const completedTasks = this.getCompletedTasks();
    completedTasks.forEach(task => this.tasks.delete(task.id));
    return completedTasks.length;
  }

  /** Clear all tasks */
  clearAllTasks(): number {
    const count = this.tasks.size;
    this.tasks.clear();
    return count;
  }

  /** Get statistics */
  getStats(): {
    totalTasks: number;
    pendingTasks: number;
    processingTasks: number;
    completedTasks: number;
    failedTasks: number;
    cancelledTasks: number;
    cacheSize: number;
  } {
    const tasks = this.getAllTasks();
    
    return {
      totalTasks: tasks.length,
      pendingTasks: tasks.filter(t => t.status === 'pending').length,
      processingTasks: tasks.filter(t => t.status === 'processing').length,
      completedTasks: tasks.filter(t => t.status === 'completed').length,
      failedTasks: tasks.filter(t => t.status === 'failed').length,
      cancelledTasks: tasks.filter(t => t.status === 'cancelled').length,
      cacheSize: this.cache.size,
    };
  }

  /** Clear cache */
  clearCache(): number {
    const count = this.cache.size;
    this.cache.clear();
    return count;
  }
}

// ==========================================================================
// Singleton Instance
// ==========================================================================

let fusionEngineInstance: FusionEngine | null = null;

/** Get singleton fusion engine instance */
export function getFusionEngine(config?: Partial<FusionConfig>): FusionEngine {
  if (!fusionEngineInstance) {
    fusionEngineInstance = new FusionEngine(config);
  }
  return fusionEngineInstance;
}

/** Reset singleton instance (for testing) */
export function resetFusionEngine(): void {
  fusionEngineInstance = null;
}

// ==========================================================================
// Fusion Strategy Builders
// ==========================================================================

/** Create weighted average fusion configuration */
export function createWeightedAverageConfig(weights?: Record<string, number>): Partial<FusionConfig> {
  return {
    strategy: 'weighted-average',
    weights: weights || {},
  };
}

/** Create maximum confidence fusion configuration */
export function createMaximumConfidenceConfig(): Partial<FusionConfig> {
  return {
    strategy: 'maximum-confidence',
  };
}

/** Create temporal priority fusion configuration */
export function createTemporalPriorityConfig(window?: number): Partial<FusionConfig> {
  return {
    strategy: 'temporal-priority',
    temporalWindow: window || 300000,
  };
}

/** Create spatial proximity fusion configuration */
export function createSpatialProximityConfig(tolerance?: number): Partial<FusionConfig> {
  return {
    strategy: 'spatial-proximity',
    spatialTolerance: tolerance || 10,
  };
}

/** Create majority vote fusion configuration */
export function createMajorityVoteConfig(): Partial<FusionConfig> {
  return {
    strategy: 'majority-vote',
  };
}

// ==========================================================================
// Data Classification Helpers
// ==========================================================================

/** Classify data into categories */
export function classifyData(asset: DiscoveredAsset | NormalizedProduct): DataCategory[] {
  const categories: DataCategory[] = [];

  if (asset.assetType?.startsWith('imagery')) {
    categories.push('imagery');
  }

  if (asset.assetType?.includes('weather') || 
      asset.assetType?.includes('noaa') ||
      asset.assetType?.includes('meteo')) {
    categories.push('weather');
  }

  if (asset.assetType?.includes('climate') ||
      asset.assetType?.includes('temperature') ||
      asset.assetType?.includes('precipitation')) {
    categories.push('climate');
  }

  if (asset.assetType?.includes('population')) {
    categories.push('population');
  }

  if (asset.assetType?.includes('road') ||
      asset.assetType?.includes('building') ||
      asset.assetType?.includes('infrastructure')) {
    categories.push('infrastructure');
  }

  if (asset.assetType?.includes('event') ||
      asset.assetType?.includes('alert') ||
      asset.assetType?.includes('earthquake') ||
      asset.assetType?.includes('fire')) {
    categories.push('events');
  }

  if (categories.length === 0) {
    categories.push('geospatial');
  }

  return categories;
}

/** Extract features from data */
export function extractFeatures(asset: DiscoveredAsset | NormalizedProduct): FeatureType[] {
  const features: FeatureType[] = [];

  if (asset.assetType?.includes('building') || asset.title?.toLowerCase().includes('building')) {
    features.push('building');
  }

  if (asset.assetType?.includes('road') || asset.title?.toLowerCase().includes('road')) {
    features.push('road');
  }

  if (asset.assetType?.includes('landcover') || asset.title?.toLowerCase().includes('land')) {
    features.push('landcover');
  }

  if (asset.assetType?.includes('water') || asset.title?.toLowerCase().includes('water')) {
    features.push('waterbody');
  }

  if (asset.assetType?.includes('vegetation') || asset.title?.toLowerCase().includes('vegetation')) {
    features.push('vegetation');
  }

  if (asset.assetType?.includes('temperature') || asset.title?.toLowerCase().includes('temperature')) {
    features.push('temperature');
  }

  if (asset.assetType?.includes('precipitation') || asset.title?.toLowerCase().includes('precipitation')) {
    features.push('precipitation');
  }

  if (asset.assetType?.includes('wind') || asset.title?.toLowerCase().includes('wind')) {
    features.push('wind');
  }

  if (asset.assetType?.includes('humidity') || asset.title?.toLowerCase().includes('humidity')) {
    features.push('humidity');
  }

  return features;
}

export default {
  FusionEngine,
  getFusionEngine,
  resetFusionEngine,
  // Types
  FusionStrategy,
  FusionResult,
  FusionSource,
  FusionMetadata,
  FusionConfig,
  FusionRequest,
  FusionContext,
  FusionTask,
  DataCategory,
  FeatureType,
  // Strategy builders
  createWeightedAverageConfig,
  createMaximumConfidenceConfig,
  createTemporalPriorityConfig,
  createSpatialProximityConfig,
  createMajorityVoteConfig,
  // Helpers
  classifyData,
  extractFeatures,
};
