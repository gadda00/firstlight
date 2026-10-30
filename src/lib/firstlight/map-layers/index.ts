/* ==========================================================================
 * FirstLight - Map Layer System
 * 
 * Comprehensive map layer management for visualizing multiple data sources.
 * Supports:
 * - Dynamic layer creation from data adapters
 * - Layer grouping and ordering
 * - Visibility and opacity controls
 * - Source attribution tracking
 * - Real-time data updates
 * 
 * Integrates with MapLibre GL JS for rendering.
 * ========================================================================== */

import type { LayerSpecification, SourceSpecification, StyleSpecification } from 'maplibre-gl';
import type { DataSourceAdapter } from '@/lib/server/adapters/types';
import type { DiscoveredAsset, NormalizedProduct } from '@/lib/server/adapters/types';

// ==========================================================================
// Types
// ==========================================================================

/** Unique layer identifier */
export type LayerId = string;

/** Layer group for organization */
export type LayerGroup = 
  | 'base'
  | 'imagery'
  | 'overlays'
  | 'analysis'
  | 'annotations'
  | 'realtime';

/** Layer visibility state */
export type LayerVisibility = 'visible' | 'hidden' | 'filter';

/** Layer opacity (0-1) */
export type LayerOpacity = number;

/** Layer metadata for tracking */
export interface LayerMetadata {
  id: LayerId;
  group: LayerGroup;
  label: string;
  description?: string;
  adapterId?: string;
  provider?: string;
  sourceUrl?: string;
  license?: string;
  attribution?: string;
  timestamp?: Date;
  isLive: boolean;
  zIndex: number;
}

/** Layer configuration */
export interface LayerConfig {
  id: LayerId;
  group: LayerGroup;
  spec: LayerSpecification;
  source?: SourceSpecification;
  metadata: LayerMetadata;
  visibility: LayerVisibility;
  opacity: LayerOpacity;
  enabled: boolean;
}

/** Layer source types */
export type LayerSourceType = 
  | 'raster'
  | 'vector'
  | 'geojson'
  | 'raster-dem'
  | 'image'
  | 'video';

/** Dynamic layer source from adapter data */
export interface AdapterLayerSource {
  type: LayerSourceType;
  adapterId: string;
  assetId: string;
  data: any;
  timestamp: Date;
}

/** Map layer state */
export interface MapLayerState {
  layers: Map<LayerId, LayerConfig>;
  groups: Map<LayerGroup, { visible: boolean; expanded: boolean }>;
  baseStyle: 'satellite' | 'dark' | 'hybrid' | 'terrain';
}

// ==========================================================================
// Base Style Definitions
// ==========================================================================

/** Extended base styles with additional providers */
export const BASE_STYLES: Record<string, () => StyleSpecification> = {
  satellite: () => ({
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      esri: {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
      },
      'planet-basemap': {
        type: 'raster',
        tiles: [
          'https://basemaps.planet.com/basemaps/v1/planet-tiles/global_monthly_{month}_mosaic/gmap/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        maxzoom: 14,
        attribution: 'Imagery © Planet Labs, Inc.',
      },
      'sentinel-2': {
        type: 'raster',
        tiles: [
          'https://s2maps-tiles.eu/wmts?layer=s2cloudless-2023_3857&style=default&tilematrixset=GoogleMapsCompatible&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fpng&TileMatrix={z}&TileCol={x}&TileRow={y}',
        ],
        tileSize: 256,
        maxzoom: 18,
        attribution: 'Contains modified Copernicus Sentinel data',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#09090b' } },
      { id: 'satellite-base', type: 'raster', source: 'esri' },
    ],
  }),

  dark: () => ({
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      carto: {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
          'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
          'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
          'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        ],
        tileSize: 512,
        maxzoom: 18,
        attribution: '© OpenStreetMap contributors © CARTO',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#09090b' } },
      { id: 'dark-base', type: 'raster', source: 'carto' },
    ],
  }),

  hybrid: () => ({
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      'osm-hybrid': {
        type: 'raster',
        tiles: [
          'https://mt.google.com/vt?lyrs=y&x={x}&y={y}&z={z}',
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© Google Maps',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#09090b' } },
      { id: 'hybrid-base', type: 'raster', source: 'osm-hybrid' },
    ],
  }),

  terrain: () => ({
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      'terrain-base': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        maxzoom: 16,
        attribution: '© Esri',
      },
      'terrain-dem': {
        type: 'raster-dem',
        tiles: [
          'https://demotiles.maplibre.org/terrain/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        maxzoom: 14,
        attribution: 'Terrain data © MapLibre',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#09090b' } },
      { id: 'terrain-base', type: 'raster', source: 'terrain-base' },
    ],
  }),
};

