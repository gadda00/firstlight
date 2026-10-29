/* API: event workspace endpoints. */

import { randomInt } from 'node:crypto';
import { db } from '@/lib/server/db';
import { errors, ok, parseBody } from '@/lib/server/http';
import { getOrgEvent, appendAudit } from '@/lib/server/audit';
import { CreateEventSchema, EventStatusSchema, IngestSchema } from '@/lib/server/schemas';
import { buildEventLayer, createReviewTasks } from '@/lib/server/event-core';
import { runIngestion } from '@/lib/server/ingestion';
import { providerManifest } from '@/lib/server/adapters/registry';
import type { RequestContext } from './router';
import { routeParam } from './router';

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ['ingesting', 'archived'],
  ingesting: ['processing', 'review', 'draft'],
  processing: ['review', 'ingesting'],
  review: ['approved', 'processing'],
  approved: ['published', 'archived'],
  published: ['archived'],
  archived: [],
};

export async function handleListEvents(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const events = await db.incidentEvent.findMany({
    where: { orgId: ctx.auth.user.orgId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { assets: true, reviewTasks: true, sitreps: true, exports: true },
      },
    },
  });
  return ok({ events }, ctx.requestId);
}

export async function handleCreateEvent(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const body = await parseBody(ctx.req, CreateEventSchema);
  const ev = await db.incidentEvent.create({
    data: {
      orgId: ctx.auth.user.orgId,
      name: body.name,
      archetype: body.archetype,
      status: 'draft',
      country: body.country,
      location: body.location,
      centerLat: body.center.lat,
      centerLng: body.center.lng,
      aoiKm: body.aoiKm,
      incidentTime: new Date(body.incidentTime),
      severity: body.severity,
      seed: randomInt(1_000_000, 2_147_000_000),
      demoLayer: body.demoLayer,
      createdBy: ctx.auth.user.id,
    },
  });
  await appendAudit(db, {
    orgId: ctx.auth.user.orgId,
    actorId: ctx.auth.user.id,
    action: 'event.created',
    entityType: 'incident-event',
    entityId: ev.id,
    payload: {
      name: ev.name,
      archetype: ev.archetype,
      center: [ev.centerLat, ev.centerLng],
      aoiKm: ev.aoiKm,
      demoLayer: ev.demoLayer,
    },
  });

  // Bootstrap the labeled synthetic layer + review queue when requested.
  let reviewTasksCreated = 0;
  if (ev.demoLayer) {
    const layer = await buildEventLayer(db, ev);
    reviewTasksCreated = await createReviewTasks(db, ev.id, layer, ctx.auth.user.id);
  }
  return ok(
    {
      event: ev,
      reviewTasksCreated,
      nextSteps: [
        `POST /api/events/${ev.id}/ingest with {"adapterId":"usgs-earthquake"} to pull real hazard metadata`,
        `GET /api/events/${ev.id}/catalog to inspect sources`,
        `POST /api/events/${ev.id}/sitrep/generate to draft a grounded sitrep`,
      ],
    },
    ctx.requestId,
    201,
  );
}

export async function handleGetEvent(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const ev = await getOrgEvent(db, ctx.auth.user.orgId, routeParam(ctx, 'id'));
  const counts = {
    assets: await db.assetRecord.count({ where: { eventId: ev.id } }),
    runs: await db.ingestionRun.count({ where: { eventId: ev.id } }),
    reviewOpen: await db.reviewTask.count({ where: { eventId: ev.id, status: 'open' } }),
    reviewDecided: await db.reviewTask.count({ where: { eventId: ev.id, status: 'decided' } }),
    sitreps: await db.sitrepDraft.count({ where: { eventId: ev.id } }),
    exports: await db.exportArtifact.count({ where: { eventId: ev.id } }),
  };
  const draft = await db.sitrepDraft.findFirst({
    where: { eventId: ev.id },
    orderBy: { version: 'desc' },
  });
  return ok({ event: ev, counts, sitrep: draft ? { id: draft.id, version: draft.version, status: draft.status } : null }, ctx.requestId);
}

export async function handleEventStatus(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const ev = await getOrgEvent(db, ctx.auth.user.orgId, routeParam(ctx, 'id'));
  const body = await parseBody(
    ctx.req,
    // PATCH body: { status }
    (await import('zod')).z.object({ status: EventStatusSchema }),
  );
  const allowed = ALLOWED_TRANSITIONS[ev.status] ?? [];
  if (!allowed.includes(body.status)) {
    throw errors.conflict(
      `Illegal lifecycle transition ${ev.status} → ${body.status} (allowed: ${allowed.join(', ') || 'none'})`,
    );
  }
  const updated = await db.incidentEvent.update({
    where: { id: ev.id },
    data: { status: body.status, version: { increment: 1 } },
  });
  await appendAudit(db, {
    orgId: ev.orgId,
    actorId: ctx.auth.user.id,
    action: 'event.status_changed',
    entityType: 'incident-event',
    entityId: ev.id,
    payload: { from: ev.status, to: body.status },
  });
  return ok({ event: updated }, ctx.requestId);
}

