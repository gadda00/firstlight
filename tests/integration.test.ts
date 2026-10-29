/* Integration tests — audit chain, ingestion idempotency, review concurrency,
 * sitrep freeze, bundle validation, RBAC/tenancy.
 *
 * Runs against a THROWAWAY SQLite database (tests/fixtures/test.db),
 * pushed fresh on every run. No network access: adapter calls use injected
 * fixture fetch implementations.
 */

import { beforeAll, afterAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const DB_PATH = resolve(import.meta.dir, 'fixtures/integration.test.db');

let db: PrismaClient;

beforeAll(async () => {
  rmSync(DB_PATH, { force: true });
  const url = `file:${DB_PATH}`;
  process.env.DATABASE_URL = url;
  // Push schema via programmatic prisma isn't available; we require the
  // caller (bun test) to have run `prisma db push` first. The helper below
  // shells out once.
  const { $ } = await import('bun');
  await $`bunx prisma db push --skip-generate --schema prisma/schema.prisma`.quiet();
  db = new PrismaClient({ datasourceUrl: url });
  await db.$connect();
});

afterAll(async () => {
  if (db) await db.$disconnect();
  rmSync(DB_PATH, { force: true });
});

/* ------------------------------------------------------------------ helpers */

async function seedOrg() {
  return db.organization.create({
    data: { slug: `test-org-${Date.now()}`, name: 'Test Org' },
  });
}

async function seedUser(orgId: string, role: string) {
  return db.user.create({
    data: { orgId, email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@t.test`, name: `Test ${role}`, role },
  });
}

async function seedEvent(orgId: string, userId: string) {
  return db.incidentEvent.create({
    data: {
      orgId,
      name: `Test Event ${Math.random().toString(36).slice(2, 6)}`,
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
      createdBy: userId,
    },
  });
}

/* --------------------------------------------------------------- audit chain */

describe('audit hash chain (SHA-256)', () => {
  test('appendAudit creates a gap-free, verifiable chain', async () => {
    const { appendAudit, verifyAuditChain } = await import('@/lib/server/audit');
    const org = await seedOrg();
    for (let i = 0; i < 5; i++) {
      await appendAudit(db, {
        orgId: org.id,
        action: 'event.created',
        entityType: 'incident-event',
        entityId: `ev-${i}`,
        payload: { i },
      });
    }
    const v = await verifyAuditChain(db, org.id);
    expect(v.ok).toBe(true);
    expect(v.events).toBe(5);
    expect(v.firstBrokenSeq).toBeNull();
  });

  test('tampering with a payload breaks verification at that seq', async () => {
    const { appendAudit, verifyAuditChain } = await import('@/lib/server/audit');
    const org = await seedOrg();
    for (let i = 0; i < 3; i++) {
      await appendAudit(db, {
        orgId: org.id,
        action: 'auth.login',
        entityType: 'user',
        entityId: `u-${i}`,
        payload: { i },
      });
    }
    // Tamper: rewrite the second event's payload.
    const victim = await db.auditEvent.findFirst({
      where: { orgId: org.id, seq: 1 },
    });
    await db.auditEvent.update({
      where: { id: victim!.id },
      data: { payloadJson: '{"tampered":true}' },
    });
    const v = await verifyAuditChain(db, org.id);
    expect(v.ok).toBe(false);
    expect(v.firstBrokenSeq).toBe(1);
    expect(v.reason).toContain('hash mismatch');
  });

  test('deleting an event (splice) is detected via sequence gap', async () => {
    const { appendAudit, verifyAuditChain } = await import('@/lib/server/audit');
    const org = await seedOrg();
    for (let i = 0; i < 4; i++) {
      await appendAudit(db, {
        orgId: org.id,
        action: 'export.created',
        entityType: 'export-artifact',
        entityId: `x-${i}`,
        payload: {},
      });
    }
    await db.auditEvent.deleteMany({ where: { orgId: org.id, seq: 2 } });
    const v = await verifyAuditChain(db, org.id);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('sequence gap');
  });

  test('chains are isolated per organization', async () => {
    const { appendAudit, verifyAuditChain } = await import('@/lib/server/audit');
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    await appendAudit(db, { orgId: orgA.id, action: 'auth.login', entityType: 'user', entityId: 'a', payload: {} });
    const vB = await verifyAuditChain(db, orgB.id);
    expect(vB.ok).toBe(true);
    expect(vB.events).toBe(0);
  });
});

/* ------------------------------------------------- auth + RBAC + tenancy */

describe('authentication & RBAC', () => {
  test('login issues a bearer that authenticates; logout revokes it', async () => {
    const { login, logout, sha256, authenticate } = await import('@/lib/server/auth');
    const org = await seedOrg();
    const user = await db.user.create({
      data: {
        orgId: org.id,
        email: `login-${Date.now()}@t.test`,
        name: 'Login Test',
        role: 'analyst',
        tokenHash: sha256('secret-token-123'),
      },
    });
    const { bearer } = await login(db, user.email, 'secret-token-123');
    const req = new Request('https://x.test/api/me', {
      headers: { authorization: `Bearer ${bearer}` },
    });
    const ctx = await authenticate(db, req);
    expect(ctx?.user.id).toBe(user.id);
    // wrong token fails
    const badReq = new Request('https://x.test/api/me', {
      headers: { authorization: 'Bearer wrong' },
    });
    expect(await authenticate(db, badReq)).toBeNull();
    // logout revokes
    expect(await logout(db, req)).toBe(true);
    expect(await authenticate(db, req)).toBeNull();
  });

  test('capability lattice enforces role separation', async () => {
    const { requireCapability } = await import('@/lib/server/auth');
    const org = await seedOrg();
    const mk = async (role: string) => ({
      user: await db.user.create({
        data: { orgId: org.id, email: `${role}-${Math.random().toString(36).slice(2)}@t.test`, name: role, role },
      }),
      session: {} as never,
    });
    const analyst = await mk('analyst');
    const observer = await mk('observer');
    const approver = await mk('approver');
    expect(() => requireCapability(analyst as never, 'createEvent')).not.toThrow();
    expect(() => requireCapability(observer as never, 'createEvent')).toThrow();
    expect(() => requireCapability(approver as never, 'approveSitrep')).not.toThrow();
    expect(() => requireCapability(analyst as never, 'approveSitrep')).toThrow();
  });
});

/* ------------------------------------------------ ingestion (idempotency) */

describe('ingestion orchestration', () => {
  test('runIngestion with a fixture-backed adapter upserts the catalog idempotently', async () => {
    const { runIngestion } = await import('@/lib/server/ingestion');
    const { registerFixtureAdapter } = await import('./fixtures/fixture-adapter');
    registerFixtureAdapter();
    const org = await seedOrg();
    const user = await seedUser(org.id, 'analyst');
    const ev = await seedEvent(org.id, user.id);

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
    expect(r1.assetsUpserted).toBe(3);
    const r2 = await runIngestion(db, base);
    expect(r2.status).toBe('replayed');
    expect(r2.assetsUpserted).toBe(3); // catalog still has the 3 assets
    const count = await db.assetRecord.count({ where: { eventId: ev.id, adapterId: 'fixture-demo' } });
    expect(count).toBe(3); // no duplication
  });

  test('different params → separate runs (no false replay)', async () => {
    const { runIngestion } = await import('@/lib/server/ingestion');
    const { registerFixtureAdapter } = await import('./fixtures/fixture-adapter');
    registerFixtureAdapter();
    const org = await seedOrg();
    const user = await seedUser(org.id, 'analyst');
    const ev = await seedEvent(org.id, user.id);
    const base = {
      eventId: ev.id,
      orgId: org.id,
      actorId: user.id,
      adapterId: 'fixture-demo',
      aoi: { lat: ev.centerLat, lng: ev.centerLng, aoiKm: ev.aoiKm },
      timeWindow: { from: '2025-06-01T00:00:00Z', to: '2025-06-30T00:00:00Z' },
      country: ev.country,
    };
    const r1 = await runIngestion(db, { ...base, params: { n: 2 } });
    const r2 = await runIngestion(db, { ...base, params: { n: 5 } });
    expect(r1.status).toBe('succeeded');
    expect(r2.status).toBe('succeeded');
    expect(r2.assetsUpserted).toBe(5);
  });

  test('blocked adapter raises a 503 with the missing dependency named', async () => {
    const { runIngestion } = await import('@/lib/server/ingestion');
    const org = await seedOrg();
    const user = await seedUser(org.id, 'analyst');
    const ev = await seedEvent(org.id, user.id);
    const prev = process.env.FIRSTLIGHT_FIRMS_TOKEN;
    delete process.env.FIRSTLIGHT_FIRMS_TOKEN;
    try {
      await runIngestion(db, {
        eventId: ev.id,
        orgId: org.id,
        actorId: user.id,
        adapterId: 'firms-fire',
        params: {},
        aoi: { lat: ev.centerLat, lng: ev.centerLng, aoiKm: ev.aoiKm },
        timeWindow: { from: '2025-06-01T00:00:00Z', to: '2025-06-30T00:00:00Z' },
      });
      expect.unreachable();
    } catch (err) {
      const status = (err as { status?: number }).status;
      const code = (err as { code?: string }).code;
      expect(status).toBe(503);
      expect(code).toBe('blocked_dependency');
      expect((err as Error).message).toContain('FIRSTLIGHT_FIRMS_TOKEN');
    } finally {
      if (prev) process.env.FIRSTLIGHT_FIRMS_TOKEN = prev;
    }
  });

  test('failed runs are re-attemptable (idempotency replays SUCCESS only)', async () => {
    const { runIngestion } = await import('@/lib/server/ingestion');
    const { registerFixtureAdapter } = await import('./fixtures/fixture-adapter');
    registerFixtureAdapter();
    const org = await seedOrg();
    const user = await seedUser(org.id, 'analyst');
    const ev = await seedEvent(org.id, user.id);

    // First call FAILS via a fetch that 500s once (network class error →
    // runIngestion records a failed run).
    const flaky: { fails: boolean } = { fails: true };
    const { flakyFetchAdapter, registerAdapterLocal } = await import('./fixtures/flaky-adapter');
    registerAdapterLocal(flakyFetchAdapter(flaky));
    const base = {
      eventId: ev.id,
      orgId: org.id,
      actorId: user.id,
      adapterId: 'flaky-test',
      params: {},
      aoi: { lat: ev.centerLat, lng: ev.centerLng, aoiKm: ev.aoiKm },
      timeWindow: { from: '2025-06-01T00:00:00Z', to: '2025-06-30T00:00:00Z' },
      country: ev.country,
    };
    await expect(runIngestion(db, base)).rejects.toThrow();
    const failedRun = await db.ingestionRun.findFirst({ where: { eventId: ev.id, adapterId: 'flaky-test' } });
    expect(failedRun?.status).toBe('failed');

    // Provider recovers → the SAME idempotency key must retry, not replay.
    flaky.fails = false;
    const r2 = await runIngestion(db, base);
    expect(r2.status).toBe('succeeded');
    expect(r2.attempts).toBeGreaterThanOrEqual(2);
  });
});

/* --------------------------------------------- review concurrency + freeze */

describe('review decisions & optimistic concurrency', () => {
  test('stale version writes are rejected, correct ones land', async () => {
    const org = await seedOrg();
    const reviewer = await seedUser(org.id, 'reviewer');
    const ev = await seedEvent(org.id, reviewer.id);
    const task = await db.reviewTask.create({
      data: {
        eventId: ev.id,
        targetType: 'building-detection',
        targetId: 'b-test-1',
        reason: 'low confidence',
        modelConfidence: 0.55,
        status: 'open',
      },
    });
    // Correct version write.
    const okWrite = await db.reviewTask.updateMany({
      where: { id: task.id, version: 1 },
      data: { status: 'decided', version: { increment: 1 } },
    });
    expect(okWrite.count).toBe(1);
    // Stale version write (version now 2, claiming 1) must be rejected.
    const staleWrite = await db.reviewTask.updateMany({
      where: { id: task.id, version: 1 },
      data: { status: 'decided', version: { increment: 1 } },
    });
    expect(staleWrite.count).toBe(0);
    const fresh = await db.reviewTask.findUnique({ where: { id: task.id } });
    expect(fresh?.version).toBe(2);
  });

  test('decisions are immutable — corrections append, originals survive', async () => {
    const org = await seedOrg();
    const reviewer = await seedUser(org.id, 'reviewer');
    const ev = await seedEvent(org.id, reviewer.id);
    const task = await db.reviewTask.create({
      data: { eventId: ev.id, targetType: 'building-detection', targetId: 'b-2', reason: 'x', modelConfidence: 0.6, status: 'decided' },
    });
    const first = await db.reviewDecision.create({
      data: { taskId: task.id, reviewerId: reviewer.id, decision: 'confirmed', reason: 'looks right' },
    });
    const second = await db.reviewDecision.create({
      data: { taskId: task.id, reviewerId: reviewer.id, decision: 'reclassified', newClass: 'minor', reason: 'on closer inspection' },
    });
    // Original is untouched; history is complete and ordered.
    expect(first.decision).toBe('confirmed');
    expect(second.createdAt.getTime()).toBeGreaterThanOrEqual(first.createdAt.getTime());
    const all = await db.reviewDecision.count({ where: { taskId: task.id } });
    expect(all).toBe(2);
  });
});

/* ------------------------------------------------------- sitrep + exports */

describe('sitrep generation + approval freeze', () => {
  test('draft → approve flow freezes claims; regeneration creates a new version', async () => {
    const { generateSitrepDraft, approveSitrepDraft } = await import('@/lib/server/sitrep-server');
    const org = await seedOrg();
    const analyst = await seedUser(org.id, 'analyst');
    const approver = await seedUser(org.id, 'approver');
    const ev = await seedEvent(org.id, analyst.id);

    const draft = await generateSitrepDraft(db, ev, analyst.id);
    expect(draft.status).toBe('draft');
    expect(draft.claims.length).toBeGreaterThan(8);
    expect(draft.markdown).toContain('SITUATION REPORT');
    expect(draft.markdown).toContain('SYNTHETIC');

    // Two-person rule: same person cannot approve their own draft.
    await expect(
      approveSitrepDraft(db, {
        draftId: draft.id,
        orgId: org.id,
        approverId: analyst.id,
        approverName: analyst.name,
        expectedVersion: draft.version,
        generatorId: analyst.id,
      }),
    ).rejects.toThrow(/Two-person rule/);

    const approved = await approveSitrepDraft(db, {
      draftId: draft.id,
      orgId: org.id,
      approverId: approver.id,
      approverName: approver.name,
      expectedVersion: draft.version,
      generatorId: analyst.id,
    });
    expect(approved.status).toBe('approved');

    // Stale re-approval is rejected.
    await expect(
      approveSitrepDraft(db, {
        draftId: draft.id,
        orgId: org.id,
        approverId: approver.id,
        approverName: approver.name,
        expectedVersion: draft.version,
        generatorId: analyst.id,
      }),
    ).rejects.toThrow(/already approved/);

    // Regeneration creates a NEW draft; the approved one stays frozen.
    const draft2 = await generateSitrepDraft(db, ev, analyst.id);
    expect(draft2.version).toBe(draft.version + 1);
    const frozen = await db.sitrepDraft.findUnique({ where: { id: draft.id } });
    expect(frozen?.status).toBe('approved');
    expect(frozen?.claimsHash).toBe(draft.claimsHash);
  });

  test('claims cite evidence assets and carry honest quality notes', async () => {
    const { generateSitrepDraft } = await import('@/lib/server/sitrep-server');
    const org = await seedOrg();
    const analyst = await seedUser(org.id, 'analyst');
    const ev = await seedEvent(org.id, analyst.id);
    // Give the event a real adapter record to cite.
    await db.assetRecord.create({
      data: {
        eventId: ev.id,
        adapterId: 'usgs-earthquake',
        provider: 'USGS',
        assetType: 'hazard.earthquake',
        externalId: 'usgs:test-quake-1',
        title: 'M5.1 Test Quake',
        acquiredAt: new Date('2025-06-16T11:00:00Z'),
        license: 'USGS public domain',
        attribution: 'USGS',
        qualityJson: JSON.stringify({ magnitude: 5.1, depthKm: 10, alertLevel: 'green', eventStatus: 'reviewed' }),
        status: 'validated',
        simulated: false,
      },
    });
    const draft = await generateSitrepDraft(db, ev, analyst.id);
    const quakeClaim = draft.claims.find((c) => c.tool === 'hazard_feed');
    expect(quakeClaim).toBeDefined();
    expect(quakeClaim!.evidenceAssetIds.length).toBeGreaterThan(0);
    expect(quakeClaim!.qualityNote).toContain('REAL provider record');
    const popClaim = draft.claims.find((c) => c.tool === 'get_event_summary' && c.params.facet === 'population');
    expect(popClaim!.qualityNote).toContain('UNCALIBRATED');
  });
});

describe('offline bundle v2', () => {
  test('build → validate (checksums + expiry) → revoke', async () => {
    const { buildOfflineBundle, validateOfflineBundle, revokeOfflineBundle } = await import('@/lib/server/exports-server');
    const { buildEventLayer } = await import('@/lib/server/event-core');
    const org = await seedOrg();
    const analyst = await seedUser(org.id, 'analyst');
    const ev = await seedEvent(org.id, analyst.id);
    const layer = await buildEventLayer(db, ev);

    const built = await buildOfflineBundle(db, ev, analyst.id, layer, 2);
    const parsed = JSON.parse(built.body) as {
      manifest: { layerChecksums: Record<string, string> };
      layers: Record<string, unknown>;
    };
    // Find the bundle row.
    const row = await db.offlineBundle.findFirst({ where: { eventId: ev.id }, orderBy: { createdAt: 'desc' } });
    expect(row).toBeDefined();

    const v1 = await validateOfflineBundle(db, row!.id, parsed);
    expect(v1.valid).toBe(true);
    expect(v1.expired).toBe(false);

    // Tamper a layer → checksum failure detected.
    const tampered = JSON.parse(built.body) as typeof parsed;
    (tampered.layers.damage as { features: unknown[] }).features = [];
    const v2 = await validateOfflineBundle(db, row!.id, tampered);
    expect(v2.valid).toBe(false);
    expect(v2.staleWarnings.some((w) => w.includes('checksum'))).toBe(true);

    // Revoke → invalid + warning.
    await revokeOfflineBundle(db, org.id, row!.id, analyst.id);
    const v3 = await validateOfflineBundle(db, row!.id, parsed);
    expect(v3.valid).toBe(false);
    expect(v3.revoked).toBe(true);
  });

  test('expired bundle is flagged and invalid', async () => {
    const { buildOfflineBundle, validateOfflineBundle } = await import('@/lib/server/exports-server');
    const { buildEventLayer } = await import('@/lib/server/event-core');
    const org = await seedOrg();
    const analyst = await seedUser(org.id, 'analyst');
    const ev = await seedEvent(org.id, analyst.id);
    const layer = await buildEventLayer(db, ev);
    const built = await buildOfflineBundle(db, ev, analyst.id, layer, 1);
    const parsed = JSON.parse(built.body) as { manifest: { layerChecksums: Record<string, string> }; layers: Record<string, unknown> };
    // Force expiry by rewinding createdAt.
    const row = await db.offlineBundle.findFirst({ where: { eventId: ev.id }, orderBy: { createdAt: 'desc' } });
    await db.offlineBundle.update({
      where: { id: row!.id },
      data: { createdAt: new Date(Date.now() - 3 * 3600_000), expiresAt: new Date(Date.now() - 3600_000) },
    });
    const v = await validateOfflineBundle(db, row!.id, parsed);
    expect(v.expired).toBe(true);
    expect(v.valid).toBe(false);
    expect(v.staleWarnings.some((w) => w.includes('EXPIRED'))).toBe(true);
  });
});

/* ------------------------------------------------- auth hardening (v2.2) */

describe('auth hardening — timing + enumeration + pruning', () => {
  test('unknown email and wrong token yield the IDENTICAL error (anti-enumeration)', async () => {
    const { login, sha256 } = await import('@/lib/server/auth');
    const org = await seedOrg();
    const email = `enum-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@t.test`;
    await db.user.create({
      data: {
        orgId: org.id,
        email,
        name: 'Enum Test',
        role: 'analyst',
        tokenHash: sha256('real-token'),
      },
    });
    const errs: string[] = [];
    // Unknown account.
    try {
      await login(db, 'does-not-exist@t.test', 'whatever');
    } catch (e) {
      errs.push((e as Error).message);
    }
    // Unknown account, but the CORRECT secret for someone else.
    try {
      await login(db, 'does-not-exist@t.test', 'real-token');
    } catch (e) {
      errs.push((e as Error).message);
    }
    // Existing account, wrong secret.
    try {
      await login(db, email, 'wrong-token');
    } catch (e) {
      errs.push((e as Error).message);
    }
    // All failures must be indistinguishable.
    expect(new Set(errs).size).toBe(1);
    expect(errs[0]).toBe('Unknown account or invalid token');
  });

  test('login prunes sessions that expired more than 7 days ago', async () => {
    const { login, sha256 } = await import('@/lib/server/auth');
    const org = await seedOrg();
    const user = await db.user.create({
      data: {
        orgId: org.id,
        email: `prune-${Date.now()}@t.test`,
        name: 'Prune Test',
        role: 'analyst',
        tokenHash: sha256('prune-token'),
      },
    });
    // A long-dead session and a live one.
    await db.session.create({
      data: {
        userId: user.id,
        tokenHash: sha256('dead-session'),
        expiresAt: new Date(Date.now() - 10 * 86400_000),
      },
    });
    await db.session.create({
      data: {
        userId: user.id,
        tokenHash: sha256('recent-session'),
        expiresAt: new Date(Date.now() - 2 * 86400_000), // expired but recent — kept
      },
    });
    await login(db, user.email, 'prune-token');
    const dead = await db.session.findUnique({ where: { tokenHash: sha256('dead-session') } });
    const recent = await db.session.findUnique({ where: { tokenHash: sha256('recent-session') } });
    expect(dead).toBeNull();      // pruned
    expect(recent).not.toBeNull(); // within retention — survives
  });
});

/* ---------------------------------- full-router dispatch (envelope + layer) */

describe('dispatch — authenticated layer endpoint round trip', () => {
  test('GET /api/events/:id/layer returns the lossless layer through the real router', async () => {
    const { login, sha256 } = await import('@/lib/server/auth');
    const org = await seedOrg();
    const user = await db.user.create({
      data: {
        orgId: org.id,
        email: `layer-${Date.now()}@t.test`,
        name: 'Layer Test',
        role: 'observer',
        tokenHash: sha256('layer-token'),
      },
    });
    const ev = await seedEvent(org.id, user.id);
    const { bearer } = await login(db, user.email, 'layer-token');

    const { dispatch } = await import('@/server/api/router');
    const res = await dispatch(
      new Request(`https://x.test/api/events/${ev.id}/layer`, {
        headers: { authorization: `Bearer ${bearer}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBeTruthy();
    expect(res.headers.get('cache-control')).toBe('no-store');
    const json = (await res.json()) as { data: Record<string, unknown> };

    // Envelope + event metadata.
    expect(json.data.event).toBeDefined();
    expect(json.data.manifest).toBeDefined();
    expect((json.data.demo as { simulated: boolean }).simulated).toBe(true);

    // LOSSLESS: the fields the client store needs to reconstruct the layer.
    const zones = json.data.zones as Array<Record<string, unknown>>;
    expect(zones.length).toBeGreaterThan(5);
    for (const z of zones.slice(0, 3)) {
      expect(z.needLower).toBeDefined();
      expect(z.dataQuality).toBeDefined();
      expect(z.undamaged).toBeDefined();
      expect(z.critCount).toBeDefined();
      expect(z.exposureMethod).toBeDefined();
      expect(z.boundary).toBeDefined();
    }
    const roads = json.data.roads as Array<Record<string, unknown>>;
    expect(roads.length).toBeGreaterThan(0);
    for (const r of roads.slice(0, 3)) {
      expect(r.nodes).toBeDefined();
      expect(r.lengthKm).toBeDefined();
      expect(r.speedKmh).toBeDefined();
    }
    const buildings = json.data.buildings as Array<Record<string, unknown>>;
    expect(buildings.length).toBeGreaterThan(0);
    expect(buildings[0].footprint).toBeDefined();
    expect(buildings[0].areaM2).toBeDefined();
    const facilities = json.data.facilities as Array<Record<string, unknown>>;
    expect(facilities[0].node).toBeDefined();
    expect((json.data.popGrid as unknown[]).length).toBeGreaterThan(0);
    expect((json.data.meta as Record<string, unknown>).id).toBeDefined();
    expect(json.data.stats).toBeDefined();
  });

  test('unauthenticated layer request gets a proper 401 envelope (never a 500)', async () => {
    const { dispatch } = await import('@/server/api/router');
    const res = await dispatch(new Request('https://x.test/api/events/whatever/layer'));
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string; requestId: string } };
    expect(json.error.code).toBe('unauthorized');
    expect(json.error.requestId).toBeTruthy();
  });

  test('cross-org event access is a 404 (existence hiding) through the router', async () => {
    const { login, sha256 } = await import('@/lib/server/auth');
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    const userA = await db.user.create({
      data: {
        orgId: orgA.id,
        email: `iso-a-${Date.now()}@t.test`,
        name: 'Iso A',
        role: 'observer',
        tokenHash: sha256('iso-token-a'),
      },
    });
    const userB = await db.user.create({
      data: {
        orgId: orgB.id,
        email: `iso-b-${Date.now()}@t.test`,
        name: 'Iso B',
        role: 'observer',
        tokenHash: sha256('iso-token-b'),
      },
    });
    const evB = await seedEvent(orgB.id, userB.id);
    const { bearer } = await login(db, userA.email, 'iso-token-a');
    const { dispatch } = await import('@/server/api/router');
    const res = await dispatch(
      new Request(`https://x.test/api/events/${evB.id}/layer`, {
        headers: { authorization: `Bearer ${bearer}` },
      }),
    );
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('not_found');
  });
});
