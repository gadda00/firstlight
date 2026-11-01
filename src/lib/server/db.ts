/* ==========================================================================
 * FirstLight — server database client (Phase 1).
 *
 * Replaces the orphan `src/lib/db.ts` (which imported @prisma/client with no
 * schema, no callers, and no design intent — see IMPLEMENTATION_BASELINE.md).
 *
 * Two hard-won rules encoded here:
 *  1. SQLite `file:` URLs MUST be absolute. Prisma resolves relative `file:`
 *     paths against `node_modules/.prisma/client`, silently creating an empty
 *     database far from the project root. We resolve against process.cwd().
 *  2. Use the modern `datasourceUrl` constructor option — the legacy
 *     `datasources: { db: { url } }` form is dropped by Turbopack dev servers.
 *
 * A Proxy guard keeps `next build` (which imports route modules for page-data
 * collection without a database) from crashing: any actual method call on a
 * failed client throws a descriptive error instead of an opaque one.
 * ========================================================================== */

import { PrismaClient } from '@prisma/client';
import path from 'node:path';

const DATABASE_DIR = path.join(process.cwd(), 'db');

export function resolveDatabaseUrl(): string {
  const env = process.env.DATABASE_URL;
  if (env && !env.startsWith('file:')) return env; // postgres://… in production
  const relative = env ? env.slice('file:'.length) : 'firstlight.db';
  const abs = path.isAbsolute(relative)
    ? relative
    : path.join(DATABASE_DIR, relative);
  return `file:${abs}`;
}

function createPrisma(): PrismaClient {
  return new PrismaClient({
    datasourceUrl: resolveDatabaseUrl(),
    log: process.env.PRISMA_LOG === 'query' ? ['query'] : ['error'],
  });
}

const globalForPrisma = globalThis as unknown as {
  firstlightPrisma?: PrismaClient;
};

function getDb(): PrismaClient {
  if (globalForPrisma.firstlightPrisma) return globalForPrisma.firstlightPrisma;
  try {
    const client = createPrisma();
    globalForPrisma.firstlightPrisma = client;
    return client;
  } catch (err) {
    // Build-time / missing-DB guard: return a proxy that explains the failure
    // on first use instead of crashing module import.
    const reason = err instanceof Error ? err.message : String(err);
    return new Proxy({} as PrismaClient, {
      get() {
        throw new Error(
          `FirstLight database client unavailable (${reason}). ` +
            `Run \`bunx prisma db push\` and set DATABASE_URL (see .env.example).`,
        );
      },
    });
  }
}

/** The app-wide client. A live FORWARDING proxy, not a snapshot: every
 *  property access resolves the CURRENT cached instance so the test reset
 *  below is actually honored by modules that imported `db` earlier. */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    const current = getDb() as unknown as Record<string | symbol, unknown>;
    const value = current[prop as string | symbol];
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(current) : value;
  },
});

/** TEST HOOK ONLY: bun:test runs every file in ONE process, and the
 *  router/auth modules import this singleton. A test file that sets its own
 *  DATABASE_URL must reset the singleton FIRST — otherwise the previous
 *  file's client (possibly pointed at a since-deleted throwaway database)
 *  silently serves every later dispatch. Production code must never call this. */
export function resetDbForTests(): void {
  const g = globalThis as unknown as { firstlightPrisma?: PrismaClient };
  const existing = g.firstlightPrisma;
  g.firstlightPrisma = undefined;
  if (existing) {
    void existing.$disconnect().catch(() => undefined);
  }
}