// ==========================================================================
// Layer Factories
// ==========================================================================

/** Create raster layer from imagery adapter */
export function createImageryLayer(
  asset: DiscoveredAsset | NormalizedProduct,
  adapter: DataSourceAdapter,
  zIndex: number = 0,
): LayerConfig {
  const layerId = `imagery-${adapter.id}-${asset.externalId}`;
  const sourceId = `source-${layerId}`;

  const source: SourceSpecification = {
    type: 'raster',
    tiles: [asset.url || ''],
    tileSize: 256,
    maxzoom: 20,
    attribution: adapter.license().attribution || `Data © ${adapter.label}`,
  };

  const spec: LayerSpecification = {
    id: layerId,
    type: 'raster',
    source: sourceId,
    minzoom: 0,
    maxzoom: 24,
    paint: {
      'raster-opacity': 1,
      'raster-saturate': 1,
      'raster-contrast': 1,
      'raster-brightness-min': 0,
      'raster-brightness-max': 1,
    },
  };

  return {
    id: layerId,
    group: 'imagery',
    spec,
    source,
    metadata: {
      id: layerId,
      group: 'imagery',
      label: `${adapter.label}: ${asset.title || asset.externalId}`,
      description: `Satellite imagery from ${adapter.label}`,
      adapterId: adapter.id,
      provider: adapter.label,
      sourceUrl: asset.url,
      license: adapter.license().name,
      attribution: adapter.license().attribution,
      timestamp: asset.acquiredAt ? new Date(asset.acquiredAt) : new Date(),
      isLive: adapter.health === 'live',
      zIndex,
    },
    visibility: 'visible',
    opacity: 1,
    enabled: true,
  };
}

/** Create vector layer from GeoJSON data */
export function createGeoJsonLayer(
  id: LayerId,
  data: GeoJSON.FeatureCollection | GeoJSON.Feature,
  style: Partial<LayerSpecification>,
  metadata: Partial<LayerMetadata> = {},
  group: LayerGroup = 'overlays',
): LayerConfig {
  const sourceId = `source-${id}`;
  const layerId = id;

  const source: SourceSpecification = {
    type: 'geojson',
    data,
  };

  const spec: LayerSpecification = {
    id: layerId,
    type: 'fill',
    source: sourceId,
    ...style,
  };

  return {
    id: layerId,
    group,
    spec,
    source,
    metadata: {
      id,
      group,
      label: metadata.label || id,
      description: metadata.description,
      adapterId: metadata.adapterId,
      provider: metadata.provider,
      sourceUrl: metadata.sourceUrl,
      license: metadata.license,
      attribution: metadata.attribution,
      timestamp: metadata.timestamp || new Date(),
      isLive: metadata.isLive || false,
      zIndex: metadata.zIndex || 0,
    },
    visibility: 'visible',
    opacity: 1,
    enabled: true,
  };
}

/** Create heatmap layer */
export function createHeatmapLayer(
  id: LayerId,
  data: GeoJSON.FeatureCollection,
  intensityProperty: string = 'value',
  metadata: Partial<LayerMetadata> = {},
): LayerConfig {
  const sourceId = `source-${id}`;

  const source: SourceSpecification = {
    type: 'geojson',
    data,
  };

  const spec: LayerSpecification = {
    id: id,
    type: 'heatmap',
    source: sourceId,
    maxzoom: 15,
    paint: {
      'heatmap-weight': ['interpolate', ['linear'], ['get', intensityProperty], 0, 0, 1, 1],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 15, 3],
      'heatmap-color': [
        'interpolate',
        ['linear'],
        ['heatmap-density'],
        0,
        'rgba(0,0,255,0)',
        0.2,
        'rgba(0,0,255,1)',
        0.4,
        'rgba(0,255,255,1)',
        0.6,
        'rgba(0,255,0,1)',
        0.8,
        'rgba(255,255,0,1)',
        1,
        'rgba(255,0,0,1)',
      ],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 15, 20],
      'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 0, 1, 15, 0.8],
    },
  };

  return {
    id,
    group: 'analysis',
    spec,
    source,
    metadata: {
      id,
      group: 'analysis',
      label: metadata.label || `Heatmap: ${id}`,
      description: metadata.description || 'Density heatmap',
      timestamp: new Date(),
      isLive: false,
      zIndex: metadata.zIndex || 10,
    },
    visibility: 'visible',
    opacity: 1,
    enabled: true,
  };
}

