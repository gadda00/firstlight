/* ==========================================================================
 * FirstLight — ingestion orchestration (Phase 2, hardened round 4).
 *
 * Runs one adapter end-to-end for an event:
 *   discover → acquire(reference/buffer) → validate → normalize → catalog
 *
 * Guarantees:
 *  - IDEMPOTENT with COMPLETE request identity: the idempotency key is a
 *    SHA-256 over the canonical JSON of {eventId, adapterId, params, aoi,
 *    timeWindow, country, contractVersion}. Two requests that differ in ANY
 *    of those fields are DIFFERENT runs — a changed AOI or time window can
 *    never replay a stale catalog. Key order inside `params` is irrelevant
 *    (canonical serialization sorts keys recursively).
 *  - CONCURRENCY-SAFE: run creation is create-or-reuse guarded by the unique
 *    idempotency key; a run already RUNNING is never duplicated — callers
 *    receive `already_running` with the run id for polling. Failed runs are
 *    re-attemptable up to MAX_ATTEMPTS; a stale RUNNING run (crashed worker,
 *    lease older than RUNNING_LEASE_MS) may be taken over.
 *  - HONEST attempt lifecycle: attempts are created `ok: null` (running) and
 *    finalized exactly once in a finally-path with stage, HTTP status,
 *    retryability, latency and a correlation id. A crash mid-run can never
 *    leave a false success behind.
 *  - TRANSACTIONAL catalog: all validated products for a run are upserted in
 *    ONE database transaction — no partial catalog states.
 *  - BOUNDED: adapter-level caps (AOI bbox, element counts, byte limits)
 *    plus the http-client limits; MAX_ATTEMPTS caps provider call volume.
 *  - HONEST results: validation failures mark records failed (never silently
 *    dropped or promoted); BlockedDependencyError propagates as a 503 with
 *    the missing dependency named.
 * ========================================================================== */

import { createHash } from 'node:crypto';
import type { PrismaClient, AssetRecord } from '@prisma/client';
import { appendAudit } from './audit';
import { errors, ApiHttpError } from './http';
import { adapterById } from './adapters/registry';
import { BlockedDependencyError } from './adapters/types';

/** Bump when ingestion request semantics change (new identity fields,
 *  changed catalog behavior) so old idempotency keys never collide. */
export const INGESTION_CONTRACT_VERSION = 2;

/** Provider-call volume cap per (event, adapter, request-identity). */
const MAX_ATTEMPTS = 5;

/** A RUNNING run whose lease (updatedAt heartbeat) is older than this is
 *  considered abandoned (crashed worker) and may be taken over. Adapter
 *  calls are bounded well below this (http-client timeout 12–30 s × few
 *  retries), so a live run never loses its lease in practice. */
const RUNNING_LEASE_MS = 10 * 60 * 1000;

export interface IngestResult {
  runId: string;
  adapterId: string;
  status: 'succeeded' | 'failed' | 'replayed' | 'already_running' | 'dead';
  attempts: number;
  assetsUpserted: number;
  assetsFailed: number;
  stageLogs: Array<{ stage: string; status: string; detail: string; ms: number }>;
  error?: string;
  blockedBy?: string;
}

/* ------------------------------------------------------- canonical identity */

/** Deterministic JSON serialization: object keys sorted recursively, only
 *  JSON scalar/array/object values. NOT equivalent to JSON.stringify for
 *  key order — that is the point (request identity must not depend on it). */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  // Functions/symbols/undefined are not request identity — collapse to null.
  return 'null';
}

/** Full request identity → stable idempotency key. */
export function ingestionIdempotencyKey(input: {
  eventId: string;
  adapterId: string;
  params: Record<string, unknown>;
  aoi: { lat: number; lng: number; aoiKm: number };
  timeWindow: { from: string; to: string };
  country?: string;
}): string {
  const identity = {
    eventId: input.eventId,
    adapterId: input.adapterId,
    params: input.params ?? {},
    aoi: input.aoi,
    timeWindow: input.timeWindow,
    country: input.country ?? null,
    contractVersion: INGESTION_CONTRACT_VERSION,
  };
  return createHash('sha256').update(canonicalJson(identity)).digest('hex').slice(0, 32);
}

/** Prisma unique-constraint violation (P2002) — the concurrency signal. */
function isUniqueViolation(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'code' in (err as Record<string, unknown>) &&
    (err as { code?: string }).code === 'P2002'
  );
}

