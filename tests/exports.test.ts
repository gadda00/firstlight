/* Unit tests — export builders (GeoJSON/CSV/audit/offline bundle).
 * v2.3: every artifact must carry BOTH machine-readable synthetic flags
 * (simulated, scenario_id, seed, provider, warning) and honest wording —
 * synthetic confidence is exported as `scenario_score`, never as
 * `confidence`. */

import { describe, expect, test } from 'bun:test';
import { EVENTS } from '@/lib/firstlight/events';
import { generateEvent } from '@/lib/firstlight/generate';
import { computeDecision, DEFAULT_WEIGHTS } from '@/lib/firstlight/decision';
import {
  damageGeoJSON,
  floodGeoJSON,
  zonesGeoJSON,
  roadsGeoJSON,
  routesGeoJSON,
  zonesCSV,
  auditTrail,
  offlineBundle,
  slugEvent,
  statsLine,
} from '@/lib/firstlight/exports';
import { generateSitrep } from '@/lib/firstlight/sitrep';
import type { ReviewOverrides } from '@/lib/firstlight/types';

const meta = EVENTS[1];
const raw = generateEvent(meta);
const overrides: ReviewOverrides = {
  decisions: new Map(),
  newClasses: new Map(),
};
const decision = computeDecision(raw, DEFAULT_WEIGHTS, overrides);
const sitrep = generateSitrep({
  raw,
  decision,
  overrides,
  generatedAt: new Date('2025-06-18T09:00:00Z'),
  runId: 'run-test01',
});

const bundle = {
  raw,
  decision,
  overrides,
  weights: DEFAULT_WEIGHTS,
  routes: [],
  sitrep,
  runId: 'run-test01',
  approvedBy: 'analyst@example.org',
  generatedAt: '2025-06-18T09:00:00.000Z',
};

describe('synthetic provenance stamps (every export artifact)', () => {
  test('every GeoJSON collection carries simulated/scenario_id/seed/warning', () => {
    for (const fc of [
      damageGeoJSON(raw, overrides),
      floodGeoJSON(raw),
      zonesGeoJSON(decision, raw),
      roadsGeoJSON(raw),
      routesGeoJSON([], raw),
    ]) {
      expect(fc.simulated).toBe(true);
      expect(fc.scenario_id).toBe(meta.id);
      expect(fc.seed).toBe(meta.seed);
      expect(fc.provider).toBe('demo-scenario-provider');
      expect(fc.warning).toContain('SIMULATED EXERCISE');
      expect(fc.type).toBe('FeatureCollection');
    }
  });

  test('feature properties never present confidence — scenario_score only', () => {
    for (const f of damageGeoJSON(raw, overrides).features) {
      expect(f.properties).not.toHaveProperty('confidence');
      expect(typeof f.properties.scenario_score === 'number').toBe(true);
      expect(f.properties.simulated).toBe(true);
    }
    for (const f of roadsGeoJSON(raw).features) {
      expect(f.properties).not.toHaveProperty('confidence');
      expect(typeof f.properties.scenario_score === 'number').toBe(true);
    }
  });

  test('provenance strings name the generator, never a model or SAR', () => {
    for (const f of damageGeoJSON(raw, overrides).features) {
      expect(f.properties.provenance).toContain('simulated');
      expect(f.properties.provenance).not.toContain('UNet');
      expect(f.properties.provenance).not.toContain('Siamese');
    }
    for (const f of floodGeoJSON(raw).features) {
      expect(f.properties.provenance).toContain('no imagery processed');
      expect(String(f.properties.generator)).toMatch(/^synthetic:/);
    }
  });

  test('zonesCSV marks every row simulated with the scenario id', () => {
    const lines = zonesCSV(decision, raw).split('\n');
    expect(lines[0].startsWith('simulated,scenario_id,')).toBe(true);
    for (const row of lines.slice(1)) {
      expect(row.startsWith('yes,')).toBe(true);
      expect(row.split(',')[1]).toBe(meta.id);
    }
  });

  test('auditTrail: hash honesty + machine flags + reviewer identity', () => {
    const audit = auditTrail(bundle);
    expect(audit.format).toBe('firstlight-audit-trail/1.0');
    expect(audit.simulated).toBe(true);
    expect(audit.scenario_id).toBe(meta.id);
    expect(audit.warning).toContain('SIMULATED EXERCISE');
    expect(audit.hash_algorithm).toContain('non-cryptographic');
    expect(audit.hash_algorithm).toContain('does not verify truth');
    expect(audit.human_in_loop.sitrep_approved).toBe(true);
    expect(audit.human_in_loop.approved_by).toBe('analyst@example.org');
    expect(audit.audit_hash).toMatch(/^[0-9a-f]{8}$/);
  });

  test('offlineBundle: clearly-synthetic single-file artifact', () => {
    const ob = offlineBundle(bundle);
    expect(ob.format).toBe('firstlight-offline-bundle/1.0');
    expect(ob.simulated).toBe(true);
    expect(ob.warning).toContain('not current conditions');
    expect(ob.note).toContain('No real satellite imagery was processed');
    expect(Object.keys(ob.layers)).toEqual(
      expect.arrayContaining(['damage', 'flood', 'zones', 'roads', 'routes']),
    );
    expect(ob.sitrep_markdown).toContain('SYNTHETIC EXERCISE REPORT');
    expect(ob.audit.format).toBe('firstlight-audit-trail/1.0');
  });
});

