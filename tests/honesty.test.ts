/* Honesty pins — the truthfulness contract of the public demo.
 *
 * These tests encode the non-negotiable rules: scenario names cannot be
 * mistaken for historical events; sensor metadata is illustrative; the
 * pipeline stage list names only compute that actually runs; facility
 * names are generic + synthetic; confidence is presented as a generated
 * scenario score; and no claim of active learning / verified routes /
 * operational deployment survives anywhere in the demo source.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVENTS } from '@/lib/firstlight/events';
import { generateEvent } from '@/lib/firstlight/generate';

const DEMO_UI = join(import.meta.dir, '..', 'src', 'components', 'firstlight');

function read(rel: string): string {
  return readFileSync(join(DEMO_UI, rel), 'utf8');
}

describe('scenario nomenclature — unmistakably synthetic', () => {
  test('every event name starts with "Synthetic Scenario"', () => {
    for (const e of EVENTS) {
      expect(e.name.startsWith('Synthetic Scenario')).toBe(true);
    }
  });

  test('no realistic historical-lookalike storm/place names survive', () => {
    const all = JSON.stringify(EVENTS);
    for (const banned of [
      'Hurricane Odette',
      'Hurricane Ian',
      'Cedar River Flood',
      'Aegean Earthquake',
      'Bayfront',
      'Northside Regional',
      'St. Vincent',
      'Lakeshore University',
    ]) {
      expect(all).not.toContain(banned);
    }
  });

  test('event dates are explicitly scenario clocks, not acquisitions', () => {
    for (const e of EVENTS) {
      expect(e.eventDate).toContain('scenario clock');
      expect(e.preDate).toContain('illustrative');
      expect(e.postDate).toContain('illustrative');
      expect(e.description).toContain('No ');
      expect(e.description).toContain('no imagery was acquired');
    }
  });

  test('every sensor record is flagged simulated with not-acquired fields', () => {
    for (const e of EVENTS) {
      for (const s of e.sensors) {
        expect(s.simulated).toBe(true);
        expect(s.date.startsWith('n/a')).toBe(true);
        expect(s.license.includes('illustrative') || s.license.includes('synthetic')).toBe(true);
      }
    }
  });

  test('population sensor is labeled synthetic, not WorldPop data', () => {
    for (const e of EVENTS) {
      const pop = e.sensors.find((s) => s.id === 'pop')!;
      expect(pop.platform).toContain('synthetic');
      expect(pop.sensor).toContain('not WorldPop');
    }
  });
});

describe('generator output — honest stages, sources, facilities', () => {
  const raw = generateEvent(EVENTS[0]);

  test('stage list names only compute that actually runs (no ingestion/inference theater)', () => {
    const stageText = JSON.stringify(raw.stages).toLowerCase();
    for (const banned of ['stac', 'ingest', 'rtc', 'speckle', 'unet', 'resnet', 'inference', 'otsu', 'co-register']) {
      expect(stageText).not.toContain(banned);
    }
    expect(raw.stages.length).toBe(4);
    expect(raw.stages[0].name).toBe('Scenario generation');
  });

  test('every flood source note is prefixed synthetic and denies imagery', () => {
    for (const f of raw.floods) {
      expect(f.source.startsWith('synthetic:')).toBe(true);
      expect(f.source).toContain('no imagery');
    }
  });

  test('every closure source is prefixed synthetic', () => {
    for (const r of raw.roads) {
      if (r.closure) {
        expect(r.closure.source.startsWith('synthetic:')).toBe(true);
      }
    }
  });

  test('facility names are generic + explicitly synthetic', () => {
    for (const f of raw.facilities) {
      expect(f.name.startsWith('Synthetic')).toBe(true);
    }
  });
});

describe('demo UI copy — no operational or training claims', () => {
  const surfaces = [
    'panels/data.tsx',
    'panels/review.tsx',
    'panels/access.tsx',
    'panels/overview.tsx',
    'panels/export.tsx',
    'map/map-view.tsx',
    'pipeline-overlay.tsx',
    'simulated-banner.tsx',
    'first-use.tsx',
  ];

  test('no active-learning / moat / training-loop claims anywhere', () => {
    for (const rel of surfaces) {
      const src = read(rel);
      expect(src).not.toContain('active-learning loop');
      expect(src).not.toContain('the moat');
      expect(src).not.toContain('become training labels');
      expect(src).not.toContain('customer-specific labels');
    }
  });

  test('map labels the swipe as basemap vs overlays, never PRE/POST-EVENT imagery', () => {
    const src = read('map/map-view.tsx');
    expect(src).toContain('BASEMAP — no scenario overlays');
    expect(src).toContain('BASEMAP + GENERATED OVERLAYS');
    expect(src).toContain('SIMULATED OVERLAYS');
    expect(src).not.toContain('PRE-EVENT');
    expect(src).not.toContain('POST-EVENT');
    // legend honesty
    expect(src).toContain('Flood extent (generated)');
    expect(src).toContain('Tabletop route (toy graph)');
    expect(src).not.toContain('Flood extent (SAR)');
    expect(src).not.toContain('Dispatch route');
  });

  test('swipe divider is keyboard-operable with slider semantics', () => {
    const src = read('map/map-view.tsx');
    expect(src).toContain('role="slider"');
    expect(src).toContain('aria-valuenow');
    expect(src).toContain('onKeyDown={onDividerKeyDown}');
  });

  test('pipeline overlay presents generation, not processing theater', () => {
    const src = read('pipeline-overlay.tsx');
    expect(src).toContain('Generating synthetic scenario');
    expect(src).toContain('UI pacing — not pipeline telemetry');
    expect(src).toContain('no satellite ingestion · no ML inference');
  });

  test('persistent banner text present and never dismissible', () => {
    const src = read('simulated-banner.tsx');
    expect(src).toContain('not current conditions');
    // no dismiss affordance at all
    expect(src).not.toContain('onClick');
    expect(src).not.toContain('Button');
  });

  test('review panel describes the ephemeral demo queue honestly', () => {
    const src = read('panels/review.tsx');
    expect(src).toContain('browser-memory only');
    expect(src).toContain('no model trains on them');
    expect(src).not.toContain('ACTIVE-LEARNING REVIEW QUEUE');
  });

  test('access panel never claims verified routes', () => {
    const src = read('panels/access.tsx');
    expect(src).toContain('TABLETOP ROUTE PLANNER');
    expect(src).toContain('not dispatch instructions');
    expect(src).toContain('nothing verified');
    expect(src).not.toContain('all segments verified');
  });

  test('data panel marks sensor records illustrative + not acquired', () => {
    const src = read('panels/data.tsx');
    expect(src).toContain('NOT ACQUIRED');
    expect(src).toContain('nothing was acquired');
    expect(src).toContain('NOT WorldPop');
    expect(src).not.toContain('Siamese UNet');
    expect(src).not.toContain('OSM-derived synthetic');
  });
});