/** Create cluster layer for point data */
export function createClusterLayer(
  id: LayerId,
  data: GeoJSON.FeatureCollection,
  clusterRadius: number = 50,
  metadata: Partial<LayerMetadata> = {},
): LayerConfig[] {
  const sourceId = `source-${id}`;
  const circleId = `${id}-circles`;
  const countId = `${id}-count`;

  const source: SourceSpecification = {
    type: 'geojson',
    data,
    cluster: true,
    clusterRadius,
    clusterProperties: {
      count: ['+', ['case', ['has', 'point_count'], ['get', 'point_count'], 0]],
    },
  };

  const circleSpec: LayerSpecification = {
    id: circleId,
    type: 'circle',
    source: sourceId,
    filter: ['all', ['has', 'point_count']],
    paint: {
      'circle-color': [
        'step',
        ['get', 'point_count'],
        'rgba(56, 189, 248, 0.8)',
        10,
        'rgba(56, 189, 248, 0.9)',
        50,
        'rgba(248, 113, 113, 0.9)',
        100,
        'rgba(239, 68, 68, 0.9)',
      ],
      'circle-radius': ['step', ['get', 'point_count'], 20, 10, 25, 50, 30],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  };

  const countSpec: LayerSpecification = {
    id: countId,
    type: 'symbol',
    source: sourceId,
    filter: ['all', ['has', 'point_count'], ['>', 'point_count', 1]],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Open Sans Bold'],
      'text-size': 12,
    },
    paint: {
      'text-color': '#ffffff',
    },
  };

  return [
    {
      id: circleId,
      group: 'analysis',
      spec: circleSpec,
      source,
      metadata: {
        id: circleId,
        group: 'analysis',
        label: metadata.label || `Clusters: ${id}`,
        description: metadata.description || 'Point clusters',
        timestamp: new Date(),
        isLive: false,
        zIndex: metadata.zIndex || 10,
      },
      visibility: 'visible',
      opacity: 1,
      enabled: true,
    },
    {
      id: countId,
      group: 'analysis',
      spec: countSpec,
      metadata: {
        id: countId,
        group: 'analysis',
        label: `${metadata.label || id} Count`,
        description: 'Cluster counts',
        timestamp: new Date(),
        isLive: false,
        zIndex: metadata.zIndex ? metadata.zIndex + 1 : 11,
      },
      visibility: 'visible',
      opacity: 1,
      enabled: true,
    },
  ];
}

/** Create choropleth layer */
export function createChoroplethLayer(
  id: LayerId,
  data: GeoJSON.FeatureCollection,
  valueProperty: string,
  colorStops: [number, string][],
  metadata: Partial<LayerMetadata> = {},
): LayerConfig {
  const sourceId = `source-${id}`;

  const source: SourceSpecification = {
    type: 'geojson',
    data,
  };

  const spec: LayerSpecification = {
    id,
    type: 'fill',
    source: sourceId,
    paint: {
      'fill-color': [
        'interpolate',
        ['linear'],
        ['get', valueProperty],
        ...colorStops.flat(),
      ],
      'fill-outline-color': 'rgba(255, 255, 255, 0.8)',
      'fill-opacity': 0.7,
    },
  };

  return {
    id,
    group: 'analysis',
    spec,
    source,
    metadata: {
      id,
      group: 'analysis',
      label: metadata.label || `Choropleth: ${id}`,
      description: metadata.description || `Choropleth map by ${valueProperty}`,
      timestamp: new Date(),
      isLive: false,
      zIndex: metadata.zIndex || 5,
    },
    visibility: 'visible',
    opacity: 1,
    enabled: true,
  };
}

// ==========================================================================
// Layer Manager
// ==========================================================================

