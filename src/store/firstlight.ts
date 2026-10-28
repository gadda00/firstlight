/* ==========================================================================
 * FirstLight — application store (zustand).
 * Owns: active event, simulated pipeline run, decision data, need-score
 * weights, review decisions, routes, sitrep approval, layer visibility.
 * ========================================================================== */

'use client';

import { create } from 'zustand';
import { EVENTS, eventById } from '@/lib/firstlight/events';
import { generateEvent } from '@/lib/firstlight/generate';
import {
  DEFAULT_WEIGHTS,
  computeDecision,
  computeRoute,
  scoreZones,
} from '@/lib/firstlight/decision';
import { generateSitrep, type SitrepResult } from '@/lib/firstlight/sitrep';
import { fnv1a } from '@/lib/firstlight/rng';
import type {
  DamageClass,
  EventDecisionData,
  EventRawData,
  Facility,
  NeedWeights,
  ReviewDecision,
  RouteResult,
} from '@/lib/firstlight/types';

export type PipelinePhase = 'idle' | 'running' | 'done';

export interface LayerVisibility {
  damage: boolean;
  undamaged: boolean;
  flood: boolean;
  zones: boolean;
  roads: boolean;
  facilities: boolean;
  routes: boolean;
}

export interface FirstLightState {
  eventId: string;
  phase: PipelinePhase;
  stageIndex: number;
  raw: EventRawData | null;
  decision: EventDecisionData | null;
  weights: NeedWeights;
  reviewDecisions: Map<string, ReviewDecision>;
  reviewClasses: Map<string, DamageClass>;
  routes: RouteResult[];
  selectedZoneId: string | null;
  sitrep: SitrepResult | null;
  sitrepApprovedBy: string | null;
  runId: string;
  layers: LayerVisibility;
  swipe: boolean;
  baseStyle: 'satellite' | 'dark';

  loadEvent: (eventId: string) => void;
  setStage: (i: number) => void;
  finishPipeline: () => void;
  setWeights: (w: NeedWeights) => void;
  resetWeights: () => void;
  setReviewDecision: (
    buildingId: string,
    decision: ReviewDecision,
    newClass?: DamageClass,
  ) => void;
  undoReview: (buildingId: string) => void;
  selectZone: (id: string | null) => void;
  addRoute: (originFacilityId: string, destZoneId: string) => void;
  clearRoutes: () => void;
  setSitrep: (s: SitrepResult | null) => void;
  approveSitrep: (analyst: string | null) => void;
  toggleLayer: (key: keyof LayerVisibility) => void;
  setSwipe: (v: boolean) => void;
  setBaseStyle: (v: 'satellite' | 'dark') => void;
}

function emptyOverrides() {
  return {
    decisions: new Map<string, ReviewDecision>(),
    newClasses: new Map<string, DamageClass>(),
  };
}

let pipelineTimers: ReturnType<typeof setTimeout>[] = [];
function clearTimers() {
  pipelineTimers.forEach(clearTimeout);
  pipelineTimers = [];
}

