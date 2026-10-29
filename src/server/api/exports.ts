/* API: export + offline-bundle endpoints. */

import { db } from '@/lib/server/db';
import { errors, ok, parseBody } from '@/lib/server/http';
import { getOrgEvent } from '@/lib/server/audit';
import { CreateExportSchema, CreateBundleSchema } from '@/lib/server/schemas';
import {
  buildExport,
  validateOfflineBundle,
  revokeOfflineBundle,
} from '@/lib/server/exports-server';
import type { RequestContext } from './router';
import { routeParam } from './router';

export async function handleListExports(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const ev = await getOrgEvent(db, ctx.auth.user.orgId, routeParam(ctx, 'id'));
  const exportsList = await db.exportArtifact.findMany({
    where: { eventId: ev.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const bundles = await db.offlineBundle.findMany({
    where: { eventId: ev.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return ok(
    {
      exports: exportsList.map((e) => ({
        id: e.id,
        kind: e.kind,
        sha256: e.sha256,
        sizeBytes: e.sizeBytes,
        approvalState: e.approvalState,
        createdAt: e.createdAt.toISOString(),
      })),
      bundles: bundles.map((b) => ({
        id: b.id,
        sha256: b.sha256,
        expiresAt: b.expiresAt.toISOString(),
        revoked: Boolean(b.revokedAt),
        createdAt: b.createdAt.toISOString(),
      })),
    },
    ctx.requestId,
  );
}

export async function handleCreateExport(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const ev = await getOrgEvent(db, ctx.auth.user.orgId, routeParam(ctx, 'id'));
  const body = await parseBody(ctx.req, CreateExportSchema);
  const built = await buildExport(db, ev, body.kind, ctx.auth.user.id);
  return ok(
    {
      export: {
        kind: built.kind,
        filename: built.filename,
        contentType: built.contentType,
        sha256: built.sha256,
        sizeBytes: built.sizeBytes,
        approvalState: built.approvalState,
        requestId: ctx.requestId,
      },
      body: built.body,
    },
    ctx.requestId,
    201,
  );
}

export async function handleCreateBundle(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const ev = await getOrgEvent(db, ctx.auth.user.orgId, routeParam(ctx, 'id'));
  const body = await parseBody(ctx.req, CreateBundleSchema);
  const built = await buildExport(db, ev, 'offline-bundle', ctx.auth.user.id, {
    ttlHours: body.ttlHours,
  });
  return ok(
    {
      bundle: {
        kind: built.kind,
        filename: built.filename,
        sha256: built.sha256,
        sizeBytes: built.sizeBytes,
        ttlHours: body.ttlHours,
      },
      body: built.body,
    },
    ctx.requestId,
    201,
  );
}

export async function handleImportBundle(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const bundleId = routeParam(ctx, 'id');
  // The importer presents the bundle it received; we validate checksums,
  // expiry, revocation, and staleness against server state.
  let bodyJson: { manifest?: { layerChecksums?: Record<string, string> }; layers?: Record<string, unknown> } = {};
  try {
    bodyJson = await ctx.req.json();
  } catch {
    throw errors.badRequest('Bundle import requires the bundle JSON as the request body');
  }
  const validation = await validateOfflineBundle(db, bundleId, bodyJson);
  return ok({ validation }, ctx.requestId);
}

export async function handleRevokeBundle(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const bundleId = routeParam(ctx, 'id');
  await revokeOfflineBundle(db, ctx.auth.user.orgId, bundleId, ctx.auth.user.id);
  return ok({ revoked: bundleId }, ctx.requestId);
}
