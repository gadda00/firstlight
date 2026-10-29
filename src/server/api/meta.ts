/* API: GET /api/meta — run-mode + provider manifest (public, unauthenticated). */

import { db } from '@/lib/server/db';
import { demoModeEnabled } from '@/lib/firstlight/mode';
import { providerManifest } from '@/lib/server/adapters/registry';
import { ok } from '@/lib/server/http';
import type { RequestContext } from './router';

export async function handleMeta(req: RequestContext): Promise<Response> {
  void req;
  let database: 'up' | 'down' = 'down';
  try {
    await db.$queryRaw`SELECT 1`;
    database = 'up';
  } catch {
    database = 'down';
  }
  return ok(
    {
      product: 'FirstLight',
      version: '2.2.0',
      mode: demoModeEnabled() ? 'demo' : 'operational',
      demoMode: demoModeEnabled(),
      database,
      authRequired: !demoModeEnabled(),
      providers: providerManifest(),
      ethics:
        'Humanitarian logistics, damage assessment, access analysis, and operational briefing only. No targeting, no offensive intelligence, no surveillance of individuals, no autonomous dispatch. Every recommendation is reviewable, explainable, and uncertainty-aware.',
    },
    req.requestId,
  );
}
