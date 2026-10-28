/* ==========================================================================
 * FirstLight — Decision Layer (blueprint Layer 4).
 * H3 res-8 zoning, need scores, travel-time isolation analysis, routing.
 *   need(z) = w1·D(z) + w2·Pexp(z) + w3·Iso(z) + w4·Crit(z)
 *   D(z)   = (1.0·n_destroyed + 0.6·n_major + 0.2·n_minor) / n_total
 *   Pexp   = affected_population / max_zone_population
 *   Iso    = 1 if travel-time delta to nearest hospital > 30 min or unreachable
 *   Crit   = impacted critical facilities / max_zone_impacted
 * ========================================================================== */

import { cellToBoundary, cellToLatLng, latLngToCell, polygonToCells } from 'h3-js';
import { RoadGraph } from './graph';
import { offset, pointInRing, clamp } from './geo';
import type {
  Building,
  DamageClass,
  EventDecisionData,
  EventRawData,
  Facility,
  NeedWeights,
  ReviewDecision,
  RoadSegment,
  RouteResult,
  Zone,
} from './types';

export const H3_RES = 8;

export interface ReviewOverrides {
  decisions: Map<string, ReviewDecision>;
  newClasses: Map<string, DamageClass>;
}

export const DEFAULT_WEIGHTS: NeedWeights = {
  w1: 0.35,
  w2: 0.25,
  w3: 0.25,
  w4: 0.15,
};

function effectiveDamage(b: Building, ov: ReviewOverrides): DamageClass {
  const d = ov.decisions.get(b.id);
  if (d === 'rejected') return 'none';
  if (d === 'reclassified') return ov.newClasses.get(b.id) ?? b.damage;
  return b.damage;
}

function tierFor(need: number): Zone['tier'] {
  if (need >= 0.58) return 'warning';
  if (need >= 0.38) return 'watch';
  return 'informational';
}

/** Dijkstra from multiple virtual sources (hospitals) in one run. */
function multiSource(
  graph: RoadGraph,
  sources: string[],
  postEvent: boolean,
): Map<string, number> {
  const { distMin } = graph.dijkstraMulti(sources, postEvent);
  return distMin;
}

