/* Golden geospatial determinism test.
 *
 * The procedural generator is the demo fixture factory: its output for a
 * given seed MUST be byte-stable so that demo previews, tests, and committed
 * golden digests stay reproducible. Committed digests live in
 * tests/fixtures/golden-digests.json — regenerate deliberately via:
 *   bun run tests/make-golden.ts
 */

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { EVENTS } from '@/lib/firstlight/events';
import { generateEvent } from '@/lib/firstlight/generate';
import golden from './fixtures/golden-digests.json';

function digest(obj: unknown): string {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

describe('golden determinism — procedural generator', () => {
  for (const meta of EVENTS) {
    test(`${meta.id}: stable SHA-256 digest (seed ${meta.seed})`, () => {
      const raw = generateEvent(meta);
      const recorded = (golden as Record<string, string>)[meta.id];
      expect(recorded).toBeDefined();
      expect(digest(raw)).toBe(recorded);
    });

    test(`${meta.id}: two runs are structurally identical`, () => {
      const a = generateEvent(meta);
      const b = generateEvent(meta);
      expect(digest(a)).toBe(digest(b));
    });
  }

  test('different seeds diverge', () => {
    const a = generateEvent(EVENTS[0]);
    const b = generateEvent(EVENTS[1]);
    expect(digest(a)).not.toBe(digest(b));
  });

  test('invariants: closed rings, positive areas, valid confidences', () => {
    for (const meta of EVENTS) {
      const raw = generateEvent(meta);
      for (const f of raw.floods) {
        expect(f.ring[0]).toEqual(f.ring[f.ring.length - 1]);
        expect(f.areaKm2).toBeGreaterThan(0);
        expect(f.confidence).toBeGreaterThan(0.5);
      }
      for (const b of raw.buildings) {
        expect(b.confidence).toBeGreaterThanOrEqual(0.42);
        expect(b.confidence).toBeLessThanOrEqual(0.99);
        expect(b.footprint[0]).toEqual(b.footprint[b.footprint.length - 1]);
        expect(b.areaM2).toBeGreaterThan(0);
      }
      for (const r of raw.roads) {
        expect(r.lengthKm).toBeGreaterThan(0);
        expect(r.speedKmh).toBeGreaterThan(0);
        expect(r.confidence).toBeGreaterThan(0.9);
      }
      // population grid sums to the declared event population (±rounding)
      const sum = raw.popGrid.reduce((s, c) => s + c.pop, 0);
      expect(Math.abs(sum - meta.population)).toBeLessThan(meta.population * 0.35);
    }
  });
});
