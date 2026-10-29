/* Unit tests — geometry helpers (Phase 0 baseline fixtures).
 * Known-answer tests with documented tolerances; coordinates are small-area
 * planar approximations by design (see geo.ts header). */

import { describe, expect, test } from 'bun:test';
import {
  distKm,
  offset,
  pointInRing,
  ringAreaKm2,
  centroidOfRing,
  rotatedRect,
  clamp,
  sampleInRing,
} from '@/lib/firstlight/geo';

describe('geo — distance & offset', () => {
  test('haversine: ~111.32 km per degree of latitude', () => {
    const d = distKm({ lat: 0, lng: 10 }, { lat: 1, lng: 10 });
    expect(Math.abs(d - 111.32)).toBeLessThan(0.5);
  });

  test('haversine: equator longitude shrinks with cos(lat)', () => {
    const d60 = distKm({ lat: 60, lng: 0 }, { lat: 60, lng: 1 });
    const d0 = distKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    // cos(60°) = 0.5 → distance at 60N should be ~half the equatorial value
    expect(Math.abs(d60 / d0 - 0.5)).toBeLessThan(0.02);
  });

  test('offset moves the point by the requested km distance', () => {
    const p = { lat: 41.977, lng: -91.665 };
    const q = offset(p, 3.5, -2.25);
    const expected = Math.sqrt(3.5 * 3.5 + 2.25 * 2.25); // 4.161 km
    expect(Math.abs(distKm(p, q) - expected)).toBeLessThan(0.01);
  });
});

describe('geo — polygon primitives', () => {
  const square: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ];

  test('pointInRing: inside / outside / edge-behavior consistent', () => {
    expect(pointInRing(0.5, 0.5, square)).toBe(true);
    expect(pointInRing(1.5, 0.5, square)).toBe(false);
    expect(pointInRing(-0.1, -0.1, square)).toBe(false);
  });

  test('pointInRing works on open rings (unclosed)', () => {
    const open: [number, number][] = square.slice(0, 4);
    expect(pointInRing(0.25, 0.75, open)).toBe(true);
  });

  test('ringAreaKm2: 1° square at the equator ≈ 12,360 km²', () => {
    const a = ringAreaKm2(square);
    // 111.32² ≈ 12,392 km² — planar approximation tolerance
    expect(Math.abs(a - 111.32 * 111.32)).toBeLessThan(120);
  });

  test('centroidOfRing is the vertex mean', () => {
    const c = centroidOfRing(square);
    expect(c.lng).toBeCloseTo(0.4, 5); // (0+1+1+0+0)/5
    expect(c.lat).toBeCloseTo(0.4, 5); // (0+0+1+1+0)/5
  });

  test('rotatedRect returns a closed 5-point ring', () => {
    const ring = rotatedRect({ lat: 10, lng: 10 }, 40, 20, 33);
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    // 40 m × 20 m → 800 m² footprint; ring area in km² ≈ 0.0008
    const areaKm2 = ringAreaKm2(ring);
    expect(Math.abs(areaKm2 - 0.0008)).toBeLessThan(1e-4);
  });

  test('sampleInRing only returns interior points', () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const pts = sampleInRing(square, 50, rand);
    expect(pts.length).toBe(50);
    for (const p of pts) {
      expect(pointInRing(p.lng, p.lat, square)).toBe(true);
    }
  });

  test('clamp bounds', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});
