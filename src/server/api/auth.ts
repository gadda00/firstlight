/* API: auth endpoints — login (rate-limited), logout (server-side revoke), me. */

import { db } from '@/lib/server/db';
import { errors, ok, parseBody } from '@/lib/server/http';
import { login, logout, publicUser } from '@/lib/server/auth';
import { appendAudit, canonicalJson } from '@/lib/server/audit';
import { LoginSchema } from '@/lib/server/schemas';
import type { RequestContext } from './router';

export async function handleLogin(ctx: RequestContext): Promise<Response> {
  const body = await parseBody(ctx.req, LoginSchema);
  const { bearer, user } = await login(db, body.email, body.token);
  await appendAudit(db, {
    orgId: user.orgId,
    actorId: user.id,
    action: 'auth.login',
    entityType: 'user',
    entityId: user.id,
    payload: { email: user.email, role: user.role, at: new Date().toISOString() },
  });
  return ok(
    {
      token: bearer,
      user: publicUser(user),
      session: { expiresInSec: 24 * 3600 },
      notice:
        'Pilot auth: out-of-band account tokens (see SECURITY.md). Production replaces login() with OIDC/SAML + MFA — the session/role seam stays identical.',
    },
    ctx.requestId,
  );
}

export async function handleLogout(ctx: RequestContext): Promise<Response> {
  const revoked = await logout(db, ctx.req);
  if (ctx.auth) {
    await appendAudit(db, {
      orgId: ctx.auth.user.orgId,
      actorId: ctx.auth.user.id,
      action: 'auth.logout',
      entityType: 'user',
      entityId: ctx.auth.user.id,
      payload: { revoked },
    });
  }
  return ok({ revoked }, ctx.requestId);
}

export async function handleMe(ctx: RequestContext): Promise<Response> {
  if (!ctx.auth) throw errors.unauthorized();
  const caps = {
    read: true,
    createEvent: ['analyst', 'admin'].includes(ctx.auth.user.role),
    runIngestion: ['analyst', 'admin'].includes(ctx.auth.user.role),
    generateSitrep: ['analyst', 'admin'].includes(ctx.auth.user.role),
    reviewDecide: ['reviewer', 'admin'].includes(ctx.auth.user.role),
    approveSitrep: ['approver', 'admin'].includes(ctx.auth.user.role),
    createExport: ['analyst', 'reviewer', 'approver', 'admin'].includes(ctx.auth.user.role),
    readAudit: ['approver', 'admin'].includes(ctx.auth.user.role),
    publishScoreConfig: ctx.auth.user.role === 'admin',
  };
  return ok(
    {
      user: publicUser(ctx.auth.user),
      capabilities: caps,
      session: {
        expiresAt: ctx.auth.session.expiresAt.toISOString(),
        lastSeenAt: ctx.auth.session.lastSeenAt?.toISOString() ?? null,
      },
    },
    ctx.requestId,
  );
}

export { canonicalJson };