export const useFirstLight = create<FirstLightState>((set, get) => ({
  eventId: EVENTS[0].id,
  phase: 'idle',
  stageIndex: 0,
  raw: null,
  decision: null,
  weights: { ...DEFAULT_WEIGHTS },
  reviewDecisions: new Map(),
  reviewClasses: new Map(),
  routes: [],
  selectedZoneId: null,
  sitrep: null,
  sitrepApprovedBy: null,
  runId: '',
  layers: {
    damage: true,
    undamaged: false,
    flood: true,
    zones: true,
    roads: true,
    facilities: true,
    routes: true,
  },
  swipe: true,
  baseStyle: 'satellite',

  loadEvent: (eventId) => {
    clearTimers();
    const meta = eventById(eventId);
    set({
      eventId,
      phase: 'running',
      stageIndex: 0,
      raw: null,
      decision: null,
      reviewDecisions: new Map(),
      reviewClasses: new Map(),
      routes: [],
      selectedZoneId: null,
      sitrep: null,
      sitrepApprovedBy: null,
      runId: `run-${fnv1a(`${meta.id}-${Date.now()}`).slice(0, 8)}`,
    });

    // synchronous compute (fast — the pipeline overlay is demo-paced)
    const raw = generateEvent(meta);
    const decision = computeDecision(
      raw,
      get().weights,
      emptyOverrides(),
    );
    set({ raw, decision });

    // demo-paced stage animation mirroring the blueprint pipeline
    const stages = raw.stages;
    let acc = 0;
    stages.forEach((st, i) => {
      acc += st.ms;
      pipelineTimers.push(
        setTimeout(() => set({ stageIndex: i + 1 }), acc),
      );
    });
    pipelineTimers.push(
      setTimeout(() => set({ phase: 'done' }), acc + 260),
    );
  },

  setStage: (i) => set({ stageIndex: i }),
  finishPipeline: () => {
    clearTimers();
    set({ phase: 'done', stageIndex: get().raw?.stages.length ?? 0 });
  },

  setWeights: (w) => {
    const { raw, decision, reviewDecisions, reviewClasses } = get();
    if (!raw || !decision) return;
    const zones = [...decision.zones];
    scoreZones(zones, w);
    set({
      weights: w,
      decision: { ...decision, zones, zoneIndex: new Map(zones.map((z) => [z.id, z])) },
    });
  },

  resetWeights: () => get().setWeights({ ...DEFAULT_WEIGHTS }),

  setReviewDecision: (buildingId, decisionVal, newClass) => {
    const { raw, decision, weights, reviewDecisions, reviewClasses } = get();
    if (!raw || !decision) return;
    const decisions = new Map(reviewDecisions);
    const classes = new Map(reviewClasses);
    if (decisionVal === 'reclassified' && newClass) {
      decisions.set(buildingId, 'reclassified');
      classes.set(buildingId, newClass);
    } else {
      decisions.set(buildingId, decisionVal);
      classes.delete(buildingId);
    }
    const recomputed = computeDecision(raw, weights, {
      decisions,
      newClasses: classes,
    });
    set({
      reviewDecisions: decisions,
      reviewClasses: classes,
      decision: recomputed,
      sitrep: null, // stats changed — require regeneration
    });
  },

  undoReview: (buildingId) => {
    const { raw, decision, weights, reviewDecisions, reviewClasses } = get();
    if (!raw || !decision || !reviewDecisions.has(buildingId)) return;
    const decisions = new Map(reviewDecisions);
    const classes = new Map(reviewClasses);
    decisions.delete(buildingId);
    classes.delete(buildingId);
    const recomputed = computeDecision(raw, weights, {
      decisions,
      newClasses: classes,
    });
    set({
      reviewDecisions: decisions,
      reviewClasses: classes,
      decision: recomputed,
      sitrep: null,
    });
  },

  selectZone: (id) => set({ selectedZoneId: id }),

  addRoute: (originFacilityId, destZoneId) => {
    const { raw, decision, routes } = get();
    if (!raw || !decision) return;
    const origin = raw.facilities.find((f) => f.id === originFacilityId);
    const zone = decision.zoneIndex.get(destZoneId);
    if (!origin || !zone) return;
    const roadsById = new Map(raw.roads.map((r) => [r.id, r]));
    const route = computeRoute(raw, origin as Facility, zone, roadsById);
    if (!route) return;
    set({ routes: [...routes.filter((r) => r.destZoneId !== destZoneId), route] });
  },

  clearRoutes: () => set({ routes: [] }),

  setSitrep: (s) => set({ sitrep: s, sitrepApprovedBy: null }),

  approveSitrep: (analyst) => set({ sitrepApprovedBy: analyst }),

  toggleLayer: (key) =>
    set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),

  setSwipe: (v) => set({ swipe: v }),
  setBaseStyle: (v) => set({ baseStyle: v }),
}));