/** Best-effort HTTP status extraction for attempt records. */
function httpStatusOf(err: unknown): number | null {
  if (err instanceof ApiHttpError) return err.status;
  return null;
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
  const idempotencyKey = ingestionIdempotencyKey(input);

  /* ------------------------------------------ atomic create-or-reuse (lease) */
  let run: { id: string; attempts: number; status: string } | null = null;
  let replay: IngestResult | null = null;

  try {
    // Fast path: WE are the first request for this identity.
    run = await db.ingestionRun.create({
      data: {
        eventId: input.eventId,
        adapterId: input.adapterId,
        idempotencyKey,
        status: 'running',
        attempts: 1,
      },
      select: { id: true, attempts: true, status: true },
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Someone already owns this identity — replay, poll, or take over.
    const existing = await db.ingestionRun.findUnique({ where: { idempotencyKey } });
    if (!existing) {
      // Extremely unlikely (row deleted between conflict and read) — retry create.
      run = await db.ingestionRun.create({
        data: {
          eventId: input.eventId,
          adapterId: input.adapterId,
          idempotencyKey,
          status: 'running',
          attempts: 1,
        },
        select: { id: true, attempts: true, status: true },
      });
    } else if (existing.status === 'succeeded') {
      // IDEMPOTENCY SEMANTICS: only SUCCEEDED runs are replayed. A failed run
      // is re-attemptable — replaying a failure would hide transient outages
      // and block the FIRMS-style "blocked until configured" path forever.
      const assets = await db.assetRecord.count({
        where: { eventId: input.eventId, adapterId: input.adapterId },
      });
      replay = {
        runId: existing.id,
        adapterId: input.adapterId,
        status: 'replayed',
        attempts: existing.attempts,
        assetsUpserted: assets,
        assetsFailed: 0,
        stageLogs: existing.stageLogsJson ? JSON.parse(existing.stageLogsJson) : [],
      };
    } else if (existing.status === 'dead' || existing.attempts >= MAX_ATTEMPTS) {
      await db.ingestionRun.update({
        where: { id: existing.id },
        data: { status: 'dead', finishedAt: existing.finishedAt ?? new Date() },
      });
      replay = {
        runId: existing.id,
        adapterId: input.adapterId,
        status: 'dead',
        attempts: existing.attempts,
        assetsUpserted: 0,
        assetsFailed: 0,
        stageLogs: existing.stageLogsJson ? JSON.parse(existing.stageLogsJson) : [],
        error: `Run is dead: ${existing.attempts} attempts (max ${MAX_ATTEMPTS}) — last error: ${existing.error ?? 'unknown'}`,
      };
    } else if (existing.status === 'running') {
      const leaseAge = Date.now() - existing.updatedAt.getTime();
      if (leaseAge < RUNNING_LEASE_MS) {
        // A live worker owns this run — NEVER duplicate provider calls.
        replay = {
          runId: existing.id,
          adapterId: input.adapterId,
          status: 'already_running',
          attempts: existing.attempts,
          assetsUpserted: 0,
          assetsFailed: 0,
          stageLogs: [],
          error: `Run ${existing.id} is already running (attempt ${existing.attempts}); poll the catalog for results`,
        };
      }
      // Stale lease (crashed worker) — take over below via guarded update.
    }
    if (!replay && existing) {
      // Take over a failed/stale-running run ATOMICALLY: the guarded
      // updateMany only lands if the state is still what we read — two
      // concurrent takers cannot both win.
      const claimed = await db.ingestionRun.updateMany({
        where: { id: existing.id, status: existing.status, attempts: existing.attempts },
        data: { status: 'running', attempts: { increment: 1 }, error: null, stageLogsJson: null, finishedAt: null },
      });
      if (claimed.count === 0) {
        // Lost the race — the winner is running it; do not duplicate work.
        const fresh = await db.ingestionRun.findUnique({ where: { idempotencyKey } });
        replay = {
          runId: existing.id,
          adapterId: input.adapterId,
          status: fresh?.status === 'succeeded' ? 'replayed' : 'already_running',
          attempts: fresh?.attempts ?? existing.attempts,
          assetsUpserted: 0,
          assetsFailed: 0,
          stageLogs: [],
        };
      } else {
        run = { id: existing.id, attempts: existing.attempts + 1, status: 'running' };
      }
    }
    if (replay) return replay;
  }

  if (!run) throw errors.upstream('ingestion run could not be established', true);

  const runId = run.id;
  const attemptNo = run.attempts;
  const correlationId = `ingest:${runId.slice(-8)}:${attemptNo}`;
  const stageLogs: IngestResult['stageLogs'] = [];
  const t0 = Date.now();
  const mark = (stage: string, status: string, detail: string) =>
    stageLogs.push({ stage, status, detail, ms: Date.now() - t0 });

  // Attempt row: created RUNNING (ok: null) BEFORE any provider call, and
  // finalized exactly once in the finally-block below.
  const attempt = await db.ingestionAttempt.create({
    data: { runId, attemptNo, ok: null, stage: 'running', correlationId, startedAt: new Date(t0) },
  });
  let finalized = false;
  let terminalError: unknown = null;
  let terminalStage = 'discover';
  let terminalRetryable: boolean | null = null;

  const finalizeAttempt = async (result: {
    ok: boolean;
    stage: string;
    error?: string;
    retryable?: boolean;
    httpStatus?: number | null;
  }): Promise<void> => {
    if (finalized) return; // exactly-once finalization
    finalized = true;
    await db.ingestionAttempt
      .update({
        where: { id: attempt.id },
        data: {
          ok: result.ok,
          stage: result.stage,
          error: result.error ?? null,
          retryable: result.retryable ?? null,
          httpStatus: result.httpStatus ?? null,
          latencyMs: Date.now() - t0,
          finishedAt: new Date(),
        },
      })
      .catch(() => undefined); // audit-path failure must not mask the result
  };

  try {
    mark('discover', 'running', `${adapter.label} (correlation ${correlationId})`);
    const discovered = await adapter.discover(
      {
        eventId: input.eventId,
        aoi: input.aoi,
        timeWindow: input.timeWindow,
        params: { ...input.params, ...(input.country ? { country: input.country } : {}) },
      },
    );
    mark('discover', 'ok', `${discovered.length} asset(s) discovered`);
    terminalStage = 'acquire';

    // Validate + normalize OUTSIDE the write transaction (adapter IO), then
    // persist the whole batch atomically — no partial catalog states.
    const batch: Array<{
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
    }> = [];
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
      batch.push(...products);
    }
    terminalStage = 'catalog';

    await db.$transaction(
      batch.map((p) =>
        db.assetRecord.upsert({
          where: {
            eventId_adapterId_externalId: {
              eventId: input.eventId,
              adapterId: p.adapterId,
              externalId: p.externalId,
            },
          },
          create: {
            eventId: input.eventId,
            adapterId: p.adapterId,
            provider: p.provider,
            assetType: p.assetType,
            externalId: p.externalId,
            title: p.title,
            acquiredAt: p.acquiredAt,
            publishedAt: p.publishedAt,
            license: p.license,
            attribution: p.attribution,
            url: p.url,
            checksumSha256: p.checksumSha256,
            sizeBytes: p.sizeBytes,
            qualityJson: JSON.stringify(p.quality),
            geometryJson: p.geometry ? JSON.stringify(p.geometry) : null,
            status: p.status,
            simulated: p.simulated,
          },
          update: {
            title: p.title,
            acquiredAt: p.acquiredAt,
            publishedAt: p.publishedAt,
            qualityJson: JSON.stringify(p.quality),
            geometryJson: p.geometry ? JSON.stringify(p.geometry) : null,
            status: p.status,
            url: p.url,
            checksumSha256: p.checksumSha256,
            sizeBytes: p.sizeBytes,
          },
        }),
      ),
    );
    mark('validate+normalize+catalog', 'ok', `${batch.length} validated, ${failed} failed`);

    const stageLogsJson = JSON.stringify(stageLogs);
    await db.ingestionRun.update({
      where: { id: runId },
      data: { status: 'succeeded', finishedAt: new Date(), stageLogsJson },
    });
    await finalizeAttempt({ ok: true, stage: 'succeeded' });
    await appendAudit(db, {
      orgId: input.orgId,
      actorId: input.actorId,
      action: 'ingestion.run',
      entityType: 'ingestion-run',
      entityId: runId,
      payload: {
        adapterId: input.adapterId,
        eventId: input.eventId,
        discovered: discovered.length,
        upserted: batch.length,
        failed,
        attempt: attemptNo,
        correlationId,
      },
    });

    return {
      runId,
      adapterId: input.adapterId,
      status: 'succeeded',
      attempts: attemptNo,
      assetsUpserted: batch.length,
      assetsFailed: failed,
      stageLogs,
    };
  } catch (err) {
    terminalError = err;
    const message = err instanceof Error ? err.message : String(err);
    const blocked = err instanceof BlockedDependencyError;
    terminalRetryable = !blocked;
    terminalStage = blocked ? 'discover' : terminalStage;
    mark(terminalStage, 'failed', message);
    await db.ingestionRun
      .update({
        where: { id: runId },
        data: {
          status: attemptNo >= MAX_ATTEMPTS ? 'dead' : 'failed',
          finishedAt: new Date(),
          error: message,
          stageLogsJson: JSON.stringify(stageLogs),
        },
      })
      .catch(() => undefined);
    await finalizeAttempt({
      ok: false,
      stage: terminalStage,
      error: message,
      retryable: terminalRetryable,
      httpStatus: httpStatusOf(err),
    });
    if (blocked) {
      throw errors.blockedDependency(`${input.adapterId} is blocked: ${message}`);
    }
    throw errors.upstream(message, true);
  } finally {
    // Belt-and-braces: if no explicit finalization happened (unexpected
    // throw between create and try), the attempt must not stay "running".
    if (!finalized) {
      await finalizeAttempt({
        ok: false,
        stage: terminalStage,
        error: terminalError instanceof Error ? terminalError.message : 'unexpected termination',
        retryable: terminalRetryable ?? undefined,
        httpStatus: httpStatusOf(terminalError),
      }).catch(() => undefined);
    }
  }
}

/** Upsert a normalized product into the event catalog (dedupe by
 *  eventId+adapterId+externalId — the provider-native identity).
 *  Kept for callers outside runIngestion; runIngestion itself batches all
 *  upserts in one transaction. */
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
