/* Unit tests — grounded sitrep engine (tool-call citations, determinism). */

import { describe, expect, test } from 'bun:test';
import { EVENTS } from '@/lib/firstlight/events';
import { generateEvent } from '@/lib/firstlight/generate';
import { computeDecision, DEFAULT_WEIGHTS } from '@/lib/firstlight/decision';
import { generateSitrep } from '@/lib/firstlight/sitrep';
import { fnv1a } from '@/lib/firstlight/rng';

const meta = EVENTS[1];
const raw = generateEvent(meta);
const decision = computeDecision(raw, DEFAULT_WEIGHTS, {
  decisions: new Map(),
  newClasses: new Map(),
});

function makeCtx() {
  return {
    raw,
    decision,
    overrides: { decisions: new Map(), newClasses: new Map() },
    generatedAt: new Date('2025-06-18T09:00:00Z'),
    runId: 'run-test01',
  };
}

describe('generateSitrep', () => {
  const ctx = makeCtx();
  const sitrep = generateSitrep(ctx);

  test('markdown header carries synthetic-exercise classification, scenario, run id, approval state', () => {
    expect(sitrep.markdown).toContain('SYNTHETIC EXERCISE REPORT');
    expect(sitrep.markdown).toContain('SIMULATED EXERCISE — GENERATED SCENARIO DATA');
    expect(sitrep.markdown).toContain('generated fiction');
    expect(sitrep.markdown).toContain(meta.location);
    expect(sitrep.markdown).toContain(`seed ${meta.seed}`);
    expect(sitrep.markdown).toContain('run-test01');
    expect(sitrep.markdown).toContain('PENDING');
  });

  test('every numeric claim is bound to a logged tool call with a hash', () => {
    expect(sitrep.toolCalls.length).toBeGreaterThanOrEqual(7);
    expect(sitrep.assertions.length).toBe(sitrep.toolCalls.length);
    for (const a of sitrep.assertions) {
      expect(a.hash).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  test('assertion hashes are verifiable FNV-1a of tool:params:result', () => {
    sitrep.toolCalls.forEach((tc, i) => {
      const expected = fnv1a(`${tc.tool}:${tc.params}:${tc.result}`);
      expect(sitrep.assertions[i].hash).toBe(expected);
    });
  });

  test('citations [1]..[n] appear in the document in order', () => {
    for (let i = 1; i <= sitrep.toolCalls.length; i++) {
      expect(sitrep.markdown).toContain(`[${i}]`);
    }
  });

  test('deterministic for identical inputs (same timestamp + run id)', () => {
    const again = generateSitrep(makeCtx());
    expect(again.markdown).toBe(sitrep.markdown);
    expect(again.toolCalls).toEqual(sitrep.toolCalls);
  });

  test('different run id changes the document', () => {
    const other = generateSitrep({ ...makeCtx(), runId: 'run-other9' });
    expect(other.markdown).not.toBe(sitrep.markdown);
  });

  test('recommendations are hypothetical tabletop prompts, never imperatives', () => {
    expect(sitrep.markdown).toContain('Hypothetical Tabletop Discussion (NOT dispatch instructions)');
    expect(sitrep.markdown).toContain('If this were a real event');
    expect(sitrep.markdown).toContain('no action below is executed');
    // forbidden imperative phrasings must not appear in the recommendations context
    expect(sitrep.markdown).not.toMatch(/dispatch ground assessment teams to/);
    expect(sitrep.markdown).not.toMatch(/queue drone tasking/);
  });

  test('body text never implies real imagery or SAR processing', () => {
    expect(sitrep.markdown).toContain('No imagery was acquired or processed');
    expect(sitrep.markdown).toContain('no SAR was thresholded');
    expect(sitrep.markdown).toContain('illustrative catalog-metadata shapes');
    expect(sitrep.markdown).toContain('NOT model probabilities');
  });

  test('checksum honesty note distinguishes FNV-1a from signatures and the pilot chain', () => {
    expect(sitrep.markdown).toContain('non-cryptographic FNV-1a demo checksums');
    expect(sitrep.markdown).toContain('are **not** digital signatures');
    expect(sitrep.markdown).toContain('SHA-256 audit chain');
    expect(sitrep.markdown).not.toContain('tamper-proof');
    expect(sitrep.markdown).not.toContain('authenticated evidence');
  });

  test('provenance appendix marks every sensor illustrative and the population synthetic', () => {
    expect(sitrep.markdown).toContain('ILLUSTRATIVE (not acquired)');
    expect(sitrep.markdown).toContain('NOT WorldPop');
    expect(sitrep.markdown).toContain('NOT OpenStreetMap data');
    for (const s of meta.sensors) {
      expect(sitrep.markdown).toContain(s.platform);
      expect(sitrep.markdown).toContain(s.license);
    }
  });

  test('top zones table contains the leading zone id', () => {
    const top = decision.zones.slice(0, 5);
    expect(sitrep.markdown).toContain(top[0].id);
  });
});
