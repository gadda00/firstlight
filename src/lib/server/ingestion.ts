/* ==========================================================================
 * FirstLight — ingestion orchestration (Phase 2).
 *
 * Runs one adapter end-to-end for an event:
 *   discover → acquire(reference/buffer) → validate → normalize → catalog
 *
 * Guarantees:
 *  - IDEMPOTENT: an idempotency key (eventId + adapterId + param digest)
 *    makes re-running the same request replay the original run instead of
 *    duplicating provider calls or catalog rows.
 *  - RETRIED + OBSERVED: every attempt (ok / http status / latency / error)
 *    is an immutable IngestionAttempt row; the run carries a structured
 *    stage log surfaced by the catalog UI.
 *  - BOUNDED: adapter-level caps (AOI bbox, element counts, byte limits)
 *    plus the http-client limits.
 *  - HONEST: validation failures mark records failed (never silently
 *    dropped or promoted); BlockedDependencyError propagates as a 503 with
 *    the missing dependency named.
 * ========================================================================== */

import { createHash } from 'node:crypto';
import type { PrismaClient, AssetRecord } from '@prisma/client';
import { appendAudit } from './audit';
import { errors } from './http';
import { adapterById } from './adapters/registry';
import { BlockedDependencyError } from './adapters/types';

export interface IngestResult {
  runId: string;
  adapterId: string;
  status: 'succeeded' | 'failed' | 'replayed';
  attempts: number;
  assetsUpserted: number;
  assetsFailed: number;
  stageLogs: Array<{ stage: string; status: string; detail: string; ms: number }>;
  error?: string;
  blockedBy?: string;
}

function paramDigest(params: Record<string, unknown>): string {
  const keys = Object.keys(params).sort();
  const canonical = keys.map((k) => `${k}=${String(params[k])}`).join('|');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export async function runIngestion(
  db: PrismaClient,
  input: {
    eventId: string;
    orgId: string;
    actorId: string;
    adapterId: string;
    params: Record<string, unknown>;
    aoi: { lat: number; lng: number; aoiKm: number };
    timeWindow: { from: string; to: string };
    country?: string;
  },
): Promise<IngestResult> {
  const adapter = adapterById(input.adapterId);
  if (!adapter) {
    throw errors.badRequest(
      `Unknown adapter '${input.adapterId}' — see GET /api/meta for the provider manifest`,
    );
  }
  const idempotencyKey = `${input.eventId}:${input.adapterId}:${paramDigest(input.params)}`;

  const existing = await db.ingestionRun.findUnique({ where: { idempotencyKey } });
  // IDEMPOTENCY SEMANTICS: only SUCCEEDED runs are replayed. A failed run
  // (provider error, blocked dependency) is re-attemptable — replaying a
  // failure would hide transient outages and block the FIRMS-style
  // "blocked until configured" path forever.
  if (existing && existing.status === 'succeeded') {
    const assets = await db.assetRecord.count({ where: { eventId: input.eventId, adapterId: input.adapterId } });
    return {
      runId: existing.id,
      adapterId: input.adapterId,
      status: 'replayed',
      attempts: existing.attempts,
      assetsUpserted: assets,
      assetsFailed: 0,
      stageLogs: existing.stageLogsJson ? JSON.parse(existing.stageLogsJson) : [],
    };
  }

  const run = existing
    ? await db.ingestionRun.update({
        where: { id: existing.id },
        data: { status: 'running', attempts: { increment: 1 }, error: null, stageLogsJson: null, finishedAt: null },
      })
    : await db.ingestionRun.create({
        data: {
          eventId: input.eventId,
          adapterId: input.adapterId,
          idempotencyKey,
          status: 'running',
          attempts: 0,
        },
      });

  const stageLogs: IngestResult['stageLogs'] = [];
  const attemptNo = run.attempts || 1;
  const t0 = Date.now();
  const mark = (stage: string, status: string, detail: string) =>
    stageLogs.push({ stage, status, detail, ms: Date.now() - t0 });

  try {
    await db.ingestionAttempt.create({
      data: { runId: run.id, attemptNo, ok: true, startedAt: new Date() },
    });
    await db.ingestionRun.update({
      where: { id: run.id },
      data: { attempts: attemptNo },
    });

    mark('discover', 'running', `${adapter.label}`);
    const discovered = await adapter.discover(
      {
        eventId: input.eventId,
        aoi: input.aoi,
        timeWindow: input.timeWindow,
        params: { ...input.params, ...(input.country ? { country: input.country } : {}) },
      },
    );
    mark('discover', 'ok', `${discovered.length} asset(s) discovered`);

    let upserted = 0;
    let failed = 0;
    for (const asset of discovered) {
      const acquired = await adapter.acquire(asset, {
        mode: 'reference',
        maxBytes: 2 * 1024 * 1024,
      });
      const report = await adapter.validate(asset, acquired);
      if (!report.ok) {
        failed++;
        mark(
          'validate',
          'failed',
          `${asset.externalId}: ${report.checks.filter((c) => !c.ok).map((c) => c.name).join(', ')}`,
        );
        continue;
      }
      const products = await adapter.normalize(asset, acquired, {
        eventId: input.eventId,
        orgId: input.orgId,
      });
      for (const p of products) {
        await upsertEventAsset(db, input.eventId, p);
        upserted++;
      }
    }
    mark('validate+normalize', 'ok', `${upserted} validated, ${failed} failed`);

    const stageLogsJson = JSON.stringify(stageLogs);
    await db.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: 'succeeded',
        finishedAt: new Date(),
        stageLogsJson,
      },
    });
    await appendAudit(db, {
      orgId: input.orgId,
      actorId: input.actorId,
      action: 'ingestion.run',
      entityType: 'ingestion-run',
      entityId: run.id,
      payload: {
        adapterId: input.adapterId,
        eventId: input.eventId,
        discovered: discovered.length,
        upserted,
        failed,
      },
    });

    return {
      runId: run.id,
      adapterId: input.adapterId,
      status: 'succeeded',
      attempts: attemptNo,
      assetsUpserted: upserted,
      assetsFailed: failed,
      stageLogs,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const blocked = err instanceof BlockedDependencyError;
    mark('discover', 'failed', message);
    await db.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        error: message,
        stageLogsJson: JSON.stringify(stageLogs),
      },
    });
    await db.ingestionAttempt.updateMany({
      where: { runId: run.id, attemptNo },
      data: { ok: false, error: message },
    });
    if (blocked) {
      throw errors.blockedDependency(
        `${input.adapterId} is blocked: ${message}`,
      );
    }
    throw errors.upstream(message, true);
  }
}

