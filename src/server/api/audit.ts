/* API: audit endpoints — chain listing (approver+) + integrity verification. */

import { db } from '@/lib/server/db';
import { errors, ok } from '@/lib/server/http';
import { verifyAuditChain } from '@/lib/server/audit';
import type { RequestContext } from './router';

export async function handleListAudit(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const limit = Math.min(
    200,
    Number(new URL(ctx.req.url).searchParams.get('limit') ?? '50') || 50,
  );
  const events = await db.auditEvent.findMany({
    where: { orgId: ctx.auth.user.orgId },
    orderBy: { seq: 'desc' },
    take: limit,
  });
  return ok(
    {
      events: events.map((e) => ({
        seq: e.seq,
        action: e.action,
        actorId: e.actorId,
        entityType: e.entityType,
        entityId: e.entityId,
        payload: JSON.parse(e.payloadJson) as unknown,
        prevHash: e.prevHash,
        hash: e.hash,
        createdAt: e.createdAt.toISOString(),
      })),
      total: await db.auditEvent.count({ where: { orgId: ctx.auth.user.orgId } }),
    },
    ctx.requestId,
  );
}

export async function handleVerifyAudit(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const verification = await verifyAuditChain(db, ctx.auth.user.orgId);
  return ok({ verification }, ctx.requestId);
}
