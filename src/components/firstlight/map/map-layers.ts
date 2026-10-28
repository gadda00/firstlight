/* ==========================================================================
 * FirstLight — MapLibre style & layer definitions.
 * Base raster styles (Esri World Imagery / CARTO dark) + decision-layer
 * overlays: flood, H3 zones, roads, buildings, facilities, routes.
 * ========================================================================== */

import type { StyleSpecification } from 'maplibre-gl';

export const GLYPHS_URL =
  'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

export const LABEL_FONT = ['Open Sans Semibold'];

export function baseStyle(kind: 'satellite' | 'dark'): StyleSpecification {
  if (kind === 'satellite') {
    return {
      version: 8,
      glyphs: GLYPHS_URL,
      sources: {
        esri: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          maxzoom: 19,
          attribution:
            'Imagery © Esri, Maxar, Earthstar Geographics · Demo AOI geometry is simulated',
        },
      },
      layers: [
        {
          id: 'bg',
          type: 'background',
          paint: { 'background-color': '#09090b' },
        },
        { id: 'satellite-base', type: 'raster', source: 'esri' },
      ],
    };
  }
  return {
    version: 8,
    glyphs: GLYPHS_URL,
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
      {
        id: 'bg',
        type: 'background',
        paint: { 'background-color': '#09090b' },
      },
      { id: 'dark-base', type: 'raster', source: 'carto' },
    ],
  };
}

import type { LayerSpecification } from 'maplibre-gl';

/** Overlay layer stack (bottom → top) added to the AFTER map. */
export function overlayLayers(): LayerSpecification[] {
  return [
    /* ---------------- flood extent ---------------- */
    {
      id: 'flood-fill',
      type: 'fill',
      source: 'flood',
      paint: {
        'fill-color': [
          'match',
          ['get', 'depth'],
          'deep',
          'rgba(2,132,199,0.55)',
          'moderate',
          'rgba(56,189,248,0.42)',
          'rgba(125,211,252,0.30)',
        ],
        'fill-outline-color': 'rgba(56,189,248,0.5)',
      },
    },
    /* ---------------- H3 priority zones ---------------- */
    {
      id: 'zone-fill',
      type: 'fill',
      source: 'zones',
      paint: {
        'fill-color': [
          'interpolate',
          ['linear'],
          ['get', 'need'],
          0.2,
          'rgba(250,204,21,0.04)',
          0.38,
          'rgba(250,204,21,0.20)',
          0.58,
          'rgba(249,115,22,0.38)',
          0.8,
          'rgba(239,68,68,0.52)',
        ],
      },
    },
    {
      id: 'zone-outline',
      type: 'line',
      source: 'zones',
      paint: {
        'line-color': [
          'match',
          ['get', 'tier'],
          'warning',
          'rgba(248,113,113,0.9)',
          'watch',
          'rgba(251,191,36,0.75)',
          'rgba(148,163,184,0.28)',
        ],
        'line-width': [
          'match',
          ['get', 'tier'],
          'warning',
          1.8,
          'watch',
          1.1,
          0.5,
        ],
      },
    },
    /* ---------------- roads ---------------- */
    {
      id: 'road-pass',
      type: 'line',
      source: 'roads',
      filter: ['==', ['get', 'blocked'], false],
      paint: {
        'line-color': [
          'match',
          ['get', 'cls'],
          'highway',
          'rgba(228,228,231,0.85)',
          'arterial',
          'rgba(161,161,170,0.7)',
          'rgba(113,113,122,0.5)',
        ],
        'line-width': [
          'match',
          ['get', 'cls'],
          'highway',
          2.2,
          'arterial',
          1.4,
          0.7,
        ],
      },
    },
    {
      id: 'road-blocked',
      type: 'line',
      source: 'roads',
      filter: ['==', ['get', 'blocked'], true],
      paint: {
        'line-color': '#ef4444',
        'line-width': 2.4,
        'line-dasharray': [2, 1.4],
      },
    },
    /* ---------------- buildings ---------------- */
    {
      id: 'building-circles',
      type: 'circle',
      source: 'buildings',
      paint: {
        'circle-color': [
          'match',
          ['get', 'damage_class'],
          'destroyed',
          '#ef4444',
          'major',
          '#f97316',
          'minor',
          '#fbbf24',
          '#22c55e',
        ],
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          1.6,
          12,
          2.8,
          14,
          5,
          16,
          8,
        ],
        'circle-stroke-width': 0.4,
        'circle-stroke-color': 'rgba(9,9,11,0.8)',
        'circle-opacity': 0.92,
      },
    },
    /* ---------------- facilities ---------------- */
    {
      id: 'facility-circle',
      type: 'circle',
      source: 'facilities',
      paint: {
        'circle-color': [
          'match',
          ['get', 'type'],
          'hospital',
          '#fafafa',
          'school',
          '#f59e0b',
          'shelter',
          '#34d399',
          'water',
          '#22d3ee',
          'power',
          '#a78bfa',
          '#fb7185',
        ],
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          11,
          ['match', ['get', 'type'], 'hospital', 6.5, 4.5],
          15,
          ['match', ['get', 'type'], 'hospital', 12, 8],
        ],
        'circle-stroke-width': [
          'match',
          ['get', 'status'],
          'operational',
          1.2,
          2.4,
        ],
        'circle-stroke-color': [
          'match',
          ['get', 'status'],
          'operational',
          'rgba(9,9,11,0.85)',
          'degraded',
          '#f59e0b',
          '#ef4444',
        ],
      },
    },
    {
      id: 'facility-label',
      type: 'symbol',
      source: 'facilities',
      minzoom: 11.6,
      layout: {
        'text-field': ['get', 'letter'],
        'text-font': LABEL_FONT,
        'text-size': 9,
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': [
          'match',
          ['get', 'type'],
          'hospital',
          '#b91c1c',
          '#18181b',
        ],
      },
    },
    /* ---------------- routes ---------------- */
    {
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#f59e0b',
        'line-width': 4,
        'line-dasharray': [2.6, 1.6],
      },
    },
    {
      id: 'route-endpoint',
      type: 'circle',
      source: 'route-endpoints',
      paint: {
        'circle-color': [
          'match',
          ['get', 'kind'],
          'origin',
          '#fb7185',
          '#fde68a',
        ],
        'circle-radius': 7,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#09090b',
      },
    },
    /* ---------------- selection highlight (top) ---------------- */
    {
      id: 'highlight-fill',
      type: 'fill',
      source: 'highlight',
      paint: { 'fill-color': 'rgba(255,255,255,0.07)' },
    },
    {
      id: 'highlight-line',
      type: 'line',
      source: 'highlight',
      paint: {
        'line-color': '#fafafa',
        'line-width': 2.6,
      },
    },
  ];
}

export const OVERLAY_LAYER_IDS = overlayLayers().map((l) => l.id);
