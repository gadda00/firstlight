/* API: review workflow endpoints — list tasks, decide (immutable + concurrent-safe). */

import { db } from '@/lib/server/db';
import { errors, ok, parseBody } from '@/lib/server/http';
import { getOrgEvent, appendAudit } from '@/lib/server/audit';
import { ReviewDecideSchema } from '@/lib/server/schemas';
import type { RequestContext } from './router';
import { routeParam } from './router';

export async function handleListReviewTasks(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const ev = await getOrgEvent(db, ctx.auth.user.orgId, routeParam(ctx, 'id'));
  const status = new URL(ctx.req.url).searchParams.get('status');
  const tasks = await db.reviewTask.findMany({
    where: { eventId: ev.id, ...(status ? { status } : {}) },
    orderBy: [{ priority: 'desc' }, { modelConfidence: 'asc' }],
    take: 100,
    include: { decisions: { orderBy: { createdAt: 'asc' }, include: { reviewer: true } } },
  });
  return ok(
    {
      tasks: tasks.map((t) => ({
        id: t.id,
        eventId: t.eventId,
        targetType: t.targetType,
        targetId: t.targetId,
        reason: t.reason,
        modelConfidence: t.modelConfidence,
        priority: t.priority,
        status: t.status,
        version: t.version,
        dueAt: t.dueAt?.toISOString() ?? null,
        decisions: t.decisions.map((d) => ({
          id: d.id,
          decision: d.decision,
          newClass: d.newClass,
          reason: d.reason,
          notes: d.notes,
          reviewer: d.reviewer.name,
          reviewerRole: d.reviewer.role,
          createdAt: d.createdAt.toISOString(),
        })),
      })),
    },
    ctx.requestId,
  );
}

export async function handleReviewDecide(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const taskId = routeParam(ctx, 'id');
  const body = await parseBody(ctx.req, ReviewDecideSchema);
  if (body.decision === 'reclassified' && !body.newClass) {
    throw errors.badRequest('Reclassification requires a newClass');
  }
  // Org isolation: the task must belong to an event in the caller's org.
  const task = await db.reviewTask.findFirst({
    where: { id: taskId, event: { orgId: ctx.auth.user.orgId } },
    include: { event: true },
  });
  if (!task) throw errors.notFound('Review task not found in your organization');

  // Optimistic concurrency: the write only lands if the version matches.
  const updated = await db.reviewTask.updateMany({
    where: { id: task.id, version: body.version },
    data: { status: 'decided', version: { increment: 1 } },
  });
  if (updated.count === 0) {
    const fresh = await db.reviewTask.findUnique({ where: { id: task.id } });
    throw errors.stale(
      `Review task changed concurrently (current version ${fresh?.version ?? '?'}, you sent ${body.version}) — re-fetch and retry`,
      { currentVersion: fresh?.version },
    );
  }

  // Append-only decision record (immutable, attributed, reasoned).
  const decision = await db.reviewDecision.create({
    data: {
      taskId: task.id,
      reviewerId: ctx.auth.user.id,
      decision: body.decision,
      newClass: body.newClass ?? null,
      reason: body.reason,
      notes: body.notes ?? null,
    },
  });
  await appendAudit(db, {
    orgId: task.event.orgId,
    actorId: ctx.auth.user.id,
    action: 'review.decided',
    entityType: 'review-task',
    entityId: task.id,
    payload: {
      decision: body.decision,
      newClass: body.newClass ?? null,
      reason: body.reason,
      target: task.targetId,
    },
  });

  const recomputeHint =
    'Scores are recomputed server-side from the immutable decision history on the next layer/sitrep read.';
  return ok(
    {
      decision: {
        id: decision.id,
        decision: decision.decision,
        newClass: decision.newClass,
        reason: decision.reason,
        reviewer: ctx.auth.user.name,
        createdAt: decision.createdAt.toISOString(),
      },
      taskVersion: body.version + 1,
      note: recomputeHint,
    },
    ctx.requestId,
    201,
  );
}
