/* ==========================================================================
 * FirstLight — scoring v2 (Phase 3).
 *
 * Productionizes the transparent need score while keeping it explainable:
 *
 *  - VERSIONED MANIFEST: every weight set, normalization, exposure method,
 *    coefficient, threshold and penalty is a machine-readable ScoreManifest
 *    (SCORING_METHOD.md documents it; exports embed it).
 *  - AREA-WEIGHTED FLOOD SHARE: floodShareArea is a true polygon∩hexagon
 *    area ratio (clip.ts) — the old boundary-point sampler remains only as
 *    the compat field `floodShare`.
 *  - UNCERTAINTY: need bounds (needLower/needUpper) propagate detection
 *    confidence and population-estimate assumptions through the weighted
 *    sum; rankings carry "rankingUnstable" flags.
 *  - SENSITIVITY: one-at-a-time ±25% weight perturbations measure how much
 *    each zone's rank moves — surfaced so operators see fragile orderings.
 *  - MISSINGNESS: dataQuality per zone (detection confidence, population
 *    availability, routability); sparse zones are penalized AND flagged
 *    `insufficient_evidence` instead of silently looking like low impact.
 *  - NORMALIZATION: 'max' (legacy) or 'p90robust' (outlier-resistant).
 *
 * The exposure method for "affected population" remains a LABELED,
 * UNCALIBRATED pilot heuristic (coefficients visible in the manifest) until
 * the dasymetric raster workflow lands — never presented as a measurement.
 * ========================================================================== */

import type { NeedWeights, Zone } from './types';

export const SCORING_VERSION = 'need-score-v2';

export interface ScoreManifest {
  version: string;
  weights: NeedWeights;
  normalization: 'max' | 'p90robust';
  exposureMethod: 'heuristic-weighted-overlay-v1' | 'heuristic-weighted-overlay-v2-area';
  exposureCoefficients: { damage: number; flood: number };
  missingPenalty: number;
  tierThresholds: { warning: number; watch: number };
  insufficientEvidence: { maxDataQuality: number };
  uncertaintyMethod: 'confidence-propagation-v1';
  sensitivityMethod: 'weight-perturbation-oat-25-v1';
  /** Assumed relative uncertainty of gridded population estimates. */
  populationUncertainty: number;
}

export const DEFAULT_SCORE_MANIFEST: ScoreManifest = {
  version: SCORING_VERSION,
  weights: { w1: 0.35, w2: 0.25, w3: 0.25, w4: 0.15 },
  normalization: 'max',
  exposureMethod: 'heuristic-weighted-overlay-v2-area',
  exposureCoefficients: { damage: 1.5, flood: 0.75 },
  missingPenalty: 0.25,
  tierThresholds: { warning: 0.58, watch: 0.38 },
  insufficientEvidence: { maxDataQuality: 0.5 },
  uncertaintyMethod: 'confidence-propagation-v1',
  sensitivityMethod: 'weight-perturbation-oat-25-v1',
  populationUncertainty: 0.15,
};

/* ------------------------------------------------------------ normalization */

