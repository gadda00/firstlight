/* Unit tests — decision layer (H3 zoning, need scores, review overrides). */

import { describe, expect, test } from 'bun:test';
import { EVENTS } from '@/lib/firstlight/events';
import { DemoScenarioProvider } from '@/lib/firstlight/demo-provider';
import {
  DEFAULT_WEIGHTS,
  computeDecision,
  scoreZones,
  dispatchOrigins,
} from '@/lib/firstlight/decision';
import { generateEvent } from '@/lib/firstlight/generate';
import type { ReviewOverrides } from '@/lib/firstlight/types';

function overrides(): ReviewOverrides {
  return {
    decisions: new Map(),
    newClasses: new Map(),
  };
}

const meta = EVENTS[1]; // Cedar River Flood — deterministic, seeded
const raw = generateEvent(meta);
const decision = computeDecision(raw, DEFAULT_WEIGHTS, {
  decisions: new Map(),
  newClasses: new Map(),
});

describe('computeDecision', () => {

  test('every building is assigned to a zone and counted exactly once', () => {
    const sumB = decision.zones.reduce((s, z) => s + z.buildings, 0);
    expect(sumB).toBe(raw.buildings.length);
    for (const b of raw.buildings) expect(b.zone).toBeTruthy();
  });

  test('population totals are conserved across zones', () => {
    const sumPop = decision.zones.reduce((s, z) => s + z.population, 0);
    expect(Math.abs(sumPop - raw.totalPop)).toBeLessThan(1);
  });

  test('floodShare ∈ [0,1] and affectedPop never exceeds population', () => {
    for (const z of decision.zones) {
      expect(z.floodShare).toBeGreaterThanOrEqual(0);
      expect(z.floodShare).toBeLessThanOrEqual(1);
      expect(z.affectedPop).toBeLessThanOrEqual(z.population);
    }
  });

  test('ranks are a unique 1..n permutation sorted by need', () => {
    const ranks = decision.zones.map((z) => z.rank).sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: decision.zones.length }, (_, i) => i + 1));
    const sorted = [...decision.zones].sort((a, b) => a.rank - b.rank);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1].need).toBeGreaterThanOrEqual(sorted[i].need);
    }
  });

  test('stats aggregate the zones consistently', () => {
    expect(decision.stats.totalBuildings).toBe(raw.buildings.length);
    expect(decision.stats.destroyed).toBe(
      decision.zones.reduce((s, z) => s + z.destroyed, 0),
    );
    expect(decision.stats.floodedAreaKm2).toBeCloseTo(
      raw.floods.reduce((s, f) => s + f.areaKm2, 0),
      6,
    );
  });

  test('weight scaling is invariant (weights are normalized)', () => {
    const doubled = computeDecision(
      raw,
      { w1: 0.7, w2: 0.5, w3: 0.5, w4: 0.3 },
      overrides(),
    );
    for (const z of doubled.zones) {
      const base = decision.zoneIndex.get(z.id)!;
      expect(z.need).toBeCloseTo(base.need, 6);
      expect(z.rank).toBe(base.rank);
    }
  });

  test('review rejection removes a destroyed building from the damage counts', () => {
    const destroyed = raw.buildings.find((b) => b.damage === 'destroyed');
    expect(destroyed).toBeDefined();
    const ov = overrides();
    ov.decisions.set(destroyed!.id, 'rejected');
    const after = computeDecision(raw, DEFAULT_WEIGHTS, ov);
    expect(after.stats.destroyed).toBe(decision.stats.destroyed - 1);
    expect(after.stats.totalBuildings).toBe(decision.stats.totalBuildings); // still assessed
  });

  test('reclassification changes the class mix', () => {
    const target = raw.buildings.find((b) => b.damage === 'major');
    const ov = overrides();
    ov.decisions.set(target!.id, 'reclassified');
    ov.newClasses.set(target!.id, 'minor');
    const after = computeDecision(raw, DEFAULT_WEIGHTS, ov);
    expect(after.stats.major).toBe(decision.stats.major - 1);
    expect(after.stats.minor).toBe(decision.stats.minor + 1);
  });

  test('pending review counts unresolved flagged detections', () => {
    const flagged = raw.buildings.filter((b) => b.reviewReason).length;
    expect(decision.stats.pendingReview).toBe(flagged);
  });

  test('dispatch origins are fire stations', () => {
    const origins = dispatchOrigins(raw.facilities);
    expect(origins.length).toBeGreaterThan(0);
    expect(origins.every((f) => f.type === 'fire_station')).toBe(true);
  });
});

describe('scoreZones — tier thresholds and degenerate inputs', () => {
  test('need >= 0.58 → warning, >= 0.38 → watch, else informational', () => {
    const zones = decision.zones.map((z) => ({ ...z }));
    const high = zones[0];
    high.D = 1; high.Pexp = 1; high.Iso = 1; high.Crit = 1;
    scoreZones(zones, DEFAULT_WEIGHTS);
    expect(high.tier).toBe('warning');
    for (const z of zones) {
      expect(['warning', 'watch', 'informational']).toContain(z.tier);
    }
  });

  test('uniform zero weights fall back safely (no NaN)', () => {
    const zones = decision.zones.map((z) => ({ ...z }));
    scoreZones(zones, { w1: 0, w2: 0, w3: 0, w4: 0 });
    for (const z of zones) {
      expect(Number.isFinite(z.need)).toBe(true);
      expect(z.need).toBe(0);
    }
  });
});

describe('DemoScenarioProvider', () => {
  test('stamps demo provenance in demo mode', () => {
    const raw = DemoScenarioProvider.generate(meta);
    expect(raw.demo).toBeDefined();
    expect(raw.demo!.simulated).toBe(true);
    expect(raw.demo!.seed).toBe(meta.seed);
    expect(raw.demo!.provider).toBe('demo-scenario-provider');
  });

  test('refuses to run in operational mode without explicit opt-in', () => {
    const prev = process.env.NEXT_PUBLIC_DEMO_MODE;
    process.env.NEXT_PUBLIC_DEMO_MODE = 'false';
    try {
      expect(() => DemoScenarioProvider.generate(meta)).toThrow();
      const raw = DemoScenarioProvider.generate(meta, {
        allowInOperationalMode: true,
      });
      expect(raw.demo?.simulated).toBe(true); // still labeled
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
      else process.env.NEXT_PUBLIC_DEMO_MODE = prev;
    }
  });
});
