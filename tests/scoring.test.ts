/* Unit tests — scoring v2 (manifest, normalization, uncertainty, evidence). */

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_SCORE_MANIFEST,
  percentile,
  normalizationDivisor,
  damageBounds,
  needBounds,
  tierFor,
  evidenceTierFor,
  sensitivityAnalysis,
  manifestForExport,
} from '@/lib/firstlight/scoring';
import { computeDecision, DEFAULT_WEIGHTS, scoreZones } from '@/lib/firstlight/decision';
import { EVENTS } from '@/lib/firstlight/events';
import { generateEvent } from '@/lib/firstlight/generate';
import type { Zone } from '@/lib/firstlight/types';

const meta = EVENTS[1];
const raw = generateEvent(meta);
const decision = computeDecision(raw, DEFAULT_WEIGHTS, {
  decisions: new Map(),
  newClasses: new Map(),
});

describe('ScoreManifest', () => {
  test('defaults are pinned and versioned', () => {
    expect(DEFAULT_SCORE_MANIFEST.version).toBe('need-score-v2');
    expect(DEFAULT_SCORE_MANIFEST.exposureMethod).toBe('heuristic-weighted-overlay-v2-area');
    expect(DEFAULT_SCORE_MANIFEST.exposureCoefficients).toEqual({ damage: 1.5, flood: 0.75 });
    expect(DEFAULT_SCORE_MANIFEST.tierThresholds).toEqual({ warning: 0.58, watch: 0.38 });
    expect(DEFAULT_SCORE_MANIFEST.missingPenalty).toBeGreaterThan(0);
  });

  test('manifestForExport exposes the formula + calibration honesty note', () => {
    const m = manifestForExport(DEFAULT_SCORE_MANIFEST);
    expect(m.formula).toContain('missingPenalty');
    expect(m.exposureFormula).toContain('area-weighted');
    expect(String(m.calibration)).toContain('UNCALIBRATED');
  });
});

describe('normalization', () => {
  test('percentile interpolates correctly', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([], 0.9)).toBe(0);
  });

  test('max divisor = max; p90robust resists outliers', () => {
    const values = [1, 2, 3, 4, 5, 100];
    expect(normalizationDivisor(values, 'max')).toBe(100);
    const p90 = normalizationDivisor(values, 'p90robust');
    expect(p90).toBeGreaterThan(4);
    expect(p90).toBeLessThan(100);
  });

  test('p90robust normalization yields different (less outlier-dominated) Pexp', () => {
    const d2 = computeDecision(
      raw,
      DEFAULT_WEIGHTS,
      { decisions: new Map(), newClasses: new Map() },
      { ...DEFAULT_SCORE_MANIFEST, normalization: 'p90robust' },
    );
    // At least one zone's Pexp must differ from the 'max' variant
    const diffs = d2.zones.filter((z) => {
      const base = decision.zoneIndex.get(z.id)!;
      return Math.abs(z.Pexp - base.Pexp) > 1e-9;
    });
    expect(diffs.length).toBeGreaterThan(0);
  });
});

describe('uncertainty', () => {
  test('damageBounds widen as confidence drops', () => {
    const tight = damageBounds(0.5, 0.99);
    const loose = damageBounds(0.5, 0.5);
    expect(tight[1] - tight[0]).toBeLessThan(loose[1] - loose[0]);
    expect(loose[1]).toBeLessThanOrEqual(1);
    expect(loose[0]).toBeGreaterThanOrEqual(0);
  });

  test('needBounds contain the point estimate for every real zone', () => {
    for (const z of decision.zones) {
      expect(z.needLower).toBeLessThanOrEqual(z.need + 1e-9);
      expect(z.needUpper).toBeGreaterThanOrEqual(z.need - 1e-9);
      expect(z.needLower).toBeGreaterThanOrEqual(0);
      expect(z.needUpper).toBeLessThanOrEqual(1);
    }
  });

  test('bounds are wider for low-confidence zones', () => {
    const byConf = [...decision.zones].sort((a, b) => a.meanConfidence - b.meanConfidence);
    const lowConf = byConf[0];
    const highConf = byConf[byConf.length - 1];
    expect(lowConf.needUpper - lowConf.needLower).toBeGreaterThanOrEqual(
      highConf.needUpper - highConf.needLower,
    );
  });
});