/** Map Layer Manager for dynamic layer management */
export class LayerManager {
  private layers: Map<LayerId, LayerConfig> = new Map();
  private groups: Map<LayerGroup, { visible: boolean; expanded: boolean }> = new Map();
  private baseStyle: keyof typeof BASE_STYLES = 'satellite';
  private zIndexCounter: number = 0;

  constructor() {
    // Initialize default groups
    const defaultGroups: LayerGroup[] = ['base', 'imagery', 'overlays', 'analysis', 'annotations', 'realtime'];
    defaultGroups.forEach(group => {
      this.groups.set(group, { visible: true, expanded: true });
    });
  }

  /** Get all layers */
  getLayers(): LayerConfig[] {
    return Array.from(this.layers.values()).sort((a, b) => a.metadata.zIndex - b.metadata.zIndex);
  }

  /** Get layers by group */
  getLayersByGroup(group: LayerGroup): LayerConfig[] {
    return this.getLayers().filter(l => l.group === group);
  }

  /** Get layer by ID */
  getLayer(id: LayerId): LayerConfig | undefined {
    return this.layers.get(id);
  }

  /** Add a single layer */
  addLayer(config: LayerConfig): LayerId {
    const existing = this.layers.get(config.id);
    if (existing) {
      this.updateLayer(config);
      return config.id;
    }

    // Assign z-index if not set
    if (config.metadata.zIndex === undefined) {
      config.metadata.zIndex = this.zIndexCounter++;
    }

    this.layers.set(config.id, config);
    return config.id;
  }

  /** Add multiple layers */
  addLayers(configs: LayerConfig[]): LayerId[] {
    return configs.map(config => this.addLayer(config));
  }

  /** Update a layer */
  updateLayer(config: Partial<LayerConfig> & { id: LayerId }): boolean {
    const existing = this.layers.get(config.id);
    if (!existing) return false;

    const updated: LayerConfig = {
      ...existing,
      ...config,
      metadata: { ...existing.metadata, ...config.metadata },
    };

    this.layers.set(config.id, updated);
    return true;
  }

  /** Remove a layer */
  removeLayer(id: LayerId): boolean {
    return this.layers.delete(id);
  }

  /** Remove layers by group */
  removeLayersByGroup(group: LayerGroup): number {
    const toRemove = this.getLayersByGroup(group).map(l => l.id);
    toRemove.forEach(id => this.layers.delete(id));
    return toRemove.length;
  }

  /** Remove all layers */
  clearLayers(): number {
    const count = this.layers.size;
    this.layers.clear();
    return count;
  }

  /** Toggle layer visibility */
  toggleLayer(id: LayerId): boolean {
    const layer = this.layers.get(id);
    if (!layer) return false;

    layer.visibility = layer.visibility === 'visible' ? 'hidden' : 'visible';
    return true;
  }

  /** Set layer visibility */
  setLayerVisibility(id: LayerId, visibility: LayerVisibility): boolean {
    const layer = this.layers.get(id);
    if (!layer) return false;

    layer.visibility = visibility;
    return true;
  }

  /** Set layer opacity */
  setLayerOpacity(id: LayerId, opacity: LayerOpacity): boolean {
    const layer = this.layers.get(id);
    if (!layer) return false;

    layer.opacity = Math.max(0, Math.min(1, opacity));
    return true;
  }

  /** Toggle group visibility */
  toggleGroup(group: LayerGroup): boolean {
    const groupState = this.groups.get(group);
    if (!groupState) return false;

    groupState.visible = !groupState.visible;
    
    // Update all layers in group
    this.getLayersByGroup(group).forEach(layer => {
      layer.visibility = groupState.visible ? 'visible' : 'hidden';
    });

    return true;
  }

  /** Set base style */
  setBaseStyle(style: keyof typeof BASE_STYLES): boolean {
    if (BASE_STYLES[style]) {
      this.baseStyle = style;
      return true;
    }
    return false;
  }

  /** Get base style */
  getBaseStyle(): StyleSpecification {
    return BASE_STYLES[this.baseStyle]();
  }

  /** Get group state */
  getGroupState(group: LayerGroup): { visible: boolean; expanded: boolean } | undefined {
    return this.groups.get(group);
  }

  /** Set group expanded state */
  setGroupExpanded(group: LayerGroup, expanded: boolean): boolean {
    const groupState = this.groups.get(group);
    if (!groupState) return false;

    groupState.expanded = expanded;
    return true;
  }

