/* ==========================================================================
 * FirstLight — procedural event data generator.
 * Produces deterministic, seeded demo datasets: road grid + graph,
 * building stock, damage fields per archetype, flood extents, facilities,
 * population grid, and pipeline stage timings.
 * ========================================================================== */

import { Rng } from './rng';
import {
  distKm,
  kmPerDegLat,
  kmPerDegLng,
  offset,
  pointInRing,
  ringAreaKm2,
  rotatedRect,
  clamp,
} from './geo';
import type {
  Building,
  DamageClass,
  EventMeta,
  EventRawData,
  Facility,
  FloodPolygon,
  LatLng,
  PipelineStage,
  PopCell,
  RoadSegment,
} from './types';

const LOCAL_STEP_KM = 0.65;
const ARTERIAL_EVERY = 3;

interface KmPoint {
  x: number;
  y: number;
}

function toLatLng(center: LatLng, p: KmPoint): LatLng {
  return offset(center, p.x, p.y);
}

/** distance (km) from point to nearest vertex of a polyline */
function distToPolyline(p: LatLng, line: LatLng[]): number {
  let best = Infinity;
  for (let i = 0; i < line.length; i += 2) {
    const d = distKm(p, line[i]);
    if (d < best) best = d;
  }
  if (best === Infinity && line.length) {
    for (const q of line) best = Math.min(best, distKm(p, q));
  }
  return best;
}

