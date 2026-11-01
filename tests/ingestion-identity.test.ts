/* Ingestion identity + concurrency + attempt-lifecycle tests (round 4).
 *
 * The round3 idempotency key hashed ONLY `params` — two requests with
 * different AOIs or time windows could replay each other's catalog. These
 * tests pin the COMPLETE request identity (AOI, time window, country,
 * nested params, key order) plus concurrency safety and the honest
 * attempt lifecycle. Runs against a throwaway SQLite database.
 */

import { beforeAll, afterAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const DB_PATH = resolve(import.meta.dir, 'fixtures/ingestion-identity.test.db');

let db: PrismaClient;

beforeAll(async () => {
  rmSync(DB_PATH, { force: true });
  const url = `file:${DB_PATH}`;
  process.env.DATABASE_URL = url;
  const { $ } = await import('bun');
  await $`bunx prisma db push --skip-generate --schema prisma/schema.prisma`.quiet();
  db = new PrismaClient({ datasourceUrl: url });
  await db.$connect();
});

afterAll(async () => {
  if (db) await db.$disconnect();
  rmSync(DB_PATH, { force: true });
});

async function seedOrgEvent() {
  const org = await db.organization.create({
    data: { slug: `ident-org-${Date.now()}`, name: 'Identity Org' },
  });
  const user = await db.user.create({
    data: { orgId: org.id, email: `ident-${Date.now()}@t.test`, name: 'Ident Tester', role: 'analyst' },
  });
  const ev = await db.incidentEvent.create({
    data: {
      orgId: org.id,
      name: `Identity Event ${Math.random().toString(36).slice(2, 6)}`,
      archetype: 'flood',
      status: 'draft',
      country: 'United States',
      location: 'Testville',
      centerLat: 41.977,
      centerLng: -91.665,
      aoiKm: 9,
      incidentTime: new Date('2025-06-16T12:00:00Z'),
      severity: 0.74,
      seed: 20250616,
      demoLayer: true,
      createdBy: user.id,
    },
  });
  return { org, user, ev };
}

/* ------------------------------------------------- canonical serialization */

describe('canonicalJson (stable request identity serialization)', () => {
  test('object key order is irrelevant', async () => {
    const { canonicalJson } = await import('@/lib/server/ingestion');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  test('nested object key order is irrelevant', async () => {
    const { canonicalJson } = await import('@/lib/server/ingestion');
    expect(canonicalJson({ a: { x: 1, y: [1, { p: 1, q: 2 }] } })).toBe(
      canonicalJson({ a: { y: [1, { q: 2, p: 1 }], x: 1 } }),
    );
  });

  test('different values still differ', async () => {
    const { canonicalJson } = await import('@/lib/server/ingestion');
    expect(canonicalJson({ a: { x: 1, y: 2 } })).not.toBe(canonicalJson({ a: { x: 1, y: 3 } }));
  });

  test('undefined and functions collapse to null (never throw)', async () => {
    const { canonicalJson } = await import('@/lib/server/ingestion');
    expect(canonicalJson({ a: undefined, b: () => 1, c: 1 })).toBe('{"a":null,"b":null,"c":1}');
  });
});

/* --------------------------------------------------- idempotency identity */

describe('ingestion idempotency key — complete request identity', () => {
  const base = {
    eventId: 'ev-1',
    adapterId: 'fixture-demo',
    params: { n: 3, filters: { minMag: 4.5, sources: ['usgs', 'isc'] } },
    aoi: { lat: 41.977, lng: -91.665, aoiKm: 9 },
    timeWindow: { from: '2025-06-01T00:00:00Z', to: '2025-06-30T00:00:00Z' },
    country: 'United States',
  };

  test('identical requests (reordered keys) share one key', async () => {
    const { ingestionIdempotencyKey } = await import('@/lib/server/ingestion');
    const reordered = {
      country: base.country,
      timeWindow: { to: base.timeWindow.to, from: base.timeWindow.from },
      aoi: { aoiKm: base.aoi.aoiKm, lng: base.aoi.lng, lat: base.aoi.lat },
      params: { filters: { sources: ['usgs', 'isc'], minMag: 4.5 }, n: 3 },
      adapterId: base.adapterId,
      eventId: base.eventId,
    };
    expect(ingestionIdempotencyKey(reordered)).toBe(ingestionIdempotencyKey(base));
  });

  test('changed AOI → different key', async () => {
    const { ingestionIdempotencyKey } = await import('@/lib/server/ingestion');
    expect(ingestionIdempotencyKey({ ...base, aoi: { ...base.aoi, lat: -1.29, aoiKm: 30 } })).not.toBe(
      ingestionIdempotencyKey(base),
    );
  });

  test('changed AOI radius alone → different key', async () => {
    const { ingestionIdempotencyKey } = await import('@/lib/server/ingestion');
    expect(ingestionIdempotencyKey({ ...base, aoi: { ...base.aoi, aoiKm: 12 } })).not.toBe(
      ingestionIdempotencyKey(base),
    );
  });

  test('changed time window → different key', async () => {
    const { ingestionIdempotencyKey } = await import('@/lib/server/ingestion');
    expect(
      ingestionIdempotencyKey({ ...base, timeWindow: { ...base.timeWindow, to: '2025-07-01T00:00:00Z' } }),
    ).not.toBe(ingestionIdempotencyKey(base));
  });

  test('changed country → different key', async () => {
    const { ingestionIdempotencyKey } = await import('@/lib/server/ingestion');
    expect(ingestionIdempotencyKey({ ...base, country: 'Kenya' })).not.toBe(ingestionIdempotencyKey(base));
  });

  test('missing country (undefined) equals explicit null — but differs from a value', async () => {
    const { ingestionIdempotencyKey } = await import('@/lib/server/ingestion');
    const { country: _omit, ...noCountry } = base;
    expect(ingestionIdempotencyKey(noCountry)).toBe(ingestionIdempotencyKey({ ...base, country: undefined }));
    expect(ingestionIdempotencyKey(noCountry)).not.toBe(ingestionIdempotencyKey(base));
  });

  test('nested param content change → different key', async () => {
    const { ingestionIdempotencyKey } = await import('@/lib/server/ingestion');
    expect(
      ingestionIdempotencyKey({ ...base, params: { ...base.params, filters: { minMag: 4.6, sources: ['usgs', 'isc'] } } }),
    ).not.toBe(ingestionIdempotencyKey(base));
  });
});

/* ------------------------------------------- end-to-end identity semantics */

describe('runIngestion — identity semantics against the catalog', () => {
  test('changed AOI creates a NEW successful run (no stale replay)', async () => {
    const { runIngestion } = await import('@/lib/server/ingestion');
    const { registerFixtureAdapter } = await import('./fixtures/fixture-adapter');
    registerFixtureAdapter();
    const { org, user, ev } = await seedOrgEvent();

    const base = {
      eventId: ev.id,
      orgId: org.id,
      actorId: user.id,
      adapterId: 'fixture-demo',
      params: { n: 3 },
      aoi: { lat: ev.centerLat, lng: ev.centerLng, aoiKm: ev.aoiKm },
      timeWindow: { from: '2025-06-01T00:00:00Z', to: '2025-06-30T00:00:00Z' },
      country: ev.country,
    };
    const r1 = await runIngestion(db, base);
    expect(r1.status).toBe('succeeded');

    // Same event, DIFFERENT AOI → must run again, not replay.
    const r2 = await runIngestion(db, { ...base, aoi: { lat: -1.29, lng: 36.82, aoiKm: 30 } });
    expect(r2.status).toBe('succeeded');
    expect(r2.runId).not.toBe(r1.runId);

    // Same request again → replay.
    const r3 = await runIngestion(db, { ...base, aoi: { lat: -1.29, lng: 36.82, aoiKm: 30 } });
    expect(r3.status).toBe('replayed');
    expect(r3.runId).toBe(r2.runId);
  });

  test('changed time window creates a NEW run (no stale replay)', async () => {
    const { runIngestion } = await import('@/lib/server/ingestion');
    const { registerFixtureAdapter } = await import('./fixtures/fixture-adapter');
    registerFixtureAdapter();
    const { org, user, ev } = await seedOrgEvent();

    const base = {
      eventId: ev.id,
      orgId: org.id,
      actorId: user.id,
      adapterId: 'fixture-demo',
      params: { n: 2 },
      aoi: { lat: ev.centerLat, lng: ev.centerLng, aoiKm: ev.aoiKm },
      timeWindow: { from: '2025-06-01T00:00:00Z', to: '2025-06-30T00:00:00Z' },
      country: ev.country,
    };
    const r1 = await runIngestion(db, base);
    const r2 = await runIngestion(db, {
      ...base,
      timeWindow: { from: '2025-07-01T00:00:00Z', to: '2025-07-31T00:00:00Z' },
    });
    expect(r1.status).toBe('succeeded');
    expect(r2.status).toBe('succeeded');
    expect(r2.runId).not.toBe(r1.runId);
  });

  test('changed country creates a NEW run (no stale replay)', async () => {
    const { runIngestion } = await import('@/lib/server/ingestion');
    const { registerFixtureAdapter } = await import('./fixtures/fixture-adapter');
    registerFixtureAdapter();
    const { org, user, ev } = await seedOrgEvent();

    const base = {
      eventId: ev.id,
      orgId: org.id,
      actorId: user.id,
      adapterId: 'fixture-demo',
      params: { n: 2 },
      aoi: { lat: ev.centerLat, lng: ev.centerLng, aoiKm: ev.aoiKm },
      timeWindow: { from: '2025-06-01T00:00:00Z', to: '2025-06-30T00:00:00Z' },
      country: 'United States',
    };
    const r1 = await runIngestion(db, base);
    const r2 = await runIngestion(db, { ...base, country: 'Kenya' });
    expect(r1.status).toBe('succeeded');
    expect(r2.status).toBe('succeeded');
    expect(r2.runId).not.toBe(r1.runId);
  });
});

/* ------------------------------------------- handler window quantization */

describe('ingestWindowFor — stable derived window (handler-level retries)', () => {
  test('returns the SAME window for repeated calls within an hour', async () => {
    const { ingestWindowFor } = await import('@/server/api/events');
    const ev = { incidentTime: new Date('2025-06-16T12:00:00Z') };
    const a = ingestWindowFor(ev);
    const b = ingestWindowFor(ev);
    expect(a).toEqual(b);
    // Upper bound is quantized to the hour (stable, not wall-clock now).
    expect(new Date(a.to).getUTCMinutes()).toBe(0);
    expect(new Date(a.to).getUTCSeconds()).toBe(0);
    expect(new Date(a.to).getUTCMilliseconds()).toBe(0);
  });

  test('from is anchored to the event, not the clock', async () => {
    const { ingestWindowFor } = await import('@/server/api/events');
    const { from } = ingestWindowFor({ incidentTime: new Date('2025-06-16T12:00:00Z') });
    expect(from).toBe('2025-06-09T12:00:00.000Z');
  });
});

/* ---------------------------------------------------------- concurrency */

describe('runIngestion — concurrent duplicate requests', () => {
  test('exactly one provider call; the duplicate gets already_running', async () => {
    const { runIngestion } = await import('@/lib/server/ingestion');
    const { registerSlowAdapter } = await import('./fixtures/slow-adapter');
    const state = { delayMs: 400, discoverCalls: 0 };
    registerSlowAdapter(state);
    const { org, user, ev } = await seedOrgEvent();

    const base = {
      eventId: ev.id,
      orgId: org.id,
      actorId: user.id,
      adapterId: 'slow-test',
      params: {},
      aoi: { lat: ev.centerLat, lng: ev.centerLng, aoiKm: ev.aoiKm },
      timeWindow: { from: '2025-06-01T00:00:00Z', to: '2025-06-30T00:00:00Z' },
      country: ev.country,
    };

    const [a, b] = await Promise.all([
      runIngestion(db, base),
      runIngestion(db, { ...base, params: {} }), // same canonical identity
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toContain('succeeded');
    expect(statuses).toEqual(['already_running', 'succeeded']);
    // The provider was called EXACTLY once — no duplicate work.
    expect(state.discoverCalls).toBe(1);

    // And the catalog holds exactly one asset from the single call.
    const count = await db.assetRecord.count({ where: { eventId: ev.id, adapterId: 'slow-test' } });
    expect(count).toBe(1);
  });
});

/* ------------------------------------------------------ attempt lifecycle */

describe('runIngestion — attempt lifecycle honesty', () => {
  test('attempt is created running (ok=null) and finalized ok=true on success', async () => {
    const { runIngestion } = await import('@/lib/server/ingestion');
    const { registerSlowAdapter } = await import('./fixtures/slow-adapter');
    const state = { delayMs: 250, discoverCalls: 0 };
    registerSlowAdapter(state);
    const { org, user, ev } = await seedOrgEvent();

    const base = {
      eventId: ev.id,
      orgId: org.id,
      actorId: user.id,
      adapterId: 'slow-test',
      params: {},
      aoi: { lat: ev.centerLat, lng: ev.centerLng, aoiKm: ev.aoiKm },
      timeWindow: { from: '2025-06-01T00:00:00Z', to: '2025-06-30T00:00:00Z' },
      country: ev.country,
    };

    const inflight = runIngestion(db, base);
    // While discover is sleeping, the attempt must read ok=null (running),
    // never a premature success.
    await new Promise((r) => setTimeout(r, 120));
    const runs = await db.ingestionRun.findMany({
      where: { eventId: ev.id, adapterId: 'slow-test' },
      include: { attemptsLog: true },
    });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('running');
    expect(runs[0].attemptsLog).toHaveLength(1);
    expect(runs[0].attemptsLog[0].ok).toBeNull();
    expect(runs[0].attemptsLog[0].finishedAt).toBeNull();
    expect(runs[0].attemptsLog[0].correlationId).toBeTruthy();

    const result = await inflight;
    expect(result.status).toBe('succeeded');

    const finalized = await db.ingestionAttempt.findMany({ where: { runId: result.runId } });
    expect(finalized).toHaveLength(1);
    expect(finalized[0].ok).toBe(true);
    expect(finalized[0].finishedAt).not.toBeNull();
    expect(finalized[0].stage).toBe('succeeded');
    expect(finalized[0].latencyMs).not.toBeNull();
  });

  test('failed attempt is finalized ok=false with stage, error, retryable, finishedAt', async () => {
    const { runIngestion } = await import('@/lib/server/ingestion');
    const { flakyFetchAdapter, registerAdapterLocal } = await import('./fixtures/flaky-adapter');
    // ONE shared state object: registration is idempotent (registry keeps the
    // first instance), so flipping `fails` is how retry-after-failure is driven.
    const flaky = { fails: true };
    registerAdapterLocal(flakyFetchAdapter(flaky));
    const { org, user, ev } = await seedOrgEvent();

    let runId = '';
    try {
      await runIngestion(db, {
        eventId: ev.id,
        orgId: org.id,
        actorId: user.id,
        adapterId: 'flaky-test',
        params: {},
        aoi: { lat: ev.centerLat, lng: ev.centerLng, aoiKm: ev.aoiKm },
        timeWindow: { from: '2025-06-01T00:00:00Z', to: '2025-06-30T00:00:00Z' },
        country: ev.country,
      });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain('temporarily unavailable');
    }
    const runs = await db.ingestionRun.findMany({
      where: { eventId: ev.id, adapterId: 'flaky-test' },
      include: { attemptsLog: true },
    });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('failed');
    const attempt = runs[0].attemptsLog[0];
    expect(attempt.ok).toBe(false);
    expect(attempt.finishedAt).not.toBeNull();
    expect(attempt.stage).toBe('discover');
    expect(attempt.error).toContain('temporarily unavailable');
    expect(attempt.retryable).toBe(true);
    runId = runs[0].id;

    // Failed run is re-attemptable (attempt counter increments).
    flaky.fails = false;
    const r2 = await runIngestion(db, {
      eventId: ev.id,
      orgId: org.id,
      actorId: user.id,
      adapterId: 'flaky-test',
      params: {},
      aoi: { lat: ev.centerLat, lng: ev.centerLng, aoiKm: ev.aoiKm },
      timeWindow: { from: '2025-06-01T00:00:00Z', to: '2025-06-30T00:00:00Z' },
      country: ev.country,
    });
    expect(r2.status).toBe('succeeded');
    expect(r2.attempts).toBe(2);
    const attempts = await db.ingestionAttempt.findMany({
      where: { runId },
      orderBy: { attemptNo: 'asc' },
    });
    expect(attempts).toHaveLength(2);
    expect(attempts[0].ok).toBe(false);
    expect(attempts[1].ok).toBe(true);
  });
});