export function computeDecision(
  raw: EventRawData,
  weights: NeedWeights,
  overrides: ReviewOverrides,
): EventDecisionData {
  const { meta } = raw;
  const A = meta.aoiKm;

  /* ---- H3 zone assignment ---- */
  const aoiRing: [number, number][] = [
    [offset(meta.center, -A, -A).lng, offset(meta.center, -A, -A).lat],
    [offset(meta.center, A, -A).lng, offset(meta.center, A, -A).lat],
    [offset(meta.center, A, A).lng, offset(meta.center, A, A).lat],
    [offset(meta.center, -A, A).lng, offset(meta.center, -A, A).lat],
    [offset(meta.center, -A, -A).lng, offset(meta.center, -A, -A).lat],
  ];
  const cells = polygonToCells(
    aoiRing.map(([lng, lat]) => [lng, lat]),
    H3_RES,
    true,
  );

  const zoneAgg = new Map<
    string,
    {
      buildings: number;
      destroyed: number;
      major: number;
      minor: number;
      population: number;
      critCount: number;
      critImpacted: number;
    }
  >();
  const agg = (id: string) => {
    let z = zoneAgg.get(id);
    if (!z) {
      z = {
        buildings: 0,
        destroyed: 0,
        major: 0,
        minor: 0,
        population: 0,
        critCount: 0,
        critImpacted: 0,
      };
      zoneAgg.set(id, z);
    }
    return z;
  };

  for (const b of raw.buildings) {
    const zid = latLngToCell(b.lat, b.lng, H3_RES);
    b.zone = zid;
    const z = agg(zid);
    const dmg = effectiveDamage(b, overrides);
    z.buildings++;
    if (dmg === 'destroyed') z.destroyed++;
    else if (dmg === 'major') z.major++;
    else if (dmg === 'minor') z.minor++;
  }

  for (const c of raw.popGrid) {
    const zid = latLngToCell(c.lat, c.lng, H3_RES);
    agg(zid).population += c.pop;
  }

  const CRITICAL_TYPES = new Set(['hospital', 'school', 'shelter', 'water', 'power']);
  for (const f of raw.facilities) {
    const zid = latLngToCell(f.lat, f.lng, H3_RES);
    f.zone = zid;
    if (CRITICAL_TYPES.has(f.type)) {
      const z = agg(zid);
      z.critCount++;
      if (f.status !== 'operational') z.critImpacted++;
    }
  }

  /* ---- road graph + travel times ---- */
  const graph = new RoadGraph(raw.roads);
  const eocNode = graph.nearestNode(meta.center.lng, meta.center.lat);
  const hospitals = raw.facilities.filter((f) => f.type === 'hospital');
  const hospitalNodes = hospitals.map((f) => f.node);

  const hospitalPre = multiSource(graph, hospitalNodes, false);
  const hospitalPost = multiSource(graph, hospitalNodes, true);
  const eocPre = graph.dijkstra(eocNode, false).distMin;
  const eocPost = graph.dijkstra(eocNode, true).distMin;

  for (const f of raw.facilities) {
    f.preTravelMin = eocPre.get(f.node) ?? Infinity;
    f.postTravelMin = eocPost.get(f.node) ?? Infinity;
    const wasReachable = f.preTravelMin < 90;
    const nowReachable = f.postTravelMin < 90;
    f.isolated = (f.status === 'offline') || (wasReachable && (!nowReachable || f.postTravelMin - f.preTravelMin > 30));
  }

  /* ---- flood share per zone ---- */
  const rings = raw.floods.map((f) => f.ring);
  const floodShare = (boundary: [number, number][], centroid: { lng: number; lat: number }): number => {
    if (!rings.length) return 0;
    let hit = 0;
    let n = 0;
    for (let i = 0; i < boundary.length - 1; i += 2) {
      n++;
      if (rings.some((r) => pointInRing(boundary[i][0], boundary[i][1], r))) hit++;
    }
    if (rings.some((r) => pointInRing(centroid.lng, centroid.lat, r))) hit++;
    n++;
    return n ? hit / n : 0;
  };

  /* ---- zone assembly ---- */
  const zones: Zone[] = [];
  for (const id of cells) {
    const a = zoneAgg.get(id);
    if (!a) continue;
    const boundary = cellToBoundary(id, true) as unknown as [number, number][];
    boundary.push(boundary[0]);
    const c = cellToLatLng(id);
    const centroid = { lng: c[1], lat: c[0] };
    const node = graph.nearestNode(centroid.lng, centroid.lat);
    const preHospitalMin = hospitalPre.get(node) ?? Infinity;
    const postHospitalMin = hospitalPost.get(node) ?? Infinity;
    const D =
      a.buildings > 0
        ? (a.destroyed + 0.6 * a.major + 0.2 * a.minor) / a.buildings
        : 0;
    const share = floodShare(boundary, centroid);
    zones.push({
      id,
      boundary,
      centroid,
      buildings: a.buildings,
      destroyed: a.destroyed,
      major: a.major,
      minor: a.minor,
      undamaged: a.buildings - a.destroyed - a.major - a.minor,
      D,
      Pexp: 0,
      Iso: 0,
      Crit: 0,
      need: 0,
      tier: 'informational',
      population: a.population,
      affectedPop: 0,
      critCount: a.critCount,
      critImpacted: a.critImpacted,
      isolated: false,
      preHospitalMin,
      postHospitalMin,
      floodShare: share,
      rank: 0,
    });
  }

  const maxPop = Math.max(1, ...zones.map((z) => z.population));
  const maxCrit = Math.max(1, ...zones.map((z) => z.critImpacted));

  for (const z of zones) {
    z.Pexp = z.population / maxPop;
    const delta = z.postHospitalMin - z.preHospitalMin;
    const unreachable = z.postHospitalMin > 90 && z.preHospitalMin <= 90;
    z.isolated = unreachable || delta > 30;
    z.Iso = z.isolated ? 1 : 0;
    z.Crit = z.critImpacted / maxCrit;
    z.affectedPop = Math.round(
      z.population * clamp(z.D * 1.5 + z.floodShare * 0.75, 0, 1),
    );
  }

  scoreZones(zones, weights);

  /* ---- event-level stats ---- */
  const totalBuildings = zones.reduce((s, z) => s + z.buildings, 0);
  const destroyed = zones.reduce((s, z) => s + z.destroyed, 0);
  const major = zones.reduce((s, z) => s + z.major, 0);
  const minor = zones.reduce((s, z) => s + z.minor, 0);
  const affectedPop = zones.reduce((s, z) => s + z.affectedPop, 0);
  const totalPop = zones.reduce((s, z) => s + z.population, 0);
  const floodedAreaKm2 = raw.floods.reduce((s, f) => s + f.areaKm2, 0);
  const meanConfidence =
    raw.buildings.reduce((s, b) => s + b.confidence, 0) /
    Math.max(1, raw.buildings.length);

  const stats: EventDecisionData['stats'] = {
    totalBuildings,
    destroyed,
    major,
    minor,
    damageRate: totalBuildings ? (destroyed + major) / totalBuildings : 0,
    floodedAreaKm2,
    totalPop,
    affectedPop,
    affectedPct: totalPop ? affectedPop / totalPop : 0,
    isolatedZones: zones.filter((z) => z.isolated).length,
    facilitiesOffline: raw.facilities.filter((f) => f.status === 'offline').length,
    facilitiesDegraded: raw.facilities.filter((f) => f.status === 'degraded').length,
    hospitalsIsolated: hospitals.filter((f) => f.isolated).length,
    meanConfidence,
    pendingReview: raw.buildings.filter(
      (b) => b.reviewReason && !overrides.decisions.has(b.id),
    ).length,
    aoiKm2: (2 * A) ** 2,
  };

  const zoneIndex = new Map(zones.map((z) => [z.id, z]));
  return { zones, zoneIndex, stats, routes: [] };
}

