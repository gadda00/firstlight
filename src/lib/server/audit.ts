/* ==========================================================================
 * FirstLight — immutable audit trail with SHA-256 hash chain (Phase 1).
 *
 * Replaces the demo FNV-1a "audit checksum" (a 32-bit demo device, fine for
 * client previews, not a security control) with a server-side, append-only
 * chain: every AuditEvent's hash covers the previous hash, the per-org
 * sequence number, the action triple, the canonical payload, and the creation
 * time. Any retroactive edit breaks every subsequent hash.
 *
 * Chain integrity is verified by `verifyAuditChain` and exercised in tests
 * (tamper detection) and via POST /api/audit/verify.
 * ========================================================================== */

import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { errors } from './http';

export type AuditAction =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.failed_login'
  | 'event.created'
  | 'event.status_changed'
  | 'ingestion.run'
  | 'asset.upserted'
  | 'review.task_created'
  | 'review.decided'
  | 'sitrep.generated'
  | 'sitrep.approved'
  | 'export.created'
  | 'bundle.created'
  | 'bundle.revoked'
  | 'scoreconfig.published';

export interface AuditInput {
  orgId: string;
  actorId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
}

/** Canonical JSON: sorted keys, no whitespace — stable across runs. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, val]) => val !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${canonicalJson(val)}`).join(',')}}`;
}

export function auditHash(input: {
  prevHash: string;
  seq: number;
  action: string;
  entityType: string;
  entityId: string;
  payloadJson: string;
  createdAtIso: string;
}): string {
  return createHash('sha256')
    .update(
      [
        input.prevHash,
        String(input.seq),
        input.action,
        input.entityType,
        input.entityId,
        input.payloadJson,
        input.createdAtIso,
      ].join('\u001f'),
    )
    .digest('hex');
}

/** Append one audit event. Runs in a transaction so seq is gap-free per org. */
export async function appendAudit(
  db: PrismaClient,
  input: AuditInput,
): Promise<{ seq: number; hash: string }> {
  return db.$transaction(async (tx) => {
    const last = await tx.auditEvent.findFirst({
      where: { orgId: input.orgId },
      orderBy: { seq: 'desc' },
      select: { seq: true, hash: true },
    });
    const seq = (last?.seq ?? -1) + 1;
    const prevHash = last?.hash ?? '';
    const createdAt = new Date();
    const payloadJson = canonicalJson(input.payload ?? {});
    const hash = auditHash({
      prevHash,
      seq,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      payloadJson,
      createdAtIso: createdAt.toISOString(),
    });
    const row = await tx.auditEvent.create({
      data: {
        orgId: input.orgId,
        seq,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        payloadJson,
        prevHash,
        hash,
        createdAt,
      },
      select: { seq: true, hash: true },
    });
    return row;
  });
}

export interface ChainVerification {
  orgId: string;
  events: number;
  ok: boolean;
  firstBrokenSeq: number | null;
  reason: string | null;
}

/** Walk the whole chain and recompute every hash. */
export async function verifyAuditChain(
  db: PrismaClient,
  orgId: string,
): Promise<ChainVerification> {
  const events = await db.auditEvent.findMany({
    where: { orgId },
    orderBy: { seq: 'asc' },
  });
  let prevHash = '';
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.seq !== i) {
      return {
        orgId,
        events: events.length,
        ok: false,
        firstBrokenSeq: e.seq,
        reason: `sequence gap: expected ${i}, found ${e.seq}`,
      };
    }
    if (e.prevHash !== prevHash) {
      return {
        orgId,
        events: events.length,
        ok: false,
        firstBrokenSeq: e.seq,
        reason: 'prevHash does not match the previous event hash (reordered or spliced chain)',
      };
    }
    const expect = auditHash({
      prevHash: e.prevHash,
      seq: e.seq,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      payloadJson: e.payloadJson,
      createdAtIso: e.createdAt.toISOString(),
    });
    if (expect !== e.hash) {
      return {
        orgId,
        events: events.length,
        ok: false,
        firstBrokenSeq: e.seq,
        reason: 'hash mismatch — payload or metadata was modified after the fact',
      };
    }
    prevHash = e.hash;
  }
  return { orgId, events: events.length, ok: true, firstBrokenSeq: null, reason: null };
}

/** Guard: org-scoped fetch helper that hides cross-tenant existence. */
export async function getOrgEvent(db: PrismaClient, orgId: string, eventId: string) {
  const ev = await db.incidentEvent.findFirst({
    where: { id: eventId, orgId },
  });
  if (!ev) throw errors.notFound('Event not found in your organization');
  return ev;
}
