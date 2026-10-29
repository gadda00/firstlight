/* API: score-config endpoints — list + publish versioned profiles (admin). */

import { db } from '@/lib/server/db';
import { errors, ok, parseBody } from '@/lib/server/http';
import { appendAudit } from '@/lib/server/audit';
import { ScoreConfigSchema } from '@/lib/server/schemas';
import type { RequestContext } from './router';

export async function handleListScoreConfigs(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const configs = await db.scoreConfig.findMany({
    where: { orgId: ctx.auth.user.orgId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return ok(
    {
      configs: configs.map((c) => ({
        id: c.id,
        name: c.name,
        version: c.version,
        weights: JSON.parse(c.weightsJson) as unknown,
        normalization: c.normalization,
        exposureMethod: c.exposureMethod,
        missingPenalty: c.missingPenalty,
        approvedById: c.approvedById,
        createdAt: c.createdAt.toISOString(),
      })),
    },
    ctx.requestId,
  );
}

export async function handleCreateScoreConfig(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const body = await parseBody(ctx.req, ScoreConfigSchema);
  const existing = await db.scoreConfig.findFirst({
    where: { orgId: ctx.auth.user.orgId, name: body.name },
    orderBy: { version: 'desc' },
  });
  const cfg = await db.scoreConfig.create({
    data: {
      orgId: ctx.auth.user.orgId,
      name: body.name,
      weightsJson: JSON.stringify(body.weights),
      normalization: body.normalization,
      exposureMethod: body.exposureMethod,
      missingPenalty: body.missingPenalty,
      version: (existing?.version ?? 0) + 1,
      approvedById: ctx.auth.user.id,
      createdById: ctx.auth.user.id,
    },
  });
  await appendAudit(db, {
    orgId: ctx.auth.user.orgId,
    actorId: ctx.auth.user.id,
    action: 'scoreconfig.published',
    entityType: 'score-config',
    entityId: cfg.id,
    payload: { name: cfg.name, version: cfg.version, weights: body.weights },
  });
  return ok({ config: { id: cfg.id, name: cfg.name, version: cfg.version } }, ctx.requestId, 201);
}