export function generateEvent(meta: EventMeta): EventRawData {
  const rng = new Rng(meta.seed);
  const A = meta.aoiKm;

  /* ---------------------------------------------------------------- roads */
  const nLines = Math.floor(A / LOCAL_STEP_KM);
  const lineOffsets: number[] = [];
  for (let i = -nLines; i <= nLines; i++) lineOffsets.push(i * LOCAL_STEP_KM);

  const hwRow = Math.round(nLines * 0.28);
  const hwCol = -Math.round(nLines * 0.22);

  const lineClass = (idx: number, isRow: boolean): RoadSegment['cls'] => {
    if (isRow ? idx === hwRow : idx === hwCol) return 'highway';
    if (idx % ARTERIAL_EVERY === 0) return 'arterial';
    return 'local';
  };

  const roads: RoadSegment[] = [];
  // horizontal roads (rows) — vary j
  for (let j = 0; j < lineOffsets.length; j++) {
    const y = lineOffsets[j];
    const cls = lineClass(j - nLines, true);
    for (let i = 0; i < lineOffsets.length - 1; i++) {
      roads.push(makeSegment('h', j, i, cls, [
        { x: lineOffsets[i], y },
        { x: lineOffsets[i + 1], y },
      ]));
    }
  }
  // vertical roads (cols) — vary i
  for (let i = 0; i < lineOffsets.length; i++) {
    const x = lineOffsets[i];
    const cls = lineClass(i - nLines, false);
    for (let j = 0; j < lineOffsets.length - 1; j++) {
      roads.push(makeSegment('v', i, j, cls, [
        { x, y: lineOffsets[j] },
        { x, y: lineOffsets[j + 1] },
      ]));
    }
  }

  function makeSegment(
    kind: 'h' | 'v',
    a: number,
    b: number,
    cls: RoadSegment['cls'],
    km: [KmPoint, KmPoint],
  ): RoadSegment {
    const p1 = toLatLng(meta.center, km[0]);
    const p2 = toLatLng(meta.center, km[1]);
    const lengthKm = distKm(p1, p2);
    const speed = cls === 'highway' ? 90 : cls === 'arterial' ? 55 : 35;
    return {
      id: `rd-${kind}-${a}-${b}`,
      coords: [
        [p1.lng, p1.lat],
        [p2.lng, p2.lat],
      ],
      cls,
      lengthKm,
      speedKmh: speed,
      blocked: false,
      blockCause: null,
      confidence: 0.93 + rng.float() * 0.06,
      nodes: [
        kind === 'h' ? `n,${b},${a}` : `n,${a},${b}`,
        kind === 'h' ? `n,${b + 1},${a}` : `n,${a},${b + 1}`,
      ],
    };
  }

  /* ---------------------------------------------------------------- floods */
  const floods: FloodPolygon[] = [];

  function ringFromBand(
    centerFn: (t: number) => KmPoint, // t in [0,1] along centerline
    widthKm: (t: number) => number,
    capEnds: boolean,
  ): { ring: [number, number][]; centerline: LatLng[] } {
    const N = 90;
    const top: LatLng[] = [];
    const bottom: LatLng[] = [];
    const centerline: LatLng[] = [];
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const c = centerFn(t);
      const w = widthKm(t) / 2;
      centerline.push(toLatLng(meta.center, c));
      const wob = 0.08 * Math.sin(t * 26 + (meta.seed % 7));
      top.push(offset(meta.center, c.x + wob, c.y + w));
      bottom.push(offset(meta.center, c.x - wob, c.y - w));
    }
    const ring: [number, number][] = [];
    if (capEnds) {
      const first = top[0];
      ring.push([first.lng, first.lat]);
    }
    for (const p of top) ring.push([p.lng, p.lat]);
    const reversed = [...bottom].reverse();
    for (const p of reversed) ring.push([p.lng, p.lat]);
    if (capEnds) {
      const last = reversed[reversed.length - 1];
      ring.push([last.lng, last.lat]);
    }
    ring.push(ring[0]);
    return { ring, centerline };
  }

  let riverCenterline: LatLng[] = [];

  if (meta.archetype === 'flood') {
    const amp = meta.riverAmplitudeKm ?? 2.0;
    const phase = rng.range(0, Math.PI);
    const { ring, centerline } = ringFromBand(
      (t) => ({
        x: -A + 2 * A * t,
        y: 0.8 + amp * Math.sin(t * Math.PI * 2.6 + phase),
      }),
      (t) => 0.85 + 0.75 * (0.5 + 0.5 * Math.sin(t * 9 + phase)),
      true,
    );
    riverCenterline = centerline;
    floods.push({
      id: 'fl-river',
      ring,
      depthClass: 'moderate',
      areaKm2: ringAreaKm2(ring),
      source: 'S1 RTC change-detect (Otsu) + U-Net fusion',
      confidence: 0.93,
    });
  } else if (meta.archetype === 'hurricane') {
    // storm surge band along the western (coastal) edge, wider near landfall latitude
    const lf = meta.landfall!;
    const lfY =
      (lf.lat - meta.center.lat) * kmPerDegLat();
    const surgeW = (y: number) =>
      1.3 + 2.4 * Math.exp(-(((y - lfY) / 4.2) ** 2));
    const N = 80;
    const eastEdge: [number, number][] = [];
    for (let k = 0; k <= N; k++) {
      const y = -A + (2 * A * k) / N;
      const x = -A + surgeW(y) + 0.25 * Math.sin(y / 1.7);
      const p = offset(meta.center, x, y);
      eastEdge.push([p.lng, p.lat]);
    }
    const sw = offset(meta.center, -A, -A);
    const nw = offset(meta.center, -A, A);
    const ring: [number, number][] = [
      [sw.lng, sw.lat],
      ...eastEdge,
      [nw.lng, nw.lat],
      [sw.lng, sw.lat],
    ];
    floods.push({
      id: 'fl-surge',
      ring,
      depthClass: 'deep',
      areaKm2: ringAreaKm2(ring),
      source: 'S1 SAR threshold + surge DEM extrapolation',
      confidence: 0.9,
    });
    // estuary river band
    const { ring: rr, centerline } = ringFromBand(
      (t) => ({
        x: -A + 2 * A * t,
        y: 1.4 + 0.5 * Math.sin(t * Math.PI * 3 + 0.8),
      }),
      () => 0.55 + 0.5 * rng.range(0.8, 1),
      true,
    );
    riverCenterline = centerline;
    floods.push({
      id: 'fl-river',
      ring: rr,
      depthClass: 'moderate',
      areaKm2: ringAreaKm2(rr),
      source: 'S1 SAR threshold + permanent-water mask',
      confidence: 0.91,
    });
  }

  const allFloodRings = floods.map((f) => f.ring);
  const inFlood = (lng: number, lat: number): boolean =>
    allFloodRings.some((r) => pointInRing(lng, lat, r));

  /* ------------------------------------------------------- damage field */
  const epicenter = meta.epicenter
    ? toLatLng(meta.center, {
        x: (meta.epicenter.lng - meta.center.lng) * kmPerDegLng(meta.center.lat),
        y: (meta.epicenter.lat - meta.center.lat) * kmPerDegLat(),
      })
    : null;

  /** local damage intensity g in [0, ~1.2] for a point */
  const damageField = (p: LatLng): number => {
    switch (meta.archetype) {
      case 'hurricane': {
        const lf = meta.landfall!;
        const d = distKm(p, lf);
        let g = meta.severity * Math.exp(-d / 16);
        if (inFlood(p.lng, p.lat)) g *= 1.45;
        return g;
      }
      case 'flood': {
        const d = distToPolyline(p, riverCenterline);
        return 0.35 * meta.severity * Math.exp(-Math.max(0, d - 0.6) / 3.5);
      }
      case 'earthquake': {
        if (!epicenter) return meta.severity * 0.4;
        const d = distKm(p, epicenter);
        const g = meta.severity * Math.exp(-d / 6.2);
        // soft-soil amplification over the reclaimed-fill downtown district
        const soilCenter = toLatLng(meta.center, { x: 1.0, y: 0.5 });
        const soil = 0.5 * Math.exp(-distKm(p, soilCenter) / 2.6);
        return g + soil * 0.55;
      }
    }
  };

  /* -------------------------------------------------------------- buildings */
  const buildings: Building[] = [];
  let bSeq = 0;
  // collapse pockets for the quake archetype
  const pockets: LatLng[] = [];
  if (meta.archetype === 'earthquake' && epicenter) {
    const soilCenter = toLatLng(meta.center, { x: 1.0, y: 0.5 });
    for (let k = 0; k < 3; k++) {
      pockets.push(
        offset(soilCenter, rng.gauss(0, 1.4), rng.gauss(0, 1.4)),
      );
    }
  }

  for (let j = 0; j < lineOffsets.length - 1; j++) {
    for (let i = 0; i < lineOffsets.length - 1; i++) {
      const x0 = lineOffsets[i];
      const x1 = lineOffsets[i + 1];
      const y0 = lineOffsets[j];
      const y1 = lineOffsets[j + 1];
      const bcKm = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
      const bc = toLatLng(meta.center, bcKm);
      // density from the damage-adjacent urban field: use pop-style falloff
      const urban = Math.exp(-distKm(bc, meta.center) / 9) + 0.35;
      const count = Math.round(
        clamp(urban * rng.range(2.2, 5.2), 1, 7),
      );
      const marginKm = 0.055;
      const interiorW = x1 - x0 - 2 * marginKm;
      const interiorH = y1 - y0 - 2 * marginKm;
      const k = Math.ceil(Math.sqrt(count));
      for (let bi = 0; bi < count; bi++) {
        const cx = Math.floor(bi / k);
        const cy = bi % k;
        const cellW = interiorW / k;
        const cellH = interiorH / k;
        const px =
          x0 + marginKm + cellW * (cx + 0.5) + rng.range(-0.18, 0.18) * cellW;
        const py =
          y0 + marginKm + cellH * (cy + 0.5) + rng.range(-0.18, 0.18) * cellH;
        const pos = toLatLng(meta.center, { x: px, y: py });
        const wM = rng.range(16, 46);
        const hM = rng.range(14, 42);
        const rot = rng.bool(0.7)
          ? rng.range(-14, 14)
          : rng.range(30, 60);

        // ---- damage draw
        let g = damageField(pos);
        if (meta.archetype === 'earthquake') {
          for (const pk of pockets) {
            if (distKm(pos, pk) < 0.7) g *= 2.1;
          }
        }
        const r = rng.float();
        let damage: DamageClass = 'none';
        const pDes = 0.16 * g;
        const pMaj = 0.34 * g;
        const pMin = 0.30 * g + 0.03;
        if (r < pDes) damage = 'destroyed';
        else if (r < pDes + pMaj) damage = 'major';
        else if (r < pDes + pMaj + pMin) damage = 'minor';

        // ---- confidence + review flags
        let conf = 0.9 + rng.gauss(0, 0.045);
        let reason: string | null = null;
        const nearFloodEdge = allFloodRings.some((ring) => {
          let dmin = Infinity;
          for (let vi = 0; vi < ring.length; vi += 3) {
            const d = distKm(pos, { lng: ring[vi][0], lat: ring[vi][1] });
            if (d < dmin) dmin = d;
          }
          return dmin < 0.13;
        });
        if (nearFloodEdge) {
          conf -= 0.22;
          reason = 'flood-edge ambiguity';
        }
        if (count >= 6) {
          conf -= 0.09;
          if (!reason && rng.bool(0.35)) reason = 'dense-cluster occlusion';
        }
        if (meta.archetype === 'earthquake' && damage === 'destroyed' && rng.bool(0.3)) {
          conf -= 0.12;
          if (!reason) reason = 'rubble/shadow artifact';
        }
        if (rng.bool(0.05)) {
          conf -= 0.15;
          if (!reason) reason = 'TTA variance 0.28-0.35';
        }
        conf = clamp(conf, 0.42, 0.99);

        buildings.push({
          id: `b-${meta.id}-${bSeq++}`,
          lng: pos.lng,
          lat: pos.lat,
          footprint: rotatedRect(pos, wM, hM, rot),
          damage,
          confidence: conf,
          areaM2: wM * hM,
          zone: '',
          reviewReason: conf < 0.7 ? reason ?? 'low confidence' : null,
          truthCorrect: rng.bool(0.84),
        });
      }
    }
  }

  /* ------------------------------------------------- road blockage pass */
  // spatial hash of destroyed buildings for debris proxies
  const destroyedHash = new Map<string, LatLng[]>();
  const hashKey = (p: LatLng) =>
    `${Math.round(p.lng * 80)},${Math.round(p.lat * 80)}`;
  for (const b of buildings) {
    if (b.damage !== 'destroyed') continue;
    const key = hashKey(b);
    const arr = destroyedHash.get(key) ?? [];
    arr.push(b);
    destroyedHash.set(key, arr);
  }
  const nearDestroyed = (p: LatLng, radiusKm: number): number => {
    let cnt = 0;
    const steps = Math.ceil(radiusKm * 80);
    for (let dx = -steps; dx <= steps; dx++) {
      for (let dy = -steps; dy <= steps; dy++) {
        const key = `${Math.round(p.lng * 80) + dx},${Math.round(p.lat * 80) + dy}`;
        const arr = destroyedHash.get(key);
        if (!arr) continue;
        for (const q of arr) if (distKm(p, q) <= radiusKm) cnt++;
      }
    }
    return cnt;
  };

  for (const rd of roads) {
    const mid = {
      lng: (rd.coords[0][0] + rd.coords[1][0]) / 2,
      lat: (rd.coords[0][1] + rd.coords[1][1]) / 2,
    };
    // flood crossing: sample 5 points along segment
    let floodHit = false;
    for (let s = 0; s <= 4; s++) {
      const t = s / 4;
      const lng = rd.coords[0][0] + (rd.coords[1][0] - rd.coords[0][0]) * t;
      const lat = rd.coords[0][1] + (rd.coords[1][1] - rd.coords[0][1]) * t;
      if (inFlood(lng, lat)) {
        floodHit = true;
        break;
      }
    }
    const debris = nearDestroyed(mid, 0.09);
    if (floodHit && rng.bool(0.86)) {
      rd.blocked = true;
      rd.blockCause = 'flood';
    } else if (debris >= 2 && rng.bool(0.7)) {
      rd.blocked = true;
      rd.blockCause = 'debris';
    }
    if (rd.cls === 'highway' && rd.blocked && rng.bool(0.5)) {
      rd.blocked = false; // elevated viaducts often survive
      rd.blockCause = null;
    }
  }

  /* ------------------------------------------------------------ facilities */
  const facilities: Facility[] = [];
  const arterialNodes: { node: string; p: LatLng }[] = [];
  for (const rd of roads) {
    if (rd.cls === 'local') continue;
    const p = { lng: rd.coords[0][0], lat: rd.coords[0][1] };
    arterialNodes.push({ node: rd.nodes[0], p });
  }
  // shuffle deterministically
  const shuffled = [...arterialNodes];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng.float() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const placed: LatLng[] = [];
  const pickNode = (minSepKm: number): { node: string; p: LatLng } | null => {
    for (const cand of shuffled) {
      if (placed.every((q) => distKm(q, cand.p) > minSepKm)) {
        placed.push(cand.p);
        return cand;
      }
    }
    return null;
  };

  const addFacility = (
    type: Facility['type'],
    name: string,
    minSep: number,
  ) => {
    const spot = pickNode(minSep);
    if (!spot) return;
    // local damage around the facility
    let nDmg = 0;
    let n = 0;
    for (const b of buildings) {
      if (distKm(b, spot.p) < 0.75) {
        n++;
        if (b.damage === 'destroyed') nDmg += 1;
        else if (b.damage === 'major') nDmg += 0.5;
      }
    }
    const frac = n > 0 ? nDmg / n : 0;
    const flooded = inFlood(spot.p.lng, spot.p.lat);
    let status: Facility['status'] = 'operational';
    if (frac > 0.22 || (flooded && rng.bool(0.6))) status = 'offline';
    else if (frac > 0.07 || flooded) status = 'degraded';
    facilities.push({
      id: `fac-${type}-${facilities.length}`,
      type,
      name,
      lng: spot.p.lng,
      lat: spot.p.lat,
      status,
      zone: '',
      preTravelMin: 0,
      postTravelMin: 0,
      isolated: false,
      node: spot.node,
    });
  };

  addFacility('hospital', 'Bayfront Medical Center', 4.2);
  addFacility('hospital', 'Northside Regional Hospital', 4.2);
  addFacility('hospital', 'St. Vincent General', 3.6);
  addFacility('hospital', 'Riverside Clinic Campus', 3.6);
  addFacility('hospital', 'Lakeshore University Hospital', 3.2);
  addFacility('fire_station', 'Fire Station 1 (Central)', 3.5);
  addFacility('fire_station', 'Fire Station 3 (East)', 3.5);
  addFacility('fire_station', 'Fire Station 7 (West)', 3.0);
  addFacility('fire_station', 'Fire Station 9 (North)', 3.0);
  for (let s = 1; s <= 10; s++) addFacility('school', `School ${s}`, 1.1);
  for (let s = 1; s <= 5; s++) addFacility('shelter', `Community Shelter ${s}`, 1.6);
  addFacility('water', 'Water Treatment Plant A', 5);
  addFacility('water', 'Pumping Station B', 4);
  addFacility('water', 'Reservoir & Pumping Station C', 4);
  addFacility('power', 'Substation E-4', 4.5);
  addFacility('power', 'Substation E-9', 4.5);
  addFacility('power', 'Peaker Plant G-2', 5);

  /* --------------------------------------------------------- population */
  const popGrid: PopCell[] = [];
  const cellKm = 0.3;
  const nCells = Math.floor((2 * A) / cellKm);
  const centers: KmPoint[] =
    meta.archetype === 'earthquake'
      ? [
          { x: 1.0, y: 0.5 },
          { x: -2.8, y: -2.4 },
        ]
      : meta.archetype === 'hurricane'
        ? [
            { x: 0.6, y: 0.9 },
            { x: -4.8, y: -2.8 },
          ]
        : [
            { x: 0.6, y: 0.9 },
            { x: -3.6, y: -2.2 },
          ];
  const sigmas = [3.4, 2.2];
  const weights = [0.62, 0.38];
  const dens: { p: LatLng; v: number }[] = [];
  for (let ix = 0; ix < nCells; ix++) {
    for (let iy = 0; iy < nCells; iy++) {
      const gx = -A + cellKm * (ix + 0.5);
      const gy = -A + cellKm * (iy + 0.5);
      let v = 0;
      for (let c = 0; c < centers.length; c++) {
        const d2 =
          (gx - centers[c].x) ** 2 + (gy - centers[c].y) ** 2;
        v += weights[c] * Math.exp(-d2 / (2 * sigmas[c] ** 2));
      }
      v *= rng.range(0.75, 1.25);
      const p = toLatLng(meta.center, { x: gx, y: gy });
      dens.push({ p, v });
    }
  }
  const sum = dens.reduce((acc, d) => acc + d.v, 0);
  for (const d of dens) {
    const pop = (d.v / sum) * meta.population;
    if (pop >= 4) popGrid.push({ lng: d.p.lng, lat: d.p.lat, pop });
  }

  /* ------------------------------------------------------------ pipeline */
  const aoiKm2 = (2 * A) ** 2;
  const tiles = Math.round((aoiKm2 * 1e6) / (1024 * 1024 * 25)); // ~25 m/px demo tile
  const stages: PipelineStage[] = [
    {
      name: 'STAC ingest',
      detail: `${meta.sensors.length} sources · cloud-screened · COG streaming`,
      ms: Math.round(rng.range(220, 380)),
    },
    {
      name: 'Preprocess',
      detail: 'Co-register · RTC gamma0 · speckle Lee 5×5 · tile 1024²',
      ms: Math.round(rng.range(260, 420)),
    },
    {
      name: 'Model inference',
      detail: `Siamese UNet ResNet-50 FP16 · ${tiles} tiles · flood Otsu+U-Net`,
      ms: Math.round(rng.range(300, 480)),
    },
    {
      name: 'Decision layer',
      detail: 'H3 res-8 zoning · need scores · routing isolations',
      ms: Math.round(rng.range(140, 240)),
    },
    {
      name: 'Delivery',
      detail: 'Exports staged · sitrep tool calls · review queue',
      ms: Math.round(rng.range(90, 160)),
    },
  ];

  return {
    meta,
    buildings,
    roads,
    facilities,
    popGrid,
    floods,
    stages,
    totalPop: popGrid.reduce((a, c) => a + c.pop, 0),
  };
}