describe('GeoJSON builders', () => {
  test('damageGeoJSON: excludes undamaged and rejected, keeps effective class', () => {
    const fc = damageGeoJSON(raw, overrides);
    expect(fc.type).toBe('FeatureCollection');
    const damaged = raw.buildings.filter((b) => b.damage !== 'none');
    expect(fc.features).toHaveLength(damaged.length);
    for (const f of fc.features) {
      expect(f.properties.damage_class).not.toBe('none');
      expect(f.properties.provenance).toContain('simulated');
    }
  });

  test('damageGeoJSON: rejection removes a feature', () => {
    const target = raw.buildings.find((b) => b.damage === 'destroyed')!;
    const ov: ReviewOverrides = {
      decisions: new Map([[target.id, 'rejected']]),
      newClasses: new Map(),
    };
    const fc = damageGeoJSON(raw, ov);
    expect(fc.features.find((f) => f.id === target.id)).toBeUndefined();
  });

  test('damageGeoJSON: reclassification exports original + effective class', () => {
    const target = raw.buildings.find((b) => b.damage === 'major')!;
    const ov: ReviewOverrides = {
      decisions: new Map([[target.id, 'reclassified']]),
      newClasses: new Map([[target.id, 'minor']]),
    };
    const fc = damageGeoJSON(raw, ov);
    const f = fc.features.find((x) => x.id === target.id)!;
    expect(f.properties.damage_class).toBe('minor');
    expect(f.properties.original_class).toBe('major');
  });

  test('floodGeoJSON matches raw flood count with closed rings', () => {
    const fc = floodGeoJSON(raw);
    expect(fc.features).toHaveLength(raw.floods.length);
    for (const f of fc.features) {
      const ring = f.geometry.coordinates[0];
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    }
  });

  test('zonesGeoJSON exports one feature per zone with score components', () => {
    const fc = zonesGeoJSON(decision, raw);
    expect(fc.features).toHaveLength(decision.zones.length);
    for (const f of fc.features) {
      const p = f.properties;
      for (const key of ['h3_index', 'rank', 'need', 'tier', 'D', 'Pexp', 'Iso', 'Crit']) {
        expect(p).toHaveProperty(key);
      }
    }
  });

  test('roadsGeoJSON marks blocked segments and carries closure provenance', () => {
    const fc = roadsGeoJSON(raw);
    const blocked = fc.features.filter((f) => f.properties.blocked);
    expect(blocked.length).toBe(raw.roads.filter((r) => r.blocked).length);
    for (const f of blocked) {
      expect(String(f.properties.closure_source)).toMatch(/^synthetic:/);
    }
  });

  test('routesGeoJSON tolerates empty routes', () => {
    const fc = routesGeoJSON([], raw);
    expect(fc.features).toHaveLength(0);
  });
});

describe('CSV & misc', () => {
  test('zonesCSV rows match zone count', () => {
    const csv = zonesCSV(decision, raw);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(decision.zones.length + 1);
  });

  test('slugEvent strips the ev- prefix', () => {
    expect(slugEvent('ev-syn-a-storm')).toBe('syn-a-storm');
  });

  test('statsLine marks its numbers generated', () => {
    const line = statsLine(decision);
    expect(line).toContain('generated');
    expect(line).toContain('km²');
  });
});
