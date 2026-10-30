/* ==========================================================================
 * FirstLight - Fusion Engine Tests
 * ========================================================================== */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  FusionEngine,
  getFusionEngine,
  resetFusionEngine,
  classifyData,
  extractFeatures,
  createWeightedAverageConfig,
  createMaximumConfidenceConfig,
  createTemporalPriorityConfig,
  createSpatialProximityConfig,
  createMajorityVoteConfig,
} from '../';
import type { FusionConfig, FusionRequest, FusionResult } from '../';

// Mock data
const mockAsset1 = {
  externalId: 'asset-1',
  title: 'Sentinel-2 Image',
  assetType: 'imagery.sentinel-2',
  acquiredAt: '2024-01-01T00:00:00Z',
  geometry: {
    type: 'Polygon',
    coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
  },
  adapterId: 'sentinel-hub',
  raw: {
    collection: 'sentinel-2-l2a',
    satellite: 'Sentinel-2',
  },
};

const mockAsset2 = {
  externalId: 'asset-2',
  title: 'PlanetScope Image',
  assetType: 'imagery.planet.psscene',
  acquiredAt: '2024-01-01T12:00:00Z',
  geometry: {
    type: 'Polygon',
    coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
  },
  adapterId: 'planet',
  raw: {
    itemType: 'PSScene',
  },
};

const mockAsset3 = {
  externalId: 'asset-3',
  title: 'NOAA Weather Data',
  assetType: 'weather.noaa.goes16',
  acquiredAt: '2024-01-01T06:00:00Z',
  geometry: {
    type: 'Polygon',
    coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
  },
  adapterId: 'noaa',
  raw: {
    dataType: 'goes-16',
  },
};

