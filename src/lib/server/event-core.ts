/* ==========================================================================
 * FirstLight — server-side event layer (Phase 3/4).
 *
 * Builds an event's analysis layer on the server from durable state:
 *  1. The labeled synthetic scenario layer (DemoScenarioProvider with an
 *     EXPLICIT opt-in — never silent in operational mode),
 *  2. Human review decisions from the database (immutable, attributed),
 *  3. The versioned score manifest (from the org's approved ScoreConfig or
 *     the documented default),
 *  4. A first-class LayerProvenance block: the pipeline is a REAL-DATA
 *     CATALOG + SYNTHETIC ANALYSIS — the response names the mode, the real
 *     source asset ids, processing version, CRS, temporal window, quality
 *     status and caveats, so synthetic geometry can never masquerade as
 *     derived-from-imagery output.
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
  /** Honest statement of what this layer IS and IS NOT. */
  provenance: LayerProvenance;
}

/* ------------------------------------------------------ layer provenance */

/**
 * Provenance contract for every served analysis layer (round 4).
 *
 * The operational pipeline today is a REAL-DATA CATALOG plus a SYNTHETIC
 * ANALYSIS LAYER: open-data providers (USGS/NWS/Copernicus/FIRMS/OSM/…)
 * populate a genuine, check-summed asset catalog, while the damage/flood
 * geometry fed to scoring is still the labeled DemoScenarioProvider output
 * (real raster → product processing is the roadmap's processing phase —
 * see ARCHITECTURE.md). This block makes that split IMPOSSIBLE to miss:
 * a real hazard catalog record never silently becomes a synthetic damage
 * polygon, because the layer says exactly which parts are simulated.
 */
export interface LayerProvenance {
  /** What the analysis geometry is computed from. */
  analysisMode: 'synthetic-scenario';
  /** True iff the damage/flood/scoring geometry is synthetic. */
  simulated: true;
  /** One-line honesty statement for UI banners. */
  label: string;
  /** Real catalog assets ingested for this event (bounded to the first 50
   *  ids; the counts below are exact). Empty when nothing was ingested. */
  sourceAssetIds: string[];
  /** Per-adapter catalog summary (real vs simulated records). */
  sources: Array<{
    adapterId: string;
    assets: number;
    simulated: number;
    freshestAcquiredAt: string | null;
    stalestAcquiredAt: string | null;
  }>;
  /** Exact totals across sources. */
  catalogAssets: number;
  simulatedCatalogAssets: number;
  /** Decision/scoring contract version backing `manifest`. */
  processingVersion: string;
  /** Coordinate reference system of the served geometry. */
  crs: 'EPSG:4326';
  /** Observation window the catalog covers. */
  temporalWindow: { from: string; to: string };
  /** Quality status of the layer computation itself. */
  qualityStatus: 'computed-from-synthetic-scenario';
  /** Explicit caveats — rendered, never truncated away. */
  notes: string[];
}

/** Build the provenance block from the event's durable catalog state. */
async function buildLayerProvenance(
  db: PrismaClient,
  ev: {
    id: string;
    incidentTime: Date;
    demoLayer: boolean;
  },
): Promise<LayerProvenance> {
  const assets = await db.assetRecord.findMany({
    where: { eventId: ev.id },
    select: {
      id: true,
      adapterId: true,
      simulated: true,
      acquiredAt: true,
    },
    orderBy: { acquiredAt: 'asc' },
  });

  const byAdapter = new Map<string, { assets: number; simulated: number; times: Date[] }>();
  for (const a of assets) {
    const entry = byAdapter.get(a.adapterId) ?? { assets: 0, simulated: 0, times: [] };
    entry.assets += 1;
    if (a.simulated) entry.simulated += 1;
    if (a.acquiredAt) entry.times.push(a.acquiredAt);
    byAdapter.set(a.adapterId, entry);
  }

  const simulatedCount = assets.filter((a) => a.simulated).length;

  const notes = [
    'Damage/flood geometry and priority scoring are computed from a LABELED SYNTHETIC SCENARIO, not from the ingested catalog.',
    'Ingested provider records (catalog below) are real metadata references with checksums; they are NOT the source of the analysis polygons.',
    'A real processing pipeline (asset → processing job → derived product → validation → score) is planned — see ARCHITECTURE.md "Processing phase".',
  ];
  if (assets.length === 0) {
    notes.push('No provider assets have been ingested for this event yet — run POST /api/events/:id/ingest.');
  }

  return {
    analysisMode: 'synthetic-scenario',
    simulated: true,
    label:
      'Real-data catalog + synthetic analysis demo — analysis geometry is simulated and labeled as such',
    sourceAssetIds: assets.slice(0, 50).map((a) => a.id),
    sources: [...byAdapter.entries()].map(([adapterId, s]) => ({
      adapterId,
      assets: s.assets,
      simulated: s.simulated,
      freshestAcquiredAt: s.times.length
        ? new Date(Math.max(...s.times.map((t) => t.getTime()))).toISOString()
        : null,
      stalestAcquiredAt: s.times.length
        ? new Date(Math.min(...s.times.map((t) => t.getTime()))).toISOString()
        : null,
    })),
    catalogAssets: assets.length,
    simulatedCatalogAssets: simulatedCount,
    processingVersion: DEFAULT_SCORE_MANIFEST.version,
    crs: 'EPSG:4326',
    temporalWindow: {
      from: new Date(ev.incidentTime.getTime() - 7 * 86400_000).toISOString(),
      to: new Date(ev.incidentTime.getTime() + 86400_000).toISOString(),
    },
    qualityStatus: 'computed-from-synthetic-scenario',
    notes,
  };
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

  // The served layer always states, in first-class fields, exactly what the
  // analysis is computed from (synthetic scenario) and which REAL catalog
  // assets exist for the event. See LayerProvenance above.
  const provenance = await buildLayerProvenance(db, ev);

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
  return { raw, decision, manifest, provenance };
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
