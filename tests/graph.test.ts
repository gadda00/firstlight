/* Unit tests — spatial graph engine (routing regressions).
 * Covers: shortest path minutes, blocked-edge avoidance, disconnected
 * components, duplicate edges, isochrones, path reconstruction. */

import { describe, expect, test } from 'bun:test';
import { RoadGraph } from '@/lib/firstlight/graph';
import type { RoadSegment } from '@/lib/firstlight/types';

function seg(
  id: string,
  o: Partial<RoadSegment> & { nodes: [string, string] },
): RoadSegment {
  return {
    id,
    coords: [
      [0, 0],
      [0.01, 0],
    ],
    cls: 'local',
    lengthKm: 1,
    speedKmh: 60, // 1 minute per segment
    blocked: false,
    blockCause: null,
    confidence: 0.95,
    ...o,
  };
}

/** Diamond: A→B (1min), A→C (2min), B→D (2min), C→D (2min).
 *  Shortest A→D = 3min via B; blocking bd forces the 4min detour via C. */
function diamond(): RoadSegment[] {
  return [
    seg('ab', { nodes: ['A', 'B'] }),
    seg('ac', { nodes: ['A', 'C'], lengthKm: 2 }),
    seg('bd', { nodes: ['B', 'D'], lengthKm: 2 }),
    seg('cd', { nodes: ['C', 'D'], lengthKm: 2 }),
  ];
}

describe('RoadGraph — Dijkstra', () => {
  test('chooses the 3-minute path over the 4-minute path', () => {
    const g = new RoadGraph(diamond());
    const { distMin } = g.dijkstra('A', false);
    expect(distMin.get('D')).toBeCloseTo(3, 5); // A→B→D = 1+2
  });

  test('post-event mode skips blocked edges and takes the detour', () => {
    const roads = diamond().map((r) =>
      r.id === 'bd' ? { ...r, blocked: true, blockCause: 'flood' as const } : r,
    );
    const g = new RoadGraph(roads);
    const { distMin } = g.dijkstra('A', true);
    expect(distMin.get('D')).toBeCloseTo(4, 5); // forced A→C→D
  });

  test('disconnected components are unreachable', () => {
    const roads = [...diamond(), seg('xy', { nodes: ['X', 'Y'] })];
    const g = new RoadGraph(roads);
    const { distMin } = g.dijkstra('A', false);
    expect(distMin.has('X')).toBe(false);
  });

  test('duplicate edges are deduplicated (same from→to + road id)', () => {
    const roads = [...diamond(), ...diamond()]; // every edge twice
    const g = new RoadGraph(roads);
    const { distMin } = g.dijkstra('A', false);
    expect(distMin.get('D')).toBeCloseTo(3, 5);
    expect(g.edges).toBe(8); // 4 unique undirected edges × 2 directions
  });

  test('one-way streets are traversable only in the digitized direction', () => {
    const roads = [...diamond(), seg('on', { nodes: ['D', 'E'], oneway: true })];
    const g = new RoadGraph(roads);
    const fromD = g.dijkstra('D', false).distMin;
    const fromE = g.dijkstra('E', false).distMin;
    expect(fromD.get('E')).toBeCloseTo(1, 5); // D → E allowed
    expect(fromE.has('D')).toBe(false); // E → D forbidden
  });

  test('zero-length / invalid segments are skipped, not crashed on', () => {
    const roads = [
      ...diamond(),
      seg('zero', { nodes: ['P', 'Q'], lengthKm: 0 }),
      { ...seg('bad-speed', { nodes: ['P2', 'Q2'] }), speedKmh: 0 },
      { ...seg('bad-nodes', { nodes: ['X1'] as unknown as [string, string] }) },
    ];
    const g = new RoadGraph(roads);
    expect(g.nodes.has('P')).toBe(false);
    expect(g.nodes.has('P2')).toBe(false);
    expect(g.nodes.has('X1')).toBe(false);
    expect(g.edges).toBe(8);
    const { distMin } = g.dijkstra('A', false);
    expect(distMin.get('D')).toBeCloseTo(3, 5);
  });

  test('multi-source Dijkstra takes the nearest source', () => {
    const g = new RoadGraph(diamond());
    const { distMin } = g.dijkstraMulti(['B', 'C'], false);
    expect(distMin.get('A')).toBeCloseTo(1, 5); // via B
    expect(distMin.get('D')).toBeCloseTo(2, 5); // via B or C (both 2min)
  });

  test('pathTo reconstructs the road id sequence', () => {
    const g = new RoadGraph(diamond());
    const { prev } = g.dijkstra('A', false);
    const { nodes, roadIds } = g.pathTo('D', prev);
    expect(nodes).toEqual(['A', 'B', 'D']);
    expect(roadIds).toEqual(['ab', 'bd']);
  });

  test('isochrone respects the time bound', () => {
    const g = new RoadGraph(diamond());
    const iso2 = g.isochrone('A', 2);
    expect(iso2.has('B')).toBe(true);
    expect(iso2.has('C')).toBe(true);
    expect(iso2.has('D')).toBe(false);
  });

  test('nearestNode finds the spatially closest node', () => {
    const g = new RoadGraph(diamond());
    expect(g.nearestNode(0.009, 0.0005)).toBe('B');
  });
});