export async function handleIngest(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const ev = await getOrgEvent(db, ctx.auth.user.orgId, routeParam(ctx, 'id'));
  const body = await parseBody(ctx.req, IngestSchema);
  const result = await runIngestion(db, {
    eventId: ev.id,
    orgId: ev.orgId,
    actorId: ctx.auth.user.id,
    adapterId: body.adapterId,
    params: body.params,
    aoi: { lat: ev.centerLat, lng: ev.centerLng, aoiKm: ev.aoiKm },
    timeWindow: {
      from: new Date(ev.incidentTime.getTime() - 7 * 86400_000).toISOString(),
      to: new Date().toISOString(),
    },
    country: ev.country,
  });
  // Lifecycle: first successful ingest moves draft → ingesting.
  if (result.status === 'succeeded' && ev.status === 'draft') {
    await db.incidentEvent.update({
      where: { id: ev.id },
      data: { status: 'ingesting' },
    });
  }
  return ok({ result, providers: providerManifest() }, ctx.requestId);
}

export async function handleCatalog(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const ev = await getOrgEvent(db, ctx.auth.user.orgId, routeParam(ctx, 'id'));
  const assets = await db.assetRecord.findMany({
    where: { eventId: ev.id },
    orderBy: { createdAt: 'desc' },
  });
  const runs = await db.ingestionRun.findMany({
    where: { eventId: ev.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const now = Date.now();
  const catalog = assets.map((a) => {
    const observed = a.acquiredAt ?? a.publishedAt ?? a.createdAt;
    const ageH = (now - observed.getTime()) / 3600_000;
    return {
      id: a.id,
      adapterId: a.adapterId,
      provider: a.provider,
      assetType: a.assetType,
      externalId: a.externalId,
      title: a.title,
      observedAt: observed.toISOString(),
      ageHours: Number(ageH.toFixed(1)),
      license: a.license,
      attribution: a.attribution,
      url: a.url,
      status: a.status,
      simulated: a.simulated,
      quality: JSON.parse(a.qualityJson) as Record<string, unknown>,
      geometry: a.geometryJson ? (JSON.parse(a.geometryJson) as unknown) : null,
      checksum: a.checksumSha256,
    };
  });
  return ok(
    {
      event: { id: ev.id, name: ev.name },
      catalog,
      ingestionRuns: runs.map((r) => ({
        id: r.id,
        adapterId: r.adapterId,
        status: r.status,
        attempts: r.attempts,
        stageLogs: r.stageLogsJson ? JSON.parse(r.stageLogsJson) : [],
        error: r.error,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
      })),
    },
    ctx.requestId,
  );
}

export async function handleLayer(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const ev = await getOrgEvent(db, ctx.auth.user.orgId, routeParam(ctx, 'id'));
  const layer = await buildEventLayer(db, ev);
  const { raw, decision, manifest } = layer;
  return ok(
    {
      event: {
        id: ev.id,
        name: ev.name,
        archetype: ev.archetype,
        status: ev.status,
        center: { lat: ev.centerLat, lng: ev.centerLng },
        aoiKm: ev.aoiKm,
        incidentTime: ev.incidentTime.toISOString(),
        demoLayer: ev.demoLayer,
      },
      demo: raw.demo ?? null,
      manifest: {
        version: manifest.version,
        weights: manifest.weights,
        normalization: manifest.normalization,
        exposureMethod: manifest.exposureMethod,
        missingPenalty: manifest.missingPenalty,
      },
      stats: decision.stats,
      zones: decision.zones.map((z) => ({
        id: z.id,
        rank: z.rank,
        tier: z.tier,
        need: Number(z.need.toFixed(4)),
        needLower: Number(z.needLower.toFixed(4)),
        needUpper: Number(z.needUpper.toFixed(4)),
        sensitivity: z.sensitivity,
        rankingUnstable: z.rankingUnstable,
        evidenceTier: z.evidenceTier,
        D: Number(z.D.toFixed(4)),
        Pexp: Number(z.Pexp.toFixed(4)),
        Iso: z.Iso,
        Crit: Number(z.Crit.toFixed(4)),
        buildings: z.buildings,
        destroyed: z.destroyed,
        major: z.major,
        minor: z.minor,
        population: Math.round(z.population),
        affectedPop: z.affectedPop,
        isolated: z.isolated,
        floodShareArea: Number(z.floodShareArea.toFixed(4)),
        dataQuality: Number(z.dataQuality.toFixed(3)),
        boundary: z.boundary,
        centroid: z.centroid,
      })),
      facilities: raw.facilities.map((f) => ({
        id: f.id,
        type: f.type,
        name: f.name,
        lat: f.lat,
        lng: f.lng,
        status: f.status,
        zone: f.zone,
        isolated: f.isolated,
        preTravelMin: Number.isFinite(f.preTravelMin) ? Math.round(f.preTravelMin) : null,
        postTravelMin: Number.isFinite(f.postTravelMin) ? Math.round(f.postTravelMin) : null,
      })),
      roads: raw.roads.map((r) => ({
        id: r.id,
        coords: r.coords,
        cls: r.cls,
        blocked: r.blocked,
        blockCause: r.blockCause,
        confidence: Number(r.confidence.toFixed(3)),
        closure: r.closure ?? null,
      })),
      floods: raw.floods.map((f) => ({
        id: f.id,
        ring: f.ring,
        depthClass: f.depthClass,
        areaKm2: Number(f.areaKm2.toFixed(2)),
        confidence: f.confidence,
        source: f.source,
      })),
      buildings: raw.buildings.map((b) => ({
        id: b.id,
        lat: b.lat,
        lng: b.lng,
        damage: b.damage,
        confidence: Number(b.confidence.toFixed(3)),
        zone: b.zone,
        reviewReason: b.reviewReason,
      })),
    },
    ctx.requestId,
  );
}