describe('missingness & evidence tier', () => {
  test('dataQuality ∈ [0,1] and missingness is its complement', () => {
    for (const z of decision.zones) {
      expect(z.dataQuality).toBeGreaterThanOrEqual(0);
      expect(z.dataQuality).toBeLessThanOrEqual(1);
      expect(Math.abs(z.missingness - (1 - z.dataQuality))).toBeLessThan(1e-9);
    }
  });

  test('zones with almost no data are flagged insufficient_evidence', () => {
    // Synthesize an empty zone: no buildings, no population, unroutable.
    const emptyZone: Zone = {
      ...decision.zones[0],
      id: 'empty-zone-test',
      buildings: 0,
      population: 0,
      meanConfidence: 0.5,
      dataQuality: 0.2,
      missingness: 0.8,
    };
    const zones = [...decision.zones, emptyZone];
    scoreZones(zones, DEFAULT_WEIGHTS);
    expect(emptyZone.tier).toBe('insufficient_evidence');
    expect(emptyZone.evidenceTier).toBe('insufficient');
  });

  test('evidenceTierFor threshold logic', () => {
    expect(evidenceTierFor(0.49, DEFAULT_SCORE_MANIFEST)).toBe('insufficient');
    expect(evidenceTierFor(0.51, DEFAULT_SCORE_MANIFEST)).toBe('sufficient');
  });

  test('missingness penalty lowers need for sparse zones', () => {
    const rich = decision.zones.reduce((a, b) => (a.dataQuality > b.dataQuality ? a : b));
    const poor = decision.zones.reduce((a, b) => (a.dataQuality < b.dataQuality ? a : b));
    // Equal components but different data quality → penalized score is lower
    const mk = (z: Zone, dq: number): Zone => ({
      ...z,
      D: 0.5,
      Pexp: 0.5,
      Iso: 0,
      Crit: 0,
      dataQuality: dq,
      missingness: 1 - dq,
    });
    const pair = [mk(rich, 0.95), mk(poor, 0.3)];
    scoreZones(pair, DEFAULT_WEIGHTS);
    expect(pair[0].need).toBeGreaterThan(pair[1].need);
  });
});

describe('sensitivity analysis', () => {
  test('OAT ±25% perturbation returns a shift for every zone', () => {
    const zones = decision.zones.map((z) => ({ ...z }));
    const shifts = sensitivityAnalysis(zones, DEFAULT_WEIGHTS, (zs, w) =>
      scoreZones(zs, w),
    );
    for (const z of zones) {
      expect(shifts.has(z.id)).toBe(true);
      expect(shifts.get(z.id)!).toBeGreaterThanOrEqual(0);
    }
  });

  test('rankingUnstable flags zones that move ≥ 2 positions', () => {
    // Sensitivity field is populated by computeDecision
    expect(decision.zones.every((z) => z.sensitivity >= 0)).toBe(true);
    const unstable = decision.zones.filter((z) => z.rankingUnstable);
    for (const z of unstable) expect(z.sensitivity).toBeGreaterThanOrEqual(2);
  });
});

describe('area-weighted flood share', () => {
  test('floodShareArea ∈ [0,1] and computed for all zones', () => {
    for (const z of decision.zones) {
      expect(z.floodShareArea).toBeGreaterThanOrEqual(0);
      expect(z.floodShareArea).toBeLessThanOrEqual(1);
    }
  });

  test('area-weighted share differs from the legacy point sampler', () => {
    const diffs = decision.zones.filter(
      (z) => Math.abs(z.floodShareArea - z.floodShare) > 0.01,
    );
    // For the Cedar River event with a meandering flood band, the point
    // sampler's bias must show up in at least a few zones.
    expect(diffs.length).toBeGreaterThan(0);
  });

  test('exposureMethod label is stamped on every zone', () => {
    for (const z of decision.zones) {
      expect(z.exposureMethod).toBe('heuristic-weighted-overlay-v2-area');
    }
  });
});

describe('tier thresholds', () => {
  test('boundaries honor the manifest thresholds', () => {
    expect(tierFor(0.58, DEFAULT_SCORE_MANIFEST.tierThresholds)).toBe('warning');
    expect(tierFor(0.579, DEFAULT_SCORE_MANIFEST.tierThresholds)).toBe('watch');
    expect(tierFor(0.38, DEFAULT_SCORE_MANIFEST.tierThresholds)).toBe('watch');
    expect(tierFor(0.379, DEFAULT_SCORE_MANIFEST.tierThresholds)).toBe('informational');
  });
});