/** Apply weights, recompute need + tiers + ranks in place. */
export function scoreZones(zones: Zone[], weights: NeedWeights): void {
  const sum = weights.w1 + weights.w2 + weights.w3 + weights.w4;
  const n = sum > 0 ? sum : 1;
  const w1 = weights.w1 / n;
  const w2 = weights.w2 / n;
  const w3 = weights.w3 / n;
  const w4 = weights.w4 / n;
  for (const z of zones) {
    z.need = w1 * z.D + w2 * z.Pexp + w3 * z.Iso + w4 * z.Crit;
    z.tier = tierFor(z.need);
  }
  const sorted = [...zones].sort((a, b) => b.need - a.need);
  sorted.forEach((z, i) => (z.rank = i + 1));
}

/** Compute a dispatch route from a facility to a zone centroid (post-event graph). */
export function computeRoute(
  raw: EventRawData,
  origin: Facility,
  destZone: Zone,
  roadsById: Map<string, RoadSegment>,
): RouteResult | null {
  const graph = new RoadGraph(raw.roads);
  const destNode = graph.nearestNode(destZone.centroid.lng, destZone.centroid.lat);
  const { distMin, prev } = graph.dijkstra(origin.node, true);
  if (!distMin.has(destNode)) return null;
  const { nodes, roadIds } = graph.pathTo(destNode, prev);
  const coords: [number, number][] = nodes.map((id) => {
    const nd = graph.nodes.get(id)!;
    return [nd.lng, nd.lat];
  });
  let distanceKm = 0;
  let confSum = 0;
  let flagged = false;
  for (const rid of roadIds) {
    const rd = roadsById.get(rid);
    if (!rd) continue;
    distanceKm += rd.lengthKm;
    confSum += rd.confidence;
    if (rd.confidence < 0.93 || rd.blockCause) flagged = true;
  }
  // blocked edges adjacent to path nodes (avoided by the router)
  const pathSet = new Set(roadIds);
  const nodeSet = new Set(nodes);
  let avoided = 0;
  for (const nid of nodeSet) {
    const nd = graph.nodes.get(nid);
    if (!nd) continue;
    for (const e of nd.edges) {
      if (e.blocked && !pathSet.has(e.roadId)) {
        avoided++;
      }
    }
  }
  avoided = Math.round(avoided / 2); // undirected duplicates

  return {
    id: `route-${origin.id}-${destZone.id}`,
    originName: origin.name,
    destZoneId: destZone.id,
    destLabel: `Zone #${destZone.rank}`,
    coords,
    distanceKm,
    etaMin: distMin.get(destNode) ?? 0,
    usesFlaggedSegments: flagged,
    blockedEdgesAvoided: avoided,
    confidence: roadIds.length ? confSum / roadIds.length : 1,
  };
}

/** Facilities usable as dispatch origins (fire stations, operational preferred). */
export function dispatchOrigins(facilities: Facility[]): Facility[] {
  return facilities.filter((f) => f.type === 'fire_station');
}
