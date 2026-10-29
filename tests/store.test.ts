/* Store tests — operational-mode server layer loading.
 *
 * Round-trip: generate a demo scenario (as the server would for a
 * demoLayer event), serialize it the way handleLayer does (lossless),
 * mock fetch to return that envelope, and verify the store reconstructs
 * the exact typed layer the map + panels expect — including the zoneIndex
 * Map that JSON cannot carry.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { EVENTS } from '@/lib/firstlight/events';
import { DemoScenarioProvider } from '@/lib/firstlight/demo-provider';
import { computeDecision } from '@/lib/firstlight/decision';
import { useFirstLight } from '@/store/firstlight';

function buildServerEnvelope() {
  const meta = EVENTS[0];
  const raw = DemoScenarioProvider.generate(meta);
  const decision = computeDecision(raw, { w1: 0.4, w2: 0.3, w3: 0.2, w4: 0.1 }, {
    decisions: new Map(),
    newClasses: new Map(),
  });
  const { zoneIndex: _zi, ...decisionRest } = decision;
  return {
    data: {
      event: {
        id: 'evt_server_1',
        name: 'Server Event',
        archetype: 'flood',
        status: 'review',
        country: 'United States',
        location: 'Testville',
        center: { lat: 41.977, lng: -91.665 },
        aoiKm: 9,
        incidentTime: new Date().toISOString(),
        demoLayer: true,
      },
      demo: raw.demo ?? null,
      manifest: { version: 'need-score-v2' },
      stats: decisionRest.stats,
      zones: decisionRest.zones,
      facilities: raw.facilities,
      roads: raw.roads,
      floods: raw.floods,
      buildings: raw.buildings,
      popGrid: raw.popGrid,
      meta: raw.meta,
      stages: raw.stages,
      totalPop: raw.totalPop,
      version: 3,
    },
  };
}

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  // Reset the store to its initial state between tests.
  useFirstLight.setState({
    raw: null,
    decision: null,
    phase: 'idle',
    stageIndex: 0,
    activeServerEventId: null,
    activeServerEventName: null,
    serverEvents: [],
    serverBusy: false,
    serverError: null,
    routes: [],
  });
});

describe('store — loadServerEvent (operational mode)', () => {
  test('reconstructs raw + decision + zoneIndex from the server envelope', async () => {
    const envelope = buildServerEnvelope();
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify(envelope), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await useFirstLight.getState().loadServerEvent('evt_server_1');

    const s = useFirstLight.getState();
    expect(calls).toEqual(['/api/events/evt_server_1/layer']);
    expect(s.raw).not.toBeNull();
    expect(s.decision).not.toBeNull();
    expect(s.phase).toBe('done');
    expect(s.activeServerEventId).toBe('evt_server_1');
    expect(s.activeServerEventName).toBe('Server Event');
    expect(s.serverError).toBeNull();
    // The Map that JSON cannot carry is rebuilt from zones:
    expect(s.decision!.zoneIndex).toBeInstanceOf(Map);
    expect(s.decision!.zoneIndex.size).toBe(s.decision!.zones.length);
    for (const z of s.decision!.zones) {
      expect(s.decision!.zoneIndex.get(z.id)).toBe(z);
    }
    // Lossless fields the demo UI relies on survive the round trip:
    expect(s.raw!.roads[0].nodes).toBeDefined();
    expect(s.raw!.buildings[0].footprint).toBeDefined();
    expect(s.raw!.popGrid.length).toBeGreaterThan(0);
    expect(s.raw!.demo?.simulated).toBe(true);
    expect(s.runId.startsWith('srv-')).toBe(true);
  });

  test('an API error surfaces in serverError and resets phase', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ error: { code: 'not_found', message: 'Event not found' } }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    await expect(
      useFirstLight.getState().loadServerEvent('evt_missing'),
    ).rejects.toThrow('Event not found');

    const s = useFirstLight.getState();
    expect(s.serverError).toContain('Event not found');
    expect(s.phase).toBe('idle');
    expect(s.raw).toBeNull();
    expect(s.decision).toBeNull();
  });

  test('loadServerEvents stores the org event list', async () => {
    const events = [
      {
        id: 'ev1',
        name: 'Cedar River Flood',
        archetype: 'flood',
        status: 'review',
        country: 'United States',
        location: 'Cedar Rapids',
        incidentTime: new Date().toISOString(),
        demoLayer: true,
        counts: { assets: 3, reviewTasks: 12, sitreps: 1, exports: 2 },
      },
    ];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/api/events');
      return new Response(JSON.stringify({ data: { events } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const listed = await useFirstLight.getState().loadServerEvents();
    expect(listed).toHaveLength(1);
    expect(useFirstLight.getState().serverEvents[0].name).toBe('Cedar River Flood');
  });

  test('demo-mode loadEvent is untouched by the server additions', () => {
    useFirstLight.getState().loadEvent(EVENTS[1].id);
    const s = useFirstLight.getState();
    expect(s.raw).not.toBeNull();
    expect(s.decision).not.toBeNull();
    expect(s.activeServerEventId).toBeNull();
    expect(s.serverEvents).toHaveLength(0);
    // Demo provenance stamp intact:
    expect(s.raw!.demo?.provider).toBe('demo-scenario-provider');
  });
});
