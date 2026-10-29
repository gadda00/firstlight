/* API: GET /api/health — never-throw health probe (degraded, not 500). */

import { db } from '@/lib/server/db';
import { resolveDatabaseUrl } from '@/lib/server/db';
import { demoModeEnabled } from '@/lib/firstlight/mode';
import { ok } from '@/lib/server/http';
import type { RequestContext } from './router';

export async function handleHealth(req: RequestContext): Promise<Response> {
  const checks: Record<string, { status: string; latencyMs?: number }> = {};
  let degraded = false;

  const t0 = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = { status: 'up', latencyMs: Date.now() - t0 };
  } catch (err) {
    degraded = true;
    checks.database = {
      status: 'down',
    };
    checks.diagnostics = {
      status: 'error',
    };
    void err;
  }

  return ok(
    {
      status: degraded ? 'degraded' : 'ok',
      mode: demoModeEnabled() ? 'demo' : 'operational',
      checks,
      dbDiagnostics: degraded
        ? {
            resolvedUrl: (() => {
              try {
                const u = resolveDatabaseUrl();
                return u.startsWith('file:') ? u : `${u.slice(0, 12)}…(redacted)`;
              } catch {
                return 'resolution failed';
              }
            })(),
            hint: 'Run `bunx prisma db push` and set DATABASE_URL (see .env.example).',
          }
        : undefined,
      uptimeSec: Math.round(process.uptime()),
    },
    req.requestId,
  );
}
