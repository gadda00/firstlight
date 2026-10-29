/* ==========================================================================
 * FirstLight — server-side event layer (Phase 3/4).
 *
 * Builds an event's analysis layer on the server from durable state:
 *  1. The labeled synthetic scenario layer (DemoScenarioProvider with an
 *     EXPLICIT opt-in — never silent in operational mode),
 *  2. Human review decisions from the database (immutable, attributed),
 *  3. The versioned score manifest (from the org's approved ScoreConfig or
 *     the documented default).
 *
 * The result feeds the map layer endpoint, the claim tools, and sitrep
 * generation. Review changes are reflected on the next read (scores are
 * recomputed server-side from the decision history — never from browser
 * state).
 * ========================================================================== */

import type { PrismaClient } from '@prisma/client';
import { DemoScenarioProvider } from '@/lib/firstlight/demo-provider';
import {
  computeDecision,
  DEFAULT_WEIGHTS,
} from '@/lib/firstlight/decision';
import { DEFAULT_SCORE_MANIFEST, type ScoreManifest } from '@/lib/firstlight/scoring';
import { eventById, EVENTS } from '@/lib/firstlight/events';
import type {
  DamageClass,
  EventDecisionData,
  EventRawData,
  ReviewDecision,
  ReviewOverrides,
} from '@/lib/firstlight/types';
import { errors } from './http';

export interface EventLayer {
  raw: EventRawData;
  decision: EventDecisionData;
  manifest: ScoreManifest;
}

/** Load the org's approved score config, or the documented default. */
export async function resolveManifest(
  db: PrismaClient,
  orgId: string,
): Promise<ScoreManifest> {
  const cfg = await db.scoreConfig.findFirst({
    where: { orgId, eventId: null },
    orderBy: { version: 'desc' },
  });
  if (!cfg) return DEFAULT_SCORE_MANIFEST;
  const w = JSON.parse(cfg.weightsJson) as { w1: number; w2: number; w3: number; w4: number };
  return {
    ...DEFAULT_SCORE_MANIFEST,
    weights: w,
    normalization: cfg.normalization === 'p90robust' ? 'p90robust' : 'max',
    exposureMethod:
      cfg.exposureMethod === 'heuristic-weighted-overlay-v1'
        ? 'heuristic-weighted-overlay-v1'
        : cfg.exposureMethod === 'area-weighted-intersection-v1'
          ? 'heuristic-weighted-overlay-v2-area'
          : DEFAULT_SCORE_MANIFEST.exposureMethod,
    missingPenalty: cfg.missingPenalty,
  };
}

/** Build the synthetic EventMeta equivalent for a persisted incident event. */
function metaFor(ev: {
  id: string;
  name: string;
  archetype: string;
  country: string;
  location: string;
  centerLat: number;
  centerLng: number;
  aoiKm: number;
  incidentTime: Date;
  severity: number;
  seed: number;
}): EventRawData['meta'] {
  const fallback = eventById(EVENTS[0].id);
  return {
    id: `ev-${ev.id.slice(0, 8)}`,
    name: ev.name,
    archetype: (['hurricane', 'flood', 'earthquake'] as const).includes(
      ev.archetype as 'hurricane' | 'flood' | 'earthquake',
    )
      ? (ev.archetype as 'hurricane' | 'flood' | 'earthquake')
      : 'flood',
    location: ev.location,
    country: ev.country,
    center: { lat: ev.centerLat, lng: ev.centerLng },
    aoiKm: ev.aoiKm,
    description: `${ev.name} — operational workspace event (${ev.location}, ${ev.country}).`,
    preDate: new Date(ev.incidentTime.getTime() - 7 * 86400_000).toISOString().slice(0, 10),
    postDate: new Date(ev.incidentTime.getTime() + 86400_000).toISOString().slice(0, 10),
    sensors: fallback.sensors.slice(0, 2),
    severity: ev.severity,
    seed: ev.seed,
    population: 150000,
    eventDate: ev.incidentTime.toISOString().slice(0, 10),
    ...(ev.archetype === 'earthquake' ? { epicenter: { lat: ev.centerLat, lng: ev.centerLng } } : {}),
    ...(ev.archetype === 'flood' ? { riverAmplitudeKm: 2 } : {}),
    ...(ev.archetype === 'hurricane' ? { landfall: { lat: ev.centerLat, lng: ev.centerLng } } : {}),
  };
}

/** Compute the full layer for a persisted event, applying DB review state. */
export async function buildEventLayer(
  db: PrismaClient,
  ev: {
    id: string;
    orgId: string;
    name: string;
    archetype: string;
    country: string;
    location: string;
    centerLat: number;
    centerLng: number;
    aoiKm: number;
    incidentTime: Date;
    severity: number;
    seed: number;
    demoLayer: boolean;
  },
): Promise<EventLayer> {
  if (!ev.demoLayer) {
    // No synthetic layer attached: the decision layer cannot be computed yet
    // (real ingestion products are catalog references until the raster phase).
    throw errors.badRequest(
      'Event has no analysis layer: attach the labeled synthetic layer at creation, or wait for the processing phase (see ARCHITECTURE.md).',
    );
  }
  const meta = metaFor(ev);
  // EXPLICIT opt-in: this event carries a labeled synthetic demo layer.
  const raw = DemoScenarioProvider.generate(meta, { allowInOperationalMode: true });

  const manifest = await resolveManifest(db, ev.orgId);

  // Apply immutable review decisions from the database.
  const tasks = await db.reviewTask.findMany({
    where: { eventId: ev.id },
    include: { decisions: { orderBy: { createdAt: 'asc' } } },
  });
  const decisions = new Map<string, ReviewDecision>();
  const newClasses = new Map<string, DamageClass>();
  for (const t of tasks) {
    const last = t.decisions[t.decisions.length - 1];
    if (!last) continue;
    decisions.set(t.targetId, last.decision as ReviewDecision);
    if (last.newClass) newClasses.set(t.targetId, last.newClass as DamageClass);
  }
  const overrides: ReviewOverrides = { decisions, newClasses };

  const decision = computeDecision(raw, manifest.weights ?? DEFAULT_WEIGHTS, overrides, manifest);
  return { raw, decision, manifest };
}

/** Create review tasks for flagged detections (bounded, prioritized). */
export async function createReviewTasks(
  db: PrismaClient,
  eventId: string,
  layer: EventLayer,
  createdById: string,
  cap = 40,
): Promise<number> {
  const flagged = layer.raw.buildings
    .filter((b) => b.reviewReason)
    .sort((a, b) => a.confidence - b.confidence)
    .slice(0, cap);
  if (!flagged.length) return 0;
  const existing = await db.reviewTask.findMany({
    where: { eventId, targetType: 'building-detection' },
    select: { targetId: true },
  });
  const existingIds = new Set(existing.map((t) => t.targetId));
  let created = 0;
  for (const b of flagged) {
    if (existingIds.has(b.id)) continue;
    await db.reviewTask.create({
      data: {
        eventId,
        targetType: 'building-detection',
        targetId: b.id,
        reason: b.reviewReason ?? 'low confidence',
        modelConfidence: b.confidence,
        priority: b.confidence < 0.55 ? 2 : b.confidence < 0.65 ? 1 : 0,
        status: 'open',
        createdById,
      },
    });
    created++;
  }
  return created;
}
