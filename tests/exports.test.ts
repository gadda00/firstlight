/* Unit tests — export builders (GeoJSON/CSV/audit/offline bundle). */

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
    const fc = zonesGeoJSON(decision);
    expect(fc.features).toHaveLength(decision.zones.length);
    for (const f of fc.features) {
      const p = f.properties;
      for (const key of ['h3_index', 'rank', 'need', 'tier', 'D', 'Pexp', 'Iso', 'Crit']) {
        expect(p).toHaveProperty(key);
      }
    }
  });

  test('roadsGeoJSON marks blocked segments', () => {
    const fc = roadsGeoJSON(raw);
    const blocked = fc.features.filter((f) => f.properties.blocked);
    expect(blocked.length).toBe(raw.roads.filter((r) => r.blocked).length);
  });

  test('routesGeoJSON tolerates empty routes', () => {
    const fc = routesGeoJSON([]);
    expect(fc.features).toHaveLength(0);
  });
});

describe('CSV & audit', () => {
  test('zonesCSV header is stable and rows match zone count', () => {
    const csv = zonesCSV(decision);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'rank,h3_index,tier,need,D,Pexp,Iso,Crit,buildings,destroyed,major,minor,population,affected_pop,isolated,flood_share,pre_hospital_min,post_hospital_min',
    );
    expect(lines).toHaveLength(decision.zones.length + 1);
  });

  test('auditTrail records reviewer identity and disclaimer', () => {
    const audit = auditTrail(bundle);
    expect(audit.format).toBe('firstlight-audit-trail/1.0');
    expect(audit.human_in_loop.sitrep_approved).toBe(true);
    expect(audit.human_in_loop.approved_by).toBe('analyst@example.org');
    expect(audit.disclaimer).toContain('FNV-1a demo checksums');
    expect(audit.audit_hash).toMatch(/^[0-9a-f]{8}$/);
  });

  test('offlineBundle bundles all layers + sitrep + audit', () => {
    const ob = offlineBundle(bundle);
    expect(ob.format).toBe('firstlight-offline-bundle/1.0');
    expect(Object.keys(ob.layers)).toEqual(
      expect.arrayContaining(['damage', 'flood', 'zones', 'roads', 'routes']),
    );
    expect(ob.sitrep_markdown).toContain('SITUATION REPORT');
    expect(ob.audit.format).toBe('firstlight-audit-trail/1.0');
  });

  test('slugEvent strips the ev- prefix', () => {
    expect(slugEvent('ev-cedar-river')).toBe('cedar-river');
  });

  test('statsLine renders the headline numbers', () => {
    const line = statsLine(decision);
    expect(line).toContain('km² flood');
    expect(line).toContain('bldg major+');
  });
});
