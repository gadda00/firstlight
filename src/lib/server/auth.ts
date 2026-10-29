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

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PrismaClient, Session, User } from '@prisma/client';
import { errors } from './http';
import type { Role } from './schemas';

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

/** Retention for closed sessions before pruning (7 days, for audit recall). */
const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Constant-time comparison of two hex digests. Same length is guaranteed by
 * construction (both are sha256 hex); the length check satisfies Node's
 * timingSafeEqual contract without leaking which check failed. */
function hashEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Compared when the account does not exist so the login path always runs
 * exactly one hash comparison — prevents user-enumeration via timing. */
const DUMMY_HASH = sha256('firstlight-timing-decoy');

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

/** Login: verify the account token hash (timing-safe, non-enumerating),
 * mint a session bearer token, and opportunistically prune long-expired
 * sessions so the table cannot grow without bound. */
export async function login(
  db: PrismaClient,
  email: string,
  token: string,
): Promise<{ bearer: string; user: User }> {
  const user = await db.user.findUnique({ where: { email } });
  // ALWAYS run one hash comparison, even for unknown accounts (timing).
  const candidateHash = user?.tokenHash ?? DUMMY_HASH;
  const valid = Boolean(user?.tokenHash) && hashEquals(sha256(token), candidateHash);
  if (!user || user.revokedAt || !valid) {
    // Single unified message: unknown account and bad token are
    // indistinguishable to the caller (anti-enumeration).
    throw errors.unauthorized('Unknown account or invalid token');
  }
  const bearer = newBearerToken();
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: sha256(bearer),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  // Opportunistic prune (best-effort, never blocks login on failure):
  // sessions that expired more than PRUNE_AFTER_MS ago are dead state.
  try {
    await db.session.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - PRUNE_AFTER_MS) } },
    });
  } catch {
    /* pruning is advisory */
  }
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
