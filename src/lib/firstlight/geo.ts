/* Lightweight geometry helpers (degrees-based, sufficient for demo scale). */

import type { LatLng } from './types';

const R_EARTH_KM = 6371.0088;

export function kmPerDegLat(): number {
  return 111.32;
}

export function kmPerDegLng(lat: number): number {
  return Math.max(1e-6, 111.32 * Math.cos((lat * Math.PI) / 180));
}

/** Offset a lat/lng by dx/dy in km. */
export function offset(p: LatLng, dxKm: number, dyKm: number): LatLng {
  return {
    lat: p.lat + dyKm / kmPerDegLat(),
    lng: p.lng + dxKm / kmPerDegLng(p.lat),
  };
}

/** Haversine distance in km. */
export function distKm(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la = (a.lat * Math.PI) / 180;
  const lb = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ray-casting point-in-polygon. Ring: [lng,lat][] (closed or open). */
export function pointInRing(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Shoelace area of a ring in km² (small-area planar approximation). */
export function ringAreaKm2(ring: [number, number][]): number {
  if (ring.length < 3) return 0;
  const lat0 = ring[0][1];
  const kx = kmPerDegLng(lat0);
  const ky = kmPerDegLat();
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const x1 = ring[j][0] * kx;
    const y1 = ring[j][1] * ky;
    const x2 = ring[i][0] * kx;
    const y2 = ring[i][1] * ky;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
}

export function centroidOfRing(ring: [number, number][]): LatLng {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
  }
  return { lng: sx / ring.length, lat: sy / ring.length };
}

/** Sample n points inside a ring (bbox-jitter rejection). */
export function sampleInRing(
  ring: [number, number][],
  n: number,
  rand: () => number,
): LatLng[] {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [x, y] of ring) {
    minLng = Math.min(minLng, x);
    maxLng = Math.max(maxLng, x);
    minLat = Math.min(minLat, y);
    maxLat = Math.max(maxLat, y);
  }
  const pts: LatLng[] = [];
  let guard = 0;
  while (pts.length < n && guard < n * 40) {
    guard++;
    const lng = minLng + rand() * (maxLng - minLng);
    const lat = minLat + rand() * (maxLat - minLat);
    if (pointInRing(lng, lat, ring)) pts.push({ lng, lat });
  }
  return pts;
}

/** Rotate a closed rect footprint (meters) around its center. Returns [lng,lat][] ring. */
export function rotatedRect(
  center: LatLng,
  wM: number,
  hM: number,
  rotDeg: number,
): [number, number][] {
  const rad = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners: [number, number][] = ([
    [-wM / 2, -hM / 2],
    [wM / 2, -hM / 2],
    [wM / 2, hM / 2],
    [-wM / 2, hM / 2],
  ] as [number, number][]).map(([ex, ey]) => {
    const rx = ex * cos - ey * sin; // east offset (m)
    const ry = ex * sin + ey * cos; // north offset (m)
    return [
      center.lng + rx / 1000 / kmPerDegLng(center.lat),
      center.lat + ry / 1000 / kmPerDegLat(),
    ];
  });
  corners.push(corners[0]);
  return corners;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function fmtPct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}