export function percentile(sortedValues: number[], p: number): number {
  if (!sortedValues.length) return 0;
  const idx = (sortedValues.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  return sortedValues[lo] + (idx - lo) * (sortedValues[hi] - sortedValues[lo]);
}

/** Divisor for a component under the manifest's normalization policy. */
export function normalizationDivisor(
  values: number[],
  method: ScoreManifest['normalization'],
): number {
  if (values.length === 0) return 1;
  if (method === 'p90robust') {
    const p90 = percentile([...values].sort((a, b) => a - b), 0.9);
    return Math.max(1e-9, p90);
  }
  return Math.max(1e-9, Math.max(...values));
}

/* ------------------------------------------------------------ tiers */

export type EvidenceTier = 'sufficient' | 'insufficient';

export function tierFor(
  need: number,
  thresholds: ScoreManifest['tierThresholds'],
): Zone['tier'] {
  if (need >= thresholds.warning) return 'warning';
  if (need >= thresholds.watch) return 'watch';
  return 'informational';
}

/** Evidence check runs BEFORE tier assignment: a zone with too little data
 *  is reported as "not enough evidence" — never forced into a
 *  warning/watch/informational bucket (transformation brief §6). */
export function evidenceTierFor(
  dataQuality: number,
  manifest: ScoreManifest,
): EvidenceTier {
  return dataQuality < manifest.insufficientEvidence.maxDataQuality
    ? 'insufficient'
    : 'sufficient';
}

/* ------------------------------------------------------------ uncertainty */

export interface ComponentBounds {
  D: [number, number];
  Pexp: [number, number];
  Iso: [number, number];
  Crit: [number, number];
}

/** Propagate component bounds through the weighted sum. */
export function needBounds(
  b: ComponentBounds,
  weights: NeedWeights,
): { lower: number; upper: number } {
  const sum = weights.w1 + weights.w2 + weights.w3 + weights.w4 || 1;
  const [dLo, dHi] = b.D;
  const [pLo, pHi] = b.Pexp;
  const [iLo, iHi] = b.Iso;
  const [cLo, cHi] = b.Crit;
  const lower =
    (weights.w1 * dLo + weights.w2 * pLo + weights.w3 * iLo + weights.w4 * cLo) / sum;
  const upper =
    (weights.w1 * dHi + weights.w2 * pHi + weights.w3 * iHi + weights.w4 * cHi) / sum;
  return { lower: Math.max(0, lower), upper: Math.min(1, upper) };
}

/** Detection-confidence-derived bound on the damage ratio. */
export function damageBounds(D: number, meanConfidence: number): [number, number] {
  const slack = (1 - meanConfidence) * 0.5;
  return [Math.max(0, D - slack), Math.min(1, D + slack)];
}

/* ------------------------------------------------------------ sensitivity */

/** One-at-a-time ±25% weight perturbation; returns max rank shift per zone. */
export function sensitivityAnalysis(
  zones: Zone[],
  weights: NeedWeights,
  rescore: (zs: Zone[], w: NeedWeights) => void,
): Map<string, number> {
  const baseRanks = new Map(zones.map((z) => [z.id, z.rank] as const));
  const shifts = new Map<string, number>(zones.map((z) => [z.id, 0] as const));
  const keys: Array<keyof NeedWeights> = ['w1', 'w2', 'w3', 'w4'];
  for (const key of keys) {
    for (const factor of [0.75, 1.25] as const) {
      const perturbed: NeedWeights = { ...weights, [key]: weights[key] * factor };
      const copy = zones.map((z) => ({ ...z }));
      rescore(copy, perturbed);
      copy.forEach((z) => {
        const base = baseRanks.get(z.id) ?? z.rank;
        const shift = Math.abs(z.rank - base);
        if (shift > (shifts.get(z.id) ?? 0)) shifts.set(z.id, shift);
      });
    }
  }
  return shifts;
}

/** Canonical, JSON-embeddable manifest for exports and sitreps. */
export function manifestForExport(m: ScoreManifest) {
  return {
    ...m,
    formula:
      'need(z) = [w1·D + w2·Pexp + w3·Iso + w4·Crit] / Σw · (1 − missingPenalty·missingness)',
    exposureFormula:
      m.exposureMethod === 'heuristic-weighted-overlay-v1'
        ? 'affectedPop = round(pop · clamp(damage·D + flood·floodShare_pointSampled))  [LEGACY point sampler]'
        : 'affectedPop = round(pop · clamp(damage·D + flood·floodShareArea))  [area-weighted]',
    calibration:
      'UNCALIBRATED pilot heuristic — coefficients are visible defaults, not fitted values. Raster exposure workflow pending (see SCORING_METHOD.md).',
  };
}
