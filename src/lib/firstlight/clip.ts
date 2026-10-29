/* ==========================================================================
 * FirstLight — polygon clipping (Phase 3, scoring v2).
 *
 * Sutherland–Hodgman polygon clipping: clips an ARBITRARY subject polygon
 * (flood ring — may be non-convex) against a CONVEX clip polygon (an H3
 * hexagon boundary is always convex). This replaces the old flood-share
 * estimate that sampled only boundary points + centroid (a biased point
 * sampler) with a true area-weighted intersection.
 *
 * Computation happens in a local km-projected frame (planar approximation,
 * consistent with geo.ts conventions) so areas come out in km².
 * ========================================================================== */

import { kmPerDegLat, kmPerDegLng } from './geo';

export type Pt = [number, number]; // [lng, lat]

function toKmFrame(ring: Pt[], origin: Pt): Array<[number, number]> {
  const kx = kmPerDegLng(origin[1]);
  const ky = kmPerDegLat();
  return ring.map(([lng, lat]) => [(lng - origin[0]) * kx, (lat - origin[1]) * ky]);
}

function signedArea(poly: Array<[number, number]>): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return s / 2;
}

function clipEdge(
  poly: Array<[number, number]>,
  a: [number, number],
  b: [number, number],
  keepLeft: boolean,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const side = (p: [number, number]) => {
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    return keepLeft ? cross : -cross;
  };
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const curIn = side(cur) >= 0;
    const prevIn = side(prev) >= 0;
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur, a, b));
      out.push(cur);
    } else if (prevIn) {
      out.push(intersect(prev, cur, a, b));
    }
  }
  return out;
}

function intersect(
  p1: [number, number],
  p2: [number, number],
  a: [number, number],
  b: [number, number],
): [number, number] {
  const d1: [number, number] = [p2[0] - p1[0], p2[1] - p1[1]];
  const d2: [number, number] = [b[0] - a[0], b[1] - a[1]];
  const denom = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(denom) < 1e-12) return p2;
  const t =
    ((a[0] - p1[0]) * d2[1] - (a[1] - p1[1]) * d2[0]) / denom;
  return [p1[0] + t * d1[0], p1[1] + t * d1[1]];
}

/** Clip `subject` by convex `clip` (both closed or open rings, [lng,lat][]).
 *  Returns the intersection polygon in the SAME lng/lat frame. */
export function clipPolygonByConvex(subject: Pt[], clip: Pt[]): Pt[] {
  const origin: Pt = clip[0] ?? subject[0];
  const sub = dedupeClosed(toKmFrame(subject, origin));
  const clp = dedupeClosed(toKmFrame(clip, origin));
  if (sub.length < 3 || clp.length < 3) return [];
  // Sutherland–Hodgman assumes a consistently oriented clip polygon.
  const keepLeft = signedArea(clp) > 0;
  let poly = sub;
  for (let i = 0; i < clp.length && poly.length >= 3; i++) {
    const a = clp[i];
    const b = clp[(i + 1) % clp.length];
    poly = clipEdge(poly, a, b, keepLeft);
  }
  // Project back to lng/lat.
  const kx = kmPerDegLng(origin[1]);
  const ky = kmPerDegLat();
  return poly.map(([x, y]) => [origin[0] + x / kx, origin[1] + y / ky] as Pt);
}

function dedupeClosed(poly: Array<[number, number]>): Array<[number, number]> {
  const out = [...poly];
  while (
    out.length > 1 &&
    Math.abs(out[0][0] - out[out.length - 1][0]) < 1e-12 &&
    Math.abs(out[0][1] - out[out.length - 1][1]) < 1e-12
  ) {
    out.pop();
  }
  return out;
}

/** Area of the intersection of subject and a CONVEX clip ring, in km². */
export function intersectionAreaKm2(subject: Pt[], clip: Pt[]): number {
  const origin: Pt = clip[0] ?? subject[0];
  const clippedKm = toKmFrame(
    clipPolygonByConvex(subject, clip),
    origin,
  );
  if (clippedKm.length < 3) return 0;
  return Math.abs(signedArea(clippedKm));
}

/** Area of a ring in km² (absolute shoelace, km-projected). */
export function ringAreaKm2Exact(ring: Pt[]): number {
  if (ring.length < 3) return 0;
  const origin: Pt = ring[0];
  const km = dedupeClosed(toKmFrame(ring, origin));
  if (km.length < 3) return 0;
  return Math.abs(signedArea(km));
}

/** Area-weighted share of `clip` (e.g. an H3 hexagon) covered by any of the
 *  `subjects` (e.g. flood rings). Overlap between subjects is not double
 *  counted beyond the clamp — document as a conservative upper bound. */
export function areaWeightedShare(
  clip: Pt[],
  subjects: Pt[][],
): number {
  const clipArea = ringAreaKm2Exact(clip);
  if (clipArea <= 0) return 0;
  let covered = 0;
  for (const s of subjects) {
    covered += intersectionAreaKm2(s, clip);
  }
  return Math.max(0, Math.min(1, covered / clipArea));
}
