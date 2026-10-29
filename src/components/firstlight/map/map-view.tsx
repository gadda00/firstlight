/* ==========================================================================
 * FirstLight — dual-synced swipe map (before/after comparison).
 * BEFORE map: clean satellite. AFTER map: satellite + decision overlays.
 * Draggable divider clips the after map (classic swipe pattern).
 * ========================================================================== */

'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import type {
  GeoJSONSource,
  Map as MLMap,
  MapMouseEvent,
  MapOptions,
  SourceSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { baseStyle, overlayLayers } from './map-layers';
import { useFirstLight } from '@/store/firstlight';
import { offset } from '@/lib/firstlight/geo';
import type { FacilityType } from '@/lib/firstlight/types';

const FACILITY_LETTER: Record<FacilityType, string> = {
  hospital: 'H',
  school: 'S',
  shelter: 'R',
  water: 'W',
  power: 'P',
  fire_station: 'F',
};

interface TooltipState {
  x: number;
  y: number;
  title: string;
  rows: { label: string; value: string }[];
}

export default function MapView() {
  const beforeRef = useRef<HTMLDivElement>(null);
  const afterRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const beforeMap = useRef<MLMap | null>(null);
  const afterMap = useRef<MLMap | null>(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [split, setSplit] = useState(55);
  const dragging = useRef(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const baseStyleKind = useFirstLight((s) => s.baseStyle);
  const swipe = useFirstLight((s) => s.swipe);
  const eventId = useFirstLight((s) => s.eventId);
  const raw = useFirstLight((s) => s.raw);
  const decision = useFirstLight((s) => s.decision);
  const layers = useFirstLight((s) => s.layers);
  const reviewDecisions = useFirstLight((s) => s.reviewDecisions);
  const reviewClasses = useFirstLight((s) => s.reviewClasses);
  const routes = useFirstLight((s) => s.routes);
  const selectedZoneId = useFirstLight((s) => s.selectedZoneId);
  const selectZone = useFirstLight((s) => s.selectZone);
  const meta = raw?.meta;

  const emptyFC = useMemo(
    () => ({ type: 'FeatureCollection' as const, features: [] }),
    [],
  );

  /* ---------------------------------------------- map lifecycle */
  useEffect(() => {
    if (!beforeRef.current || !afterRef.current) return;
    const common: Partial<MapOptions> = {
      attributionControl: false,
      doubleClickZoom: true,
    };
    const before = new maplibregl.Map({
      ...common,
      container: beforeRef.current,
      style: baseStyle(baseStyleKind),
      center: meta ? [meta.center.lng, meta.center.lat] : [0, 0],
      zoom: 11.5,
    });
    const after = new maplibregl.Map({
      ...common,
      container: afterRef.current,
      style: baseStyle(baseStyleKind),
      center: meta ? [meta.center.lng, meta.center.lat] : [0, 0],
      zoom: 11.5,
    });
    beforeMap.current = before;
    afterMap.current = after;

    after.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-right',
    );
    after.addControl(
      new maplibregl.NavigationControl({ visualizePitch: false }),
      'bottom-right',
    );
    after.addControl(
      new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }),
      'bottom-left',
    );

    // camera sync
    let syncing = false;
    const hook = (src: MLMap, dst: MLMap) => {
      src.on('move', () => {
        if (syncing || !dst) return;
        syncing = true;
        dst.jumpTo({
          center: src.getCenter(),
          zoom: src.getZoom(),
          bearing: src.getBearing(),
          pitch: src.getPitch(),
        });
        syncing = false;
      });
    };
    hook(before, after);
    hook(after, before);

    after.on('load', () => {
      // add GeoJSON sources BEFORE layers reference them
      const geoSources: Record<string, SourceSpecification> = {
        flood: { type: 'geojson', data: emptyFC },
        zones: { type: 'geojson', data: emptyFC },
        roads: { type: 'geojson', data: emptyFC },
        buildings: { type: 'geojson', data: emptyFC },
        facilities: { type: 'geojson', data: emptyFC },
        route: { type: 'geojson', data: emptyFC },
        'route-endpoints': { type: 'geojson', data: emptyFC },
        highlight: { type: 'geojson', data: emptyFC },
      };
      for (const [id, spec] of Object.entries(geoSources)) {
        if (!after.getSource(id)) after.addSource(id, spec);
      }
      for (const layer of overlayLayers()) {
        after.addLayer(layer);
      }
      setMapsReady(true);
    });

    return () => {
      setMapsReady(false);
      before.remove();
      after.remove();
      beforeMap.current = null;
      afterMap.current = null;
    };
  }, [baseStyleKind]);

  /* ---------------------------------------------- data prep */

  const floodFC = useMemo(() => {
    if (!raw) return emptyFC;
    return {
      type: 'FeatureCollection' as const,
      features: raw.floods.map((f) => ({
        type: 'Feature' as const,
        geometry: { type: 'Polygon' as const, coordinates: [f.ring] },
        properties: { depth: f.depthClass, area_km2: f.areaKm2 },
      })),
    };
  }, [raw, emptyFC]);

  const zoneFC = useMemo(() => {
    if (!decision) return emptyFC;
    return {
      type: 'FeatureCollection' as const,
      features: decision.zones.map((z) => ({
        type: 'Feature' as const,
        id: z.id,
        geometry: { type: 'Polygon' as const, coordinates: [z.boundary] },
        properties: {
          h3: z.id,
          need: z.need,
          tier: z.tier,
          rank: z.rank,
          population: z.population,
          affected_pop: z.affectedPop,
          destroyed: z.destroyed,
          major: z.major,
          minor: z.minor,
          buildings: z.buildings,
          isolated: z.isolated,
          flood_share: z.floodShare,
          D: z.D,
          Pexp: z.Pexp,
          Iso: z.Iso,
          Crit: z.Crit,
        },
      })),
    };
  }, [decision, emptyFC]);

  const roadFC = useMemo(() => {
    if (!raw) return emptyFC;
    return {
      type: 'FeatureCollection' as const,
      features: raw.roads.map((r) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: r.coords },
        properties: { cls: r.cls, blocked: r.blocked },
      })),
    };
  }, [raw, emptyFC]);

  const buildingFC = useMemo(() => {
    if (!raw) return emptyFC;
    const showUndamaged = layers.undamaged;
    const feats: {
      type: 'Feature';
      geometry: { type: 'Point'; coordinates: number[] };
      properties: Record<string, unknown>;
    }[] = [];
    for (const b of raw.buildings) {
      const dec = reviewDecisions.get(b.id);
      if (dec === 'rejected') continue;
      const eff =
        dec === 'reclassified'
          ? reviewClasses.get(b.id) ?? b.damage
          : b.damage;
      if (eff === 'none' && !showUndamaged) continue;
      feats.push({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [b.lng, b.lat] },
        properties: {
          damage_class: eff,
          reviewed: dec ? 1 : 0,
        },
      });
    }
    return { type: 'FeatureCollection' as const, features: feats };
  }, [raw, reviewDecisions, reviewClasses, layers.undamaged, emptyFC]);

  const facilityFC = useMemo(() => {
    if (!raw) return emptyFC;
    return {
      type: 'FeatureCollection' as const,
      features: raw.facilities.map((f) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [f.lng, f.lat] },
        properties: {
          type: f.type,
          letter: FACILITY_LETTER[f.type],
          name: f.name,
          status: f.status,
        },
      })),
    };
  }, [raw, emptyFC]);

  const routeFC = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: routes
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .map((r) => ({
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: r.coords },
          properties: { origin: r.originName, dest: r.destLabel },
        })),
    }),
    [routes],
  );

  const routeEndpointFC = useMemo(() => {
    const feats: Record<string, unknown>[] = [];
    for (const r of routes) {
      if (!r) continue;
      const originFacility = raw?.facilities.find(
        (f) => f.name === r.originName,
      );
      if (originFacility) {
        feats.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [originFacility.lng, originFacility.lat],
          },
          properties: { kind: 'origin' },
        });
      }
      feats.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: r.coords[r.coords.length - 1] },
        properties: { kind: 'dest' },
      });
    }
    return { type: 'FeatureCollection' as const, features: feats };
  }, [routes, raw]);

  const highlightFC = useMemo(() => {
    const feats: Record<string, unknown>[] = [];
    if (decision) {
      const ids = new Set<string>([...(selectedZoneId ? [selectedZoneId] : []), ...routes.map((r) => r?.destZoneId).filter(Boolean) as string[]]);
      for (const id of ids) {
        const z = decision.zoneIndex.get(id);
        if (!z) continue;
        feats.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [z.boundary] },
          properties: { h3: z.id },
        });
      }
    }
    return { type: 'FeatureCollection' as const, features: feats };
  }, [decision, selectedZoneId, routes]);

  /* ---------------------------------------------- data binding */
  useEffect(() => {
    const after = afterMap.current;
    if (!mapsReady || !after || !after.isStyleLoaded()) return;
    const setData = (sourceId: string, data: unknown) => {
      const src = after.getSource(sourceId) as GeoJSONSource | undefined;
      if (src) src.setData(data as never);
    };
    setData('flood', floodFC);
    setData('zones', zoneFC);
    setData('roads', roadFC);
    setData('buildings', buildingFC);
    setData('facilities', facilityFC);
    setData('route', routeFC);
    setData('route-endpoints', routeEndpointFC);
    setData('highlight', highlightFC);
  }, [
    mapsReady,
    floodFC,
    zoneFC,
    roadFC,
    buildingFC,
    facilityFC,
    routeFC,
    routeEndpointFC,
    highlightFC,
  ]);

  /* ---------------------------------------------- fit bounds on event change */
  useEffect(() => {
    const after = afterMap.current;
    if (!mapsReady || !after || !meta) return;
    const A = meta.aoiKm;
    const sw = offset(meta.center, -A, -A);
    const ne = offset(meta.center, A, A);
    after.fitBounds(
      [
        [sw.lng, sw.lat],
        [ne.lng, ne.lat],
      ],
      { padding: 60, duration: 900, maxZoom: 13.5 },
    );
  }, [mapsReady, eventId, meta]);

  /* ---------------------------------------------- layer visibility */
  useEffect(() => {
    const after = afterMap.current;
    if (!mapsReady || !after) return;
    const vis = (id: string, visible: boolean) => {
      if (after.getLayer(id)) {
        after.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    };
    vis('flood-fill', layers.flood);
    vis('zone-fill', layers.zones);
    vis('zone-outline', layers.zones);
    vis('road-pass', layers.roads);
    vis('road-blocked', layers.roads);
    vis('building-circles', layers.damage);
    vis('facility-circle', layers.facilities);
    vis('facility-label', layers.facilities);
    vis('route-line', layers.routes && routes.length > 0);
    vis('route-endpoint', layers.routes && routes.length > 0);
    vis('highlight-fill', Boolean(selectedZoneId) || routes.length > 0);
    vis('highlight-line', Boolean(selectedZoneId) || routes.length > 0);
  }, [mapsReady, layers, routes.length, selectedZoneId]);

  /* ---------------------------------------------- hover / click */
  useEffect(() => {
    const after = afterMap.current;
    if (!mapsReady || !after) return;
    const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
    const onMove = (e: MapMouseEvent) => {
      const feats = after.queryRenderedFeatures(e.point, {
        layers: ['zone-fill'],
      });
      if (!feats.length) {
        setTooltip(null);
        after.getCanvas().style.cursor = '';
        return;
      }
      const p = feats[0].properties as Record<string, unknown>;
      after.getCanvas().style.cursor = 'pointer';
      setTooltip({
        x: e.point.x,
        y: e.point.y,
        title: `Zone #${p.rank} · ${String(p.tier).toUpperCase()}`,
        rows: [
          { label: 'Need score', value: (p.need as number).toFixed(3) },
          {
            label: 'Buildings des/maj',
            value: `${p.destroyed}/${p.major} of ${p.buildings}`,
          },
          { label: 'Population', value: fmt(p.population as number) },
          { label: 'Affected', value: fmt(p.affected_pop as number) },
          { label: 'Flood share', value: `${Math.round((p.flood_share as number) * 100)}%` },
          { label: 'Isolated', value: p.isolated ? 'YES' : 'no' },
          { label: 'H3', value: String(p.h3) },
        ],
      });
    };
    const onLeave = () => {
      setTooltip(null);
      after.getCanvas().style.cursor = '';
    };
    const onClick = (e: MapMouseEvent) => {
      const feats = after.queryRenderedFeatures(e.point, {
        layers: ['zone-fill'],
      });
      if (feats.length) {
        selectZone(String(feats[0].properties?.h3));
      }
    };
    after.on('mousemove', onMove);
    after.on('mouseout', onLeave);
    after.on('click', onClick);
    return () => {
      after.off('mousemove', onMove);
      after.off('mouseout', onLeave);
      after.off('click', onClick);
    };
  }, [mapsReady, selectZone]);

  /* ---------------------------------------------- resize robustness */
  useEffect(() => {
    if (!mapsReady || !containerRef.current) return;
    const ro = new ResizeObserver(() => {
      beforeMap.current?.resize();
      afterMap.current?.resize();
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [mapsReady]);

  // re-measure when the before map is shown/hidden by the swipe toggle
  useEffect(() => {
    const t = setTimeout(() => {
      beforeMap.current?.resize();
      afterMap.current?.resize();
    }, 60);
    return () => clearTimeout(t);
  }, [swipe]);

  /* ---------------------------------------------- swipe divider */
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setSplit(Math.max(5, Math.min(95, pct)));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const tierCounts = useMemo(() => {
    if (!decision)
      return { warning: 0, watch: 0, informational: 0, insufficient_evidence: 0 };
    return decision.zones.reduce(
      (acc, z) => {
        acc[z.tier]++;
        return acc;
      },
      { warning: 0, watch: 0, informational: 0, insufficient_evidence: 0 },
    );
  }, [decision]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden bg-zinc-950"
    >
      {/* BEFORE map (clean) — inline position beats maplibre's `.maplibregl-map{position:relative}` */}
      <div
        ref={beforeRef}
        className={swipe ? '' : 'hidden'}
        style={{ position: 'absolute', inset: 0 }}
      />
      {/* AFTER map (analysis) — clipped by divider */}
      <div
        ref={afterRef}
        style={{
          position: 'absolute',
          inset: 0,
          ...(swipe ? { clipPath: `inset(0 0 0 ${split}%)` } : {}),
        }}
      />

      {/* swipe divider */}
      {swipe && (
        <div
          className="absolute top-0 bottom-0 z-20 w-0.5 bg-amber-400/90 cursor-col-resize"
          style={{ left: `${split}%` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-amber-400 shadow-lg shadow-amber-500/40 border-4 border-zinc-950 flex items-center justify-center">
            <span className="text-[10px] font-black text-zinc-950 tracking-wider">
              ⇄
            </span>
          </div>
        </div>
      )}

      {/* pane labels */}
      {swipe && (
        <>
          <div className="absolute top-3 left-3 z-10 rounded-md bg-zinc-950/75 backdrop-blur px-2.5 py-1 border border-zinc-800">
            <span className="text-[10px] font-semibold tracking-widest text-zinc-300">
              PRE-EVENT · {meta?.preDate ?? ''}
            </span>
          </div>
          <div className="absolute top-3 right-3 z-10 rounded-md bg-zinc-950/75 backdrop-blur px-2.5 py-1 border border-amber-500/40">
            <span className="text-[10px] font-semibold tracking-widest text-amber-300">
              POST-EVENT ANALYSIS · {meta?.postDate ?? ''}
            </span>
          </div>
        </>
      )}
      {!swipe && (
        <div className="absolute top-3 left-3 z-10 rounded-md bg-zinc-950/75 backdrop-blur px-2.5 py-1 border border-amber-500/40">
          <span className="text-[10px] font-semibold tracking-widest text-amber-300">
            POST-EVENT ANALYSIS · {meta?.postDate ?? ''}
          </span>
        </div>
      )}

      {/* legend */}
      <div className="absolute bottom-3 left-3 z-10 rounded-lg bg-zinc-950/85 backdrop-blur border border-zinc-800 px-3 py-2.5 space-y-1.5 max-w-[210px]">
        <div className="text-[10px] font-bold tracking-widest text-zinc-400 mb-1">
          LEGEND
        </div>
        <LegendRow color="#ef4444" label={`Destroyed · ${tierCounts.warning} warning zones`} />
        <LegendRow color="#f97316" label={`Major damage · ${tierCounts.watch} watch zones`} />
        <LegendRow color="#fbbf24" label="Minor damage" />
        <LegendRow color="#38bdf8" label="Flood extent (SAR)" />
        <LegendRow color="#a1a1aa" label="Passable road" />
        <LegendRow color="#ef4444" label="Blocked road (dashed)" dashed />
        <LegendRow color="#fafafa" label="H = hospital · R = shelter" />
        <LegendRow color="#f59e0b" label="Dispatch route" dashed />
      </div>

      {/* zone tooltip */}
      {tooltip && (
        <div
          className="absolute z-30 pointer-events-none rounded-lg bg-zinc-950/95 border border-zinc-700 px-3 py-2 shadow-xl"
          style={{
            left: Math.min(tooltip.x + 16, 9999),
            top: tooltip.y + 12,
            transform: 'translateY(0)',
          }}
        >
          <div className="text-xs font-bold text-amber-300 mb-1">
            {tooltip.title}
          </div>
          {tooltip.rows.map((r) => (
            <div key={r.label} className="flex gap-3 text-[11px] leading-4">
              <span className="text-zinc-500 min-w-[90px]">{r.label}</span>
              <span className="text-zinc-200 font-mono">{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LegendRow({
  color,
  label,
  dashed,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`h-1.5 w-5 rounded-full ${dashed ? '' : ''}`}
        style={{
          backgroundColor: dashed ? 'transparent' : color,
          backgroundImage: dashed
            ? `repeating-linear-gradient(90deg, ${color} 0 6px, transparent 6px 10px)`
            : undefined,
          height: dashed ? 3 : 6,
        }}
      />
      <span className="text-[10px] text-zinc-300 leading-tight">{label}</span>
    </div>
  );
}
