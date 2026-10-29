/* ==========================================================================
 * FirstLight — Spatial Graph Engine (blueprint Layer 4).
 * Road network graph + Dijkstra shortest paths + isochrone reachability,
 * implementing the passable-road and isolation analysis from the blueprint.
 * ========================================================================== */

import type { RoadSegment } from './types';

export interface GraphNode {
  id: string;
  lng: number;
  lat: number;
  edges: Edge[];
}

export interface Edge {
  to: string;
  lengthKm: number;
  minutes: number;
  roadId: string;
  blocked: boolean;
}

export interface DijkstraResult {
  distMin: Map<string, number>;
  prev: Map<string, { node: string; roadId: string }>;
}

export class RoadGraph {
  nodes = new Map<string, GraphNode>();
  private edgeCount = 0;
  /** Hardened construction (Phase 3):
   *  - zero/degenerate-length segments are skipped (invalid geometry),
   *  - duplicate edges (same from→to + road id) are ignored,
   *  - `oneway` roads add a single directed edge. */
  constructor(roads: RoadSegment[]) {
    // build node coordinate lookup from road geometry
    const nodeCoord = new Map<string, [number, number]>();
    for (const rd of roads) {
      if (!rd.nodes || rd.nodes.length !== 2) continue; // invalid geometry
      if (!(rd.lengthKm > 0) || !(rd.speedKmh > 0)) continue; // degenerate
      const [a, b] = rd.nodes;
      if (!nodeCoord.has(a)) nodeCoord.set(a, rd.coords[0]);
      if (!nodeCoord.has(b)) nodeCoord.set(b, rd.coords[1]);
    }
    for (const [id, [lng, lat]] of nodeCoord) {
      this.nodes.set(id, { id, lng, lat, edges: [] });
    }
    const seen = new Set<string>();
    for (const rd of roads) {
      if (!rd.nodes || rd.nodes.length !== 2) continue;
      if (!(rd.lengthKm > 0) || !(rd.speedKmh > 0)) continue;
      const [a, b] = rd.nodes;
      const minutes = (rd.lengthKm / rd.speedKmh) * 60;
      const fwdKey = `${a}>${b}:${rd.id}`;
      const revKey = `${b}>${a}:${rd.id}`;
      if (!seen.has(fwdKey)) {
        if (this.addEdge(a, b, rd, minutes)) seen.add(fwdKey);
      }
      // one-way streets are traversable only in the digitized direction
      if (!rd.oneway && !seen.has(revKey)) {
        if (this.addEdge(b, a, rd, minutes)) seen.add(revKey);
      }
    }
  }

  private addEdge(from: string, to: string, rd: RoadSegment, minutes: number): boolean {
    const node = this.nodes.get(from);
    if (!node || !this.nodes.get(to)) return false;
    node.edges.push({
      to,
      lengthKm: rd.lengthKm,
      minutes,
      roadId: rd.id,
      blocked: rd.blocked,
    });
    this.edgeCount++;
    return true;
  }

  get size(): number {
    return this.nodes.size;
  }

  get edges(): number {
    return this.edgeCount;
  }

  /** Dijkstra from a source node. `postEvent` skips blocked edges. */
  dijkstra(source: string, postEvent: boolean): DijkstraResult {
    const distMin = new Map<string, number>();
    const prev = new Map<string, { node: string; roadId: string }>();
    const visited = new Set<string>();
    distMin.set(source, 0);
    // binary min-heap on minutes
    const heap: { d: number; id: string }[] = [];
    const push = (d: number, id: string) => {
      heap.push({ d, id });
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p].d <= heap[i].d) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = (): { d: number; id: string } | undefined => {
      if (!heap.length) return undefined;
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l].d < heap[m].d) m = l;
          if (r < heap.length && heap[r].d < heap[m].d) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    push(0, source);
    while (heap.length) {
      const cur = pop()!;
      if (visited.has(cur.id)) continue;
      visited.add(cur.id);
      const node = this.nodes.get(cur.id);
      if (!node) continue;
      for (const e of node.edges) {
        if (postEvent && e.blocked) continue;
        const nd = cur.d + e.minutes;
        if (nd < (distMin.get(e.to) ?? Infinity)) {
          distMin.set(e.to, nd);
          prev.set(e.to, { node: cur.id, roadId: e.roadId });
          push(nd, e.to);
        }
      }
    }
    return { distMin, prev };
  }

  /** Multi-source Dijkstra (virtual super-source). Returns distance map only. */
  dijkstraMulti(sources: string[], postEvent: boolean): DijkstraResult {
    const distMin = new Map<string, number>();
    const prev = new Map<string, { node: string; roadId: string }>();
    const visited = new Set<string>();
    const heap: { d: number; id: string }[] = [];
    const push = (d: number, id: string) => {
      heap.push({ d, id });
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p].d <= heap[i].d) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = (): { d: number; id: string } | undefined => {
      if (!heap.length) return undefined;
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l].d < heap[m].d) m = l;
          if (r < heap.length && heap[r].d < heap[m].d) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    for (const s of sources) {
      if (!this.nodes.has(s)) continue;
      if (!distMin.has(s)) {
        distMin.set(s, 0);
        push(0, s);
      }
    }
    while (heap.length) {
      const cur = pop()!;
      if (visited.has(cur.id)) continue;
      visited.add(cur.id);
      const node = this.nodes.get(cur.id);
      if (!node) continue;
      for (const e of node.edges) {
        if (postEvent && e.blocked) continue;
        const nd = cur.d + e.minutes;
        if (nd < (distMin.get(e.to) ?? Infinity)) {
          distMin.set(e.to, nd);
          prev.set(e.to, { node: cur.id, roadId: e.roadId });
          push(nd, e.to);
        }
      }
    }
    return { distMin, prev };
  }

  /** Reconstruct path from source -> target given a Dijkstra result. */
  pathTo(
    target: string,
    prev: DijkstraResult['prev'],
  ): { nodes: string[]; roadIds: string[] } {
    const nodes: string[] = [];
    const roadIds: string[] = [];
    let cur: string | undefined = target;
    while (cur) {
      nodes.unshift(cur);
      const p = prev.get(cur);
      if (!p) break;
      roadIds.unshift(p.roadId);
      cur = p.node;
    }
    return { nodes, roadIds };
  }

  /** Nearest graph node to a coordinate. */
  nearestNode(lng: number, lat: number): string {
    let best = '';
    let bestD = Infinity;
    for (const node of this.nodes.values()) {
      const d = (node.lng - lng) ** 2 + (node.lat - lat) ** 2;
      if (d < bestD) {
        bestD = d;
        best = node.id;
      }
    }
    return best;
  }

  /** Nodes reachable within `maxMin` on the post-event graph. */
  isochrone(source: string, maxMin: number): Set<string> {
    const { distMin } = this.dijkstra(source, true);
    const out = new Set<string>();
    for (const [id, d] of distMin) if (d <= maxMin) out.add(id);
    return out;
  }
}
