/* ==========================================================================
 * FirstLight — DemoScenarioProvider (Phase 0 isolation).
 *
 * The ONLY sanctioned source of synthetic scenario data. The procedural
 * generator (generate.ts) is valuable for repeatable previews and tests, but
 * it must never silently run in operational mode: `generate()` throws unless
 * demo mode is active, or the caller EXPLICITLY opts into a labeled synthetic
 * layer (used when an operational event bootstraps a demonstration overlay).
 *
 * Every artifact it produces carries `demo: { provider, simulated: true,
 * seed }` so downstream exports, sitreps, and the data catalog can label
 * synthetic content without ambiguity.
 * ========================================================================== */

import { generateEvent } from './generate';
import { demoModeEnabled } from './mode';
import type { DemoProvenance, EventMeta, EventRawData } from './types';

export const DEMO_PROVIDER_ID = 'demo-scenario-provider';

export class DemoModeError extends Error {
  constructor(msg = 'DemoScenarioProvider refused to run: operational mode is active and no explicit synthetic-layer opt-in was provided.') {
    super(msg);
    this.name = 'DemoModeError';
  }
}

export interface DemoGenerateOptions {
  /** Explicit, labeled opt-in for a synthetic layer in operational mode. */
  allowInOperationalMode?: boolean;
}

export const DemoScenarioProvider = {
  id: DEMO_PROVIDER_ID,
  license: {
    name: 'Synthetic demo data — no external data rights involved',
    attribution: null,
    simulated: true,
  },
  generate(
    meta: EventMeta,
    opts: DemoGenerateOptions = {},
  ): EventRawData {
    if (!demoModeEnabled() && !opts.allowInOperationalMode) {
      throw new DemoModeError();
    }
    const raw = generateEvent(meta);
    const demo: DemoProvenance = {
      provider: DEMO_PROVIDER_ID,
      simulated: true,
      seed: meta.seed,
      generatedAt: new Date().toISOString(),
    };
    return { ...raw, demo };
  },
};