describe('Fusion Engine', () => {
  let fusionEngine: FusionEngine;

  beforeEach(() => {
    vi.resetAllMocks();
    resetFusionEngine();
    fusionEngine = getFusionEngine();
  });

  afterEach(() => {
    resetFusionEngine();
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      expect(fusionEngine).toBeDefined();
      
      const config = fusionEngine.getConfig();
      expect(config.strategy).toBe('weighted-average');
      expect(config.confidenceThreshold).toBe(0.5);
      expect(config.temporalWindow).toBe(300000);
      expect(config.spatialTolerance).toBe(10);
      expect(config.maxSources).toBe(10);
    });

    it('should initialize with custom configuration', () => {
      const customConfig: Partial<FusionConfig> = {
        strategy: 'maximum-confidence',
        confidenceThreshold: 0.8,
      };
      
      const engine = new FusionEngine(customConfig);
      const config = engine.getConfig();
      
      expect(config.strategy).toBe('maximum-confidence');
      expect(config.confidenceThreshold).toBe(0.8);
    });
  });

  describe('Configuration Management', () => {
    it('should update configuration', () => {
      fusionEngine.updateConfig({
        strategy: 'temporal-priority',
        temporalWindow: 600000,
      });
      
      const config = fusionEngine.getConfig();
      expect(config.strategy).toBe('temporal-priority');
      expect(config.temporalWindow).toBe(600000);
    });

    it('should not modify original config when getting', () => {
      const config1 = fusionEngine.getConfig();
      config1.confidenceThreshold = 0.9;
      
      const config2 = fusionEngine.getConfig();
      expect(config2.confidenceThreshold).toBe(0.5);
    });
  });

  describe('Adapter Weights', () => {
    it('should have default weights for known adapters', () => {
      expect(fusionEngine.getAdapterWeight('sentinel-hub')).toBe(0.9);
      expect(fusionEngine.getAdapterWeight('planet')).toBe(0.85);
      expect(fusionEngine.getAdapterWeight('maxar')).toBe(0.95);
      expect(fusionEngine.getAdapterWeight('noaa')).toBe(0.8);
    });

    it('should return default weight for unknown adapters', () => {
      expect(fusionEngine.getAdapterWeight('unknown-adapter')).toBe(0.5);
    });

    it('should set and get custom weights', () => {
      fusionEngine.setAdapterWeight('custom-adapter', 0.75);
      expect(fusionEngine.getAdapterWeight('custom-adapter')).toBe(0.75);
    });

    it('should clamp weights between 0 and 1', () => {
      fusionEngine.setAdapterWeight('test-adapter', 1.5);
      expect(fusionEngine.getAdapterWeight('test-adapter')).toBe(1);
      
      fusionEngine.setAdapterWeight('test-adapter', -0.5);
      expect(fusionEngine.getAdapterWeight('test-adapter')).toBe(0);
    });
  });

  describe('Source Confidence', () => {
    it('should set and get source confidence', () => {
      fusionEngine.setSourceConfidence('sentinel-hub', 'asset-1', 0.95);
      expect(fusionEngine.getSourceConfidence('sentinel-hub', 'asset-1')).toBe(0.95);
    });

    it('should return default confidence for unknown sources', () => {
      expect(fusionEngine.getSourceConfidence('unknown', 'unknown')).toBe(0.5);
    });

    it('should clamp confidence between 0 and 1', () => {
      fusionEngine.setSourceConfidence('test', 'asset', 1.2);
      expect(fusionEngine.getSourceConfidence('test', 'asset')).toBe(1);
      
      fusionEngine.setSourceConfidence('test', 'asset', -0.1);
      expect(fusionEngine.getSourceConfidence('test', 'asset')).toBe(0);
    });
  });

  describe('Task Management', () => {
    it('should submit fusion request', () => {
      const request: FusionRequest = {
        id: 'test-request',
        assets: [mockAsset1, mockAsset2],
      };
      
      const task = fusionEngine.submitRequest(request);
      
      expect(task.id).toBe('test-request');
      expect(task.status).toBe('pending');
      expect(task.progress).toBe(0);
      expect(task.request).toBe(request);
    });

    it('should get task by ID', () => {
      const request: FusionRequest = {
        id: 'test-request',
        assets: [mockAsset1],
      };
      
      fusionEngine.submitRequest(request);
      const task = fusionEngine.getTask('test-request');
      
      expect(task).toBeDefined();
      expect(task?.id).toBe('test-request');
    });

    it('should return undefined for unknown task', () => {
      const task = fusionEngine.getTask('unknown-task');
      expect(task).toBeUndefined();
    });

    it('should get all tasks', () => {
      fusionEngine.submitRequest({ id: 'task-1', assets: [mockAsset1] });
      fusionEngine.submitRequest({ id: 'task-2', assets: [mockAsset2] });
      
      const tasks = fusionEngine.getAllTasks();
      expect(tasks.length).toBe(2);
    });

    it('should get tasks by status', () => {
      fusionEngine.submitRequest({ id: 'task-1', assets: [mockAsset1] });
      
      const pendingTasks = fusionEngine.getPendingTasks();
      const processingTasks = fusionEngine.getProcessingTasks();
      const completedTasks = fusionEngine.getCompletedTasks();
      const failedTasks = fusionEngine.getFailedTasks();
      
      expect(pendingTasks.length).toBe(1);
      expect(processingTasks.length).toBe(0);
      expect(completedTasks.length).toBe(0);
      expect(failedTasks.length).toBe(0);
    });

    it('should clear completed tasks', () => {
      // Submit a task that will complete
      const request: FusionRequest = {
        id: 'test-request',
        assets: [mockAsset1],
        config: {
          strategy: 'weighted-average',
        },
      };
      
      fusionEngine.submitRequest(request);
      
      // Wait for async processing
      vi.runAllTimers();
      
      // Mark as completed for testing
      const task = fusionEngine.getTask('test-request');
      if (task) {
        task.status = 'completed';
        task.progress = 100;
      }
      
      expect(fusionEngine.getCompletedTasks().length).toBe(1);
      expect(fusionEngine.clearCompletedTasks()).toBe(1);
      expect(fusionEngine.getCompletedTasks().length).toBe(0);
    });

    it('should clear all tasks', () => {
      fusionEngine.submitRequest({ id: 'task-1', assets: [mockAsset1] });
      fusionEngine.submitRequest({ id: 'task-2', assets: [mockAsset2] });
      
      expect(fusionEngine.clearAllTasks()).toBe(2);
      expect(fusionEngine.getAllTasks().length).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should return correct statistics', () => {
      fusionEngine.submitRequest({ id: 'task-1', assets: [mockAsset1] });
      fusionEngine.submitRequest({ id: 'task-2', assets: [mockAsset2] });
      
      const task = fusionEngine.getTask('task-1');
      if (task) {
        task.status = 'completed';
      }
      
      const stats = fusionEngine.getStats();
      
      expect(stats.totalTasks).toBe(2);
      expect(stats.pendingTasks).toBe(1);
      expect(stats.completedTasks).toBe(1);
    });
  });

  describe('Cache Management', () => {
    it('should clear cache', () => {
      // Add something to cache
      fusionEngine['cache'].set('test-key', {
        result: {} as FusionResult,
        expiresAt: Date.now() + 10000,
      });
      
      expect(fusionEngine['cache'].size).toBe(1);
      expect(fusionEngine.clearCache()).toBe(1);
      expect(fusionEngine['cache'].size).toBe(0);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance for getFusionEngine', () => {
      const instance1 = getFusionEngine();
      const instance2 = getFusionEngine();
      
      expect(instance1).toBe(instance2);
    });

    it('should reset instance with resetFusionEngine', () => {
      const instance1 = getFusionEngine();
      resetFusionEngine();
      const instance2 = getFusionEngine();
      
      expect(instance1).not.toBe(instance2);
    });
  });
});