  /** Create layer from adapter asset */
  createLayerFromAsset(
    asset: DiscoveredAsset | NormalizedProduct,
    adapter: DataSourceAdapter,
    group: LayerGroup = 'imagery',
  ): LayerConfig | LayerConfig[] {
    // Determine layer type based on asset
    if (asset.assetType?.startsWith('imagery')) {
      return createImageryLayer(asset, adapter, this.zIndexCounter++);
    }

    // For GeoJSON data
    if (asset.geometry) {
      const feature: GeoJSON.Feature = {
        type: 'Feature',
        geometry: asset.geometry,
        properties: {
          id: asset.externalId,
          title: asset.title,
          adapter: adapter.id,
          provider: adapter.label,
        },
      };

      return createGeoJsonLayer(
        `geo-${adapter.id}-${asset.externalId}`,
        { type: 'FeatureCollection', features: [feature] },
        { type: 'fill', paint: { 'fill-color': 'rgba(56, 189, 248, 0.3)' } },
        {
          label: `${adapter.label}: ${asset.title}`,
          adapterId: adapter.id,
          provider: adapter.label,
          license: adapter.license().name,
          attribution: adapter.license().attribution,
        },
        group,
      );
    }

    // Default: create a simple layer
    return createGeoJsonLayer(
      `${adapter.id}-${asset.externalId}`,
      { type: 'FeatureCollection', features: [] },
      { type: 'fill', paint: { 'fill-color': 'rgba(56, 189, 248, 0.3)' } },
      {
        label: `${adapter.label}: ${asset.title}`,
        adapterId: adapter.id,
        provider: adapter.label,
      },
      group,
    );
  }

  /** Add layer from adapter asset */
  addLayerFromAsset(
    asset: DiscoveredAsset | NormalizedProduct,
    adapter: DataSourceAdapter,
    group: LayerGroup = 'imagery',
  ): LayerId | LayerId[] {
    const layerOrLayers = this.createLayerFromAsset(asset, adapter, group);
    
    if (Array.isArray(layerOrLayers)) {
      return this.addLayers(layerOrLayers);
    }
    
    return this.addLayer(layerOrLayers);
  }

  /** Remove layers from adapter */
  removeLayersFromAdapter(adapterId: string): number {
    const toRemove: LayerId[] = [];
    
    this.layers.forEach((layer, id) => {
      if (layer.metadata.adapterId === adapterId) {
        toRemove.push(id);
      }
    });

    toRemove.forEach(id => this.layers.delete(id));
    return toRemove.length;
  }

  /** Get layers from adapter */
  getLayersFromAdapter(adapterId: string): LayerConfig[] {
    return this.getLayers().filter(layer => layer.metadata.adapterId === adapterId);
  }

  /** Get all adapter IDs with layers */
  getAdapterIds(): string[] {
    const adapterIds = new Set<string>();
    this.layers.forEach(layer => {
      if (layer.metadata.adapterId) {
        adapterIds.add(layer.metadata.adapterId);
      }
    });
    return Array.from(adapterIds);
  }

  /** Get statistics */
  getStats(): {
    totalLayers: number;
    layersByGroup: Record<LayerGroup, number>;
    layersByAdapter: Record<string, number>;
    visibleLayers: number;
    hiddenLayers: number;
  } {
    const layersByGroup: Record<LayerGroup, number> = {
      base: 0,
      imagery: 0,
      overlays: 0,
      analysis: 0,
      annotations: 0,
      realtime: 0,
    };

    const layersByAdapter: Record<string, number> = {};
    let visibleLayers = 0;
    let hiddenLayers = 0;

    this.layers.forEach(layer => {
      layersByGroup[layer.group] = (layersByGroup[layer.group] || 0) + 1;
      
      if (layer.metadata.adapterId) {
        layersByAdapter[layer.metadata.adapterId] = (layersByAdapter[layer.metadata.adapterId] || 0) + 1;
      }

      if (layer.visibility === 'visible') {
        visibleLayers++;
      } else {
        hiddenLayers++;
      }
    });

    return {
      totalLayers: this.layers.size,
      layersByGroup,
      layersByAdapter,
      visibleLayers,
      hiddenLayers,
    };
  }

  /** Export state for persistence */
  exportState(): MapLayerState {
    return {
      layers: this.layers,
      groups: this.groups,
      baseStyle: this.baseStyle,
    };
  }

