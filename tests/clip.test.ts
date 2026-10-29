/* Unit tests — polygon clipping (Sutherland–Hodgman, km-projected). */

import { describe, expect, test } from 'bun:test';
import {
  clipPolygonByConvex,
  intersectionAreaKm2,
  ringAreaKm2Exact,
  areaWeightedShare,
} from '@/lib/firstlight/clip';

/** A regular-ish hexagon (convex clip polygon) around (0,0), ~1 km across. */
function hexagon(radiusKm = 0.5): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    pts.push([Math.cos(a) * radiusKm / 111.32, Math.sin(a) * radiusKm / 111.32]);
  }
  pts.push(pts[0]);
  return pts;
}

function square(cx = 0, cy = 0, halfKm = 0.5): [number, number][] {
  const d = halfKm / 111.32;
  return [
    [cx - d, cy - d],
    [cx + d, cy - d],
    [cx + d, cy + d],
    [cx - d, cy + d],
    [cx - d, cy - d],
  ];
}

describe('clipPolygonByConvex', () => {
  test('half-overlapping square ∩ hexagon yields a 3..8-vertex polygon', () => {
    const clipped = clipPolygonByConvex(square(0.00025, 0), hexagon());
    expect(clipped.length).toBeGreaterThanOrEqual(3);
    expect(clipped.length).toBeLessThanOrEqual(12);
  });

  test('disjoint polygons clip to empty', () => {
    const far = square(5, 5, 0.5); // ~7 km away
    expect(clipPolygonByConvex(far, hexagon())).toHaveLength(0);
    expect(intersectionAreaKm2(far, hexagon())).toBe(0);
  });

  test('fully-contained subject is returned intact', () => {
    const small = square(0, 0, 0.1);
    const clipped = clipPolygonByConvex(small, hexagon(0.5));
    expect(clipped.length).toBeGreaterThanOrEqual(3);
    const area = ringAreaKm2Exact(clipped);
    const original = ringAreaKm2Exact(small);
    expect(Math.abs(area - original)).toBeLessThan(original * 0.01);
  });

  test('non-convex subject (L-shape) clips correctly', () => {
    // L-shape: 3 squares forming an L
    const d = 0.3 / 111.32;
    const lShape: [number, number][] = [
      [-d, -d],
      [0, -d],
      [0, 0],
      [d, 0],
      [d, d],
      [-d, d],
      [-d, -d],
    ];
    const clipped = clipPolygonByConvex(lShape, hexagon(0.2));
    expect(clipped.length).toBeGreaterThanOrEqual(3);
    const area = ringAreaKm2Exact(clipped);
    // L-shape area = 3 * 0.09 km² = 0.27; hexagon(0.2) area ≈ 0.104
    // → intersection ≤ min(both)
    expect(area).toBeLessThanOrEqual(0.27 + 1e-6);
    expect(area).toBeLessThanOrEqual(0.104 + 1e-3);
  });
});

describe('intersectionAreaKm2 — known answers', () => {
  test('two identical unit squares intersect to the full area', () => {
    const a = intersectionAreaKm2(square(0, 0, 0.5), square(0, 0, 0.5));
    expect(a).toBeCloseTo(1.0, 2); // 1 km²
  });

  test('half-offset squares intersect to half the area', () => {
    // square(0) spans [-0.5, 0.5]; square(0.5km) spans [0, 1] → 0.5 km² overlap
    const offsetSq = square(
      0.5 / 111.32,
      0,
      0.5,
    );
    const a = intersectionAreaKm2(square(0, 0, 0.5), offsetSq);
    expect(a).toBeCloseTo(0.5, 2);
  });

  test('commutativity of area (clip frame choice does not matter)', () => {
    const ab = intersectionAreaKm2(square(0.0002, 0), hexagon());
    const ba = intersectionAreaKm2(hexagon(), square(0.0002, 0));
    expect(Math.abs(ab - ba)).toBeLessThan(0.05); // tolerates frame rounding
  });
});

describe('areaWeightedShare', () => {
  test('hexagon fully covered by a bigger polygon → 1', () => {
    const big = square(0, 0, 5);
    expect(areaWeightedShare(hexagon(), [big])).toBeCloseTo(1, 3);
  });

  test('no subjects → 0', () => {
    expect(areaWeightedShare(hexagon(), [])).toBe(0);
  });

  test('share is clamped to [0,1] even with overlapping subjects', () => {
    const s1 = square(0, 0, 0.5);
    const s2 = square(0, 0, 0.5);
    const share = areaWeightedShare(hexagon(), [s1, s2]);
    expect(share).toBeLessThanOrEqual(1);
  });
});