// ==========================================================================
// Helper Function Tests
// ==========================================================================

describe('Helper Functions', () => {
  describe('classifyData', () => {
    it('should classify imagery data', () => {
      const categories = classifyData(mockAsset1);
      expect(categories).toContain('imagery');
    });

    it('should classify weather data', () => {
      const categories = classifyData(mockAsset3);
      expect(categories).toContain('weather');
    });

    it('should classify geospatial data by default', () => {
      const asset = {
        externalId: 'test',
        assetType: 'unknown',
      };
      
      const categories = classifyData(asset as any);
      expect(categories).toContain('geospatial');
    });
  });

  describe('extractFeatures', () => {
    it('should extract building feature', () => {
      const asset = {
        externalId: 'test',
        assetType: 'imagery.building',
        title: 'Building Image',
      };
      
      const features = extractFeatures(asset as any);
      expect(features).toContain('building');
    });

    it('should extract road feature', () => {
      const asset = {
        externalId: 'test',
        assetType: 'infrastructure.road',
        title: 'Road Network',
      };
      
      const features = extractFeatures(asset as any);
      expect(features).toContain('road');
    });

    it('should extract temperature feature', () => {
      const asset = {
        externalId: 'test',
        assetType: 'weather.temperature',
        title: 'Temperature Data',
      };
      
      const features = extractFeatures(asset as any);
      expect(features).toContain('temperature');
    });
  });

  describe('Strategy Builders', () => {
    it('should create weighted average config', () => {
      const config = createWeightedAverageConfig({
        sentinelHub: 0.9,
        planet: 0.8,
      });
      
      expect(config.strategy).toBe('weighted-average');
      expect(config.weights).toEqual({ sentinelHub: 0.9, planet: 0.8 });
    });

    it('should create maximum confidence config', () => {
      const config = createMaximumConfidenceConfig();
      expect(config.strategy).toBe('maximum-confidence');
    });

    it('should create temporal priority config', () => {
      const config = createTemporalPriorityConfig(600000);
      expect(config.strategy).toBe('temporal-priority');
      expect(config.temporalWindow).toBe(600000);
    });

    it('should create spatial proximity config', () => {
      const config = createSpatialProximityConfig(50);
      expect(config.strategy).toBe('spatial-proximity');
      expect(config.spatialTolerance).toBe(50);
    });

    it('should create majority vote config', () => {
      const config = createMajorityVoteConfig();
      expect(config.strategy).toBe('majority-vote');
    });
  });
});