  /** Import state */
  importState(state: Partial<MapLayerState>): void {
    if (state.layers) {
      this.layers = new Map(state.layers);
    }
    if (state.groups) {
      this.groups = new Map(state.groups);
    }
    if (state.baseStyle) {
      this.baseStyle = state.baseStyle;
    }
  }
}

// ==========================================================================
// Singleton Instance
// ==========================================================================

let layerManagerInstance: LayerManager | null = null;

/** Get singleton layer manager instance */
export function getLayerManager(): LayerManager {
  if (!layerManagerInstance) {
    layerManagerInstance = new LayerManager();
  }
  return layerManagerInstance;
}

/** Reset singleton instance (for testing) */
export function resetLayerManager(): void {
  layerManagerInstance = null;
}

// ==========================================================================
// Utility Functions
// ==========================================================================

/** Generate unique layer ID */
export function generateLayerId(prefix: string = 'layer'): LayerId {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/** Get layer order for rendering */
export function getLayerOrder(layers: LayerConfig[]): LayerId[] {
  return layers
    .sort((a, b) => a.metadata.zIndex - b.metadata.zIndex)
    .map(l => l.id);
}

/** Filter layers by visibility */
export function getVisibleLayers(layers: LayerConfig[]): LayerConfig[] {
  return layers.filter(l => l.visibility === 'visible' && l.enabled);
}

/** Get all layer IDs */
export function getAllLayerIds(layers: LayerConfig[]): LayerId[] {
  return layers.map(l => l.id);
}

// ==========================================================================
// Predefined Layer Configurations
// ==========================================================================

/** Predefined imagery layer configurations */
export const PREDEFINED_IMAGERY_LAYERS: Record<string, Partial<LayerConfig>> = {
  'planet-basemap': {
    metadata: {
      label: 'Planet Basemap',
      description: 'Global monthly mosaic from Planet Labs',
      provider: 'Planet Labs',
      license: 'Planet Labs',
      attribution: 'Imagery © Planet Labs, Inc.',
      isLive: true,
    },
  },
  'sentinel-2': {
    metadata: {
      label: 'Sentinel-2 Cloudless',
      description: 'Cloudless Sentinel-2 mosaic',
      provider: 'Sentinel Hub',
      license: 'Copernicus',
      attribution: 'Contains modified Copernicus Sentinel data',
      isLive: true,
    },
  },
  'goes-16': {
    metadata: {
      label: 'GOES-16',
      description: 'Real-time weather satellite imagery',
      provider: 'NOAA',
      license: 'Public Domain',
      attribution: 'Data © NOAA',
      isLive: true,
    },
  },
  'maxar-opendata': {
    metadata: {
      label: 'Maxar Open Data',
      description: 'High-resolution imagery for disaster response',
      provider: 'Maxar',
      license: 'Maxar Open Data',
      attribution: 'Imagery © Maxar Technologies',
      isLive: true,
    },
  },
};

/** Predefined overlay layer configurations */
export const PREDEFINED_OVERLAY_LAYERS: Record<string, Partial<LayerConfig>> = {
  'flood-extent': {
    metadata: {
      label: 'Flood Extent',
      description: 'Areas affected by flooding',
      group: 'overlays',
      isLive: false,
    },
  },
  'damage-assessment': {
    metadata: {
      label: 'Damage Assessment',
      description: 'Building damage classification',
      group: 'analysis',
      isLive: false,
    },
  },
  'population-density': {
    metadata: {
      label: 'Population Density',
      description: 'Population per square kilometer',
      group: 'analysis',
      isLive: false,
    },
  },
  'weather-radar': {
    metadata: {
      label: 'Weather Radar',
      description: 'Real-time precipitation radar',
      group: 'realtime',
      isLive: true,
    },
  },
};

export default {
  LayerManager,
  getLayerManager,
  resetLayerManager,
  BASE_STYLES,
  createImageryLayer,
  createGeoJsonLayer,
  createHeatmapLayer,
  createClusterLayer,
  createChoroplethLayer,
  generateLayerId,
  getLayerOrder,
  getVisibleLayers,
  getAllLayerIds,
  PREDEFINED_IMAGERY_LAYERS,
  PREDEFINED_OVERLAY_LAYERS,
};
