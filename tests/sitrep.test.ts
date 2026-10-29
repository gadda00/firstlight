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

  test('markdown header carries classification, location, run id, approval state', () => {
    expect(sitrep.markdown).toContain('SITUATION REPORT');
    expect(sitrep.markdown).toContain('SIMULATED DEMONSTRATION DATA');
    expect(sitrep.markdown).toContain(meta.location);
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

  test('provenance appendix lists every sensor with license', () => {
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
