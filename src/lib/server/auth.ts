/* ==========================================================================
 * FirstLight — authentication & RBAC (Phase 1).
 *
 * Pilot auth model (honest, documented):
 *  - Users are seeded with out-of-band login tokens (hash-stored). This is a
 *    DEMO-grade credential mechanism for the open-data pilot; the production
 *    path is OIDC/SAML with MFA — the session/role seam below is designed so
 *    only `login()` changes (see SECURITY.md §Authentication).
 *  - Sessions are 192-bit random bearer tokens; only their SHA-256 hash is
 *    stored. Logout revokes server-side; expiry is enforced on every call.
 *  - Roles form a capability lattice; every resolver checks capabilities,
 *    never raw role strings scattered through handlers.
 *
 * Organization isolation: every query filters by the session user's orgId —
 * cross-tenant object access returns 404 (not 403) to avoid existence leaks.
 * ========================================================================== */

import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient, Session, User } from '@prisma/client';
import { errors } from './http';
import type { Role } from './schemas';

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function newBearerToken(): string {
  return `fl_${randomBytes(24).toString('base64url')}`; // 192-bit
}

/** Capability matrix — the single source of truth for RBAC. */
export const CAPABILITIES = {
  read: ['observer', 'analyst', 'reviewer', 'approver', 'admin'],
  createEvent: ['analyst', 'admin'],
  runIngestion: ['analyst', 'admin'],
  generateSitrep: ['analyst', 'admin'],
  reviewDecide: ['reviewer', 'admin'],
  approveSitrep: ['approver', 'admin'],
  createExport: ['analyst', 'reviewer', 'approver', 'admin'],
  publishScoreConfig: ['admin'],
  readAudit: ['approver', 'admin'],
  manageUsers: ['admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

export interface AuthContext {
  user: User;
  session: Session;
}

/** Resolve a bearer token to a live session+user, or null. */
export async function authenticate(
  db: PrismaClient,
  req: Request,
): Promise<AuthContext | null> {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const tokenHash = sha256(match[1].trim());
  const session = await db.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session) return null;
  if (session.revokedAt || session.expiresAt.getTime() < Date.now()) return null;
  if (session.user.revokedAt) return null;
  return { user: session.user, session };
}

/** Require authentication; throws 401. */
export async function requireAuth(db: PrismaClient, req: Request): Promise<AuthContext> {
  const ctx = await authenticate(db, req);
  if (!ctx) throw errors.unauthorized('Missing, expired, or revoked session token');
  return ctx;
}

/** Require a capability; throws 403. */
export function requireCapability(ctx: AuthContext, cap: Capability): void {
  const allowed = CAPABILITIES[cap] as readonly Role[];
  if (!allowed.includes(ctx.user.role as Role)) {
    throw errors.forbidden(
      `Role '${ctx.user.role}' lacks capability '${cap}' (requires: ${allowed.join(' | ')})`,
    );
  }
}

/** Login: verify the account token hash, mint a session bearer token. */
export async function login(
  db: PrismaClient,
  email: string,
  token: string,
): Promise<{ bearer: string; user: User }> {
  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.revokedAt) throw errors.unauthorized('Unknown or revoked account');
  if (!user.tokenHash || user.tokenHash !== sha256(token)) {
    throw errors.unauthorized('Invalid account token');
  }
  const bearer = newBearerToken();
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: sha256(bearer),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return { bearer, user };
}

export async function logout(db: PrismaClient, req: Request): Promise<boolean> {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  const res = await db.session.updateMany({
    where: { tokenHash: sha256(match[1].trim()), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count > 0;
}

export function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as Role,
    orgId: u.orgId,
  };
}