/** Upsert a normalized product into the event catalog (dedupe by
 *  eventId+adapterId+externalId — the provider-native identity). */
export async function upsertEventAsset(
  db: PrismaClient,
  eventId: string,
  product: {
    adapterId: string;
    provider: string;
    assetType: string;
    externalId: string;
    title: string;
    acquiredAt: Date | null;
    publishedAt: Date | null;
    license: string;
    attribution: string | null;
    url: string | null;
    checksumSha256: string | null;
    sizeBytes: number | null;
    quality: Record<string, unknown>;
    geometry: unknown;
    status: string;
    simulated: boolean;
  },
): Promise<AssetRecord> {
  return db.assetRecord.upsert({
    where: {
      eventId_adapterId_externalId: {
        eventId,
        adapterId: product.adapterId,
        externalId: product.externalId,
      },
    },
    create: {
      eventId,
      adapterId: product.adapterId,
      provider: product.provider,
      assetType: product.assetType,
      externalId: product.externalId,
      title: product.title,
      acquiredAt: product.acquiredAt,
      publishedAt: product.publishedAt,
      license: product.license,
      attribution: product.attribution,
      url: product.url,
      checksumSha256: product.checksumSha256,
      sizeBytes: product.sizeBytes,
      qualityJson: JSON.stringify(product.quality),
      geometryJson: product.geometry ? JSON.stringify(product.geometry) : null,
      status: product.status,
      simulated: product.simulated,
    },
    update: {
      title: product.title,
      acquiredAt: product.acquiredAt,
      publishedAt: product.publishedAt,
      qualityJson: JSON.stringify(product.quality),
      geometryJson: product.geometry ? JSON.stringify(product.geometry) : null,
      status: product.status,
      url: product.url,
      checksumSha256: product.checksumSha256,
      sizeBytes: product.sizeBytes,
    },
  });
}
