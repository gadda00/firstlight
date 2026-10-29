/* API: sitrep endpoints — read current, generate draft, approve (freeze). */

import { db } from '@/lib/server/db';
import { errors, ok, parseBody } from '@/lib/server/http';
import { getOrgEvent } from '@/lib/server/audit';
import { ApproveSitrepSchema } from '@/lib/server/schemas';
import { generateSitrepDraft, approveSitrepDraft } from '@/lib/server/sitrep-server';
import type { RequestContext } from './router';
import { routeParam } from './router';

export async function handleGetSitrep(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const ev = await getOrgEvent(db, ctx.auth.user.orgId, routeParam(ctx, 'id'));
  const drafts = await db.sitrepDraft.findMany({
    where: { eventId: ev.id },
    orderBy: { version: 'desc' },
    include: { approvals: { include: { approver: true } } },
  });
  return ok(
    {
      drafts: drafts.map((d) => ({
        id: d.id,
        version: d.version,
        status: d.status,
        claimsHash: d.claimsHash,
        generatedById: d.generatedById,
        approvedBy: d.approvals[0]?.approver.name ?? null,
        approvedAt: d.approvals[0]?.approvedAt.toISOString() ?? null,
        markdown: d.markdown,
        createdAt: d.createdAt.toISOString(),
      })),
    },
    ctx.requestId,
  );
}

export async function handleGenerateSitrep(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const ev = await getOrgEvent(db, ctx.auth.user.orgId, routeParam(ctx, 'id'));
  const draft = await generateSitrepDraft(db, ev, ctx.auth.user.id);
  return ok(
    {
      draft: {
        id: draft.id,
        version: draft.version,
        status: draft.status,
        claimsHash: draft.claimsHash,
        claims: draft.claims,
        markdown: draft.markdown,
      },
      approval:
        'POST /api/sitrep/{id}/approve by an approver (≠ generator) with {expectedVersion} to freeze',
    },
    ctx.requestId,
    201,
  );
}

export async function handleApproveSitrep(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const draftId = routeParam(ctx, 'id');
  const body = await parseBody(ctx.req, ApproveSitrepSchema);
  const draft = await db.sitrepDraft.findFirst({
    where: { id: draftId, event: { orgId: ctx.auth.user.orgId } },
  });
  if (!draft) throw errors.notFound('Sitrep draft not found');
  const approved = await approveSitrepDraft(db, {
    draftId,
    orgId: ctx.auth.user.orgId,
    approverId: ctx.auth.user.id,
    approverName: ctx.auth.user.name,
    expectedVersion: body.expectedVersion,
    reason: body.reason,
    generatorId: draft.generatedById,
  });
  return ok(
    {
      draft: {
        id: approved.id,
        version: approved.version,
        status: approved.status,
        claimsHash: approved.claimsHash,
        approvedBy: approved.approvedBy,
        markdown: approved.markdown,
      },
      frozen: true,
    },
    ctx.requestId,
  );
}
