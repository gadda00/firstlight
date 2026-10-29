/* ==========================================================================
 * API router — single dispatcher for the operational API.
 *
 * All endpoints live under /api/* and are dispatched here (one serverless
 * surface, mirroring the hazina-assist pattern proven on Vercel). Every
 * response carries the error envelope + request id from http.ts.
 *
 * Route table (method, pattern, auth, capability):
 *   GET  /api/meta                     public
 *   GET  /api/health                   public
 *   POST /api/auth/login               public (rate-limited)
 *   POST /api/auth/logout              session
 *   GET  /api/me                       session
 *   GET  /api/events                   session (read)
 *   POST /api/events                   analyst+ (createEvent)
 *   GET  /api/events/:id               session (read, org-scoped)
 *   POST /api/events/:id/ingest        analyst+ (runIngestion)
 *   GET  /api/events/:id/catalog       session (read)
 *   GET  /api/events/:id/layer         session (read)
 *   GET  /api/events/:id/review/tasks  session (read)
 *   POST /api/review/tasks/:id/decide  reviewer+ (reviewDecide)
 *   GET  /api/events/:id/sitrep        session (read)
 *   POST /api/events/:id/sitrep/generate   analyst+ (generateSitrep)
 *   POST /api/sitrep/:id/approve       approver+ (approveSitrep)
 *   GET  /api/events/:id/exports       session (read)
 *   POST /api/events/:id/exports       analyst+ (createExport)
 *   POST /api/events/:id/bundle        analyst+ (createExport)
 *   POST /api/bundle/:id/import        session (read)
 *   POST /api/bundle/:id/revoke        approver+ (createExport→revoke)
 *   GET  /api/audit                    approver+ (readAudit)
 *   POST /api/audit/verify             approver+ (readAudit)
 *   GET/POST /api/score-configs        read / admin (publishScoreConfig)
 * ========================================================================== */

import { db } from '@/lib/server/db';
import {
  authenticate,
  login,
  logout,
  publicUser,
  requireAuth,
  requireCapability,
  type AuthContext,
  type Capability,
} from '@/lib/server/auth';
import { errorResponse, jsonResponse, newRequestId, rateLimit, clientKey, errors } from '@/lib/server/http';

export interface RequestContext {
  req: Request;
  requestId: string;
  segments: string[];
  auth: AuthContext | null;
}

type Handler = (ctx: RequestContext) => Promise<Response>;

interface Route {
  method: string;
  /** e.g. ['events', ':id', 'ingest'] */
  pattern: string[];
  auth: 'public' | 'session';
  capability?: Capability;
  handler: Handler;
}

/* ------------------------------------------------------------------ handlers */

import { handleMeta } from './meta';
import { handleHealth } from './health';
import {
  handleListEvents,
  handleCreateEvent,
  handleGetEvent,
  handleIngest,
  handleCatalog,
  handleLayer,
  handleEventStatus,
} from './events';
import { handleListReviewTasks, handleReviewDecide } from './review';
import {
  handleGetSitrep,
  handleGenerateSitrep,
  handleApproveSitrep,
} from './sitrep';
import {
  handleListExports,
  handleCreateExport,
  handleCreateBundle,
  handleImportBundle,
  handleRevokeBundle,
} from './exports';
import { handleListAudit, handleVerifyAudit } from './audit';
import {
  handleListScoreConfigs,
  handleCreateScoreConfig,
} from './score-configs';
import { handleLogin, handleLogout, handleMe } from './auth';

const ROUTES: Route[] = [
  { method: 'GET', pattern: ['meta'], auth: 'public', handler: handleMeta },
  { method: 'GET', pattern: ['health'], auth: 'public', handler: handleHealth },

  { method: 'POST', pattern: ['auth', 'login'], auth: 'public', handler: handleLogin },
  { method: 'POST', pattern: ['auth', 'logout'], auth: 'session', handler: handleLogout },
  { method: 'GET', pattern: ['me'], auth: 'session', handler: handleMe },

  { method: 'GET', pattern: ['events'], auth: 'session', handler: handleListEvents },
  { method: 'POST', pattern: ['events'], auth: 'session', capability: 'createEvent', handler: handleCreateEvent },
  { method: 'GET', pattern: ['events', ':id'], auth: 'session', handler: handleGetEvent },
  { method: 'PATCH', pattern: ['events', ':id'], auth: 'session', capability: 'createEvent', handler: handleEventStatus },
  { method: 'POST', pattern: ['events', ':id', 'ingest'], auth: 'session', capability: 'runIngestion', handler: handleIngest },
  { method: 'GET', pattern: ['events', ':id', 'catalog'], auth: 'session', handler: handleCatalog },
  { method: 'GET', pattern: ['events', ':id', 'layer'], auth: 'session', handler: handleLayer },

  { method: 'GET', pattern: ['events', ':id', 'review', 'tasks'], auth: 'session', handler: handleListReviewTasks },
  { method: 'POST', pattern: ['review', 'tasks', ':id', 'decide'], auth: 'session', capability: 'reviewDecide', handler: handleReviewDecide },

  { method: 'GET', pattern: ['events', ':id', 'sitrep'], auth: 'session', handler: handleGetSitrep },
  { method: 'POST', pattern: ['events', ':id', 'sitrep', 'generate'], auth: 'session', capability: 'generateSitrep', handler: handleGenerateSitrep },
  { method: 'POST', pattern: ['sitrep', ':id', 'approve'], auth: 'session', capability: 'approveSitrep', handler: handleApproveSitrep },

  { method: 'GET', pattern: ['events', ':id', 'exports'], auth: 'session', handler: handleListExports },
  { method: 'POST', pattern: ['events', ':id', 'exports'], auth: 'session', capability: 'createExport', handler: handleCreateExport },
  { method: 'POST', pattern: ['events', ':id', 'bundle'], auth: 'session', capability: 'createExport', handler: handleCreateBundle },
  { method: 'POST', pattern: ['bundle', ':id', 'import'], auth: 'session', handler: handleImportBundle },
  { method: 'POST', pattern: ['bundle', ':id', 'revoke'], auth: 'session', capability: 'approveSitrep', handler: handleRevokeBundle },

  { method: 'GET', pattern: ['audit'], auth: 'session', capability: 'readAudit', handler: handleListAudit },
  { method: 'POST', pattern: ['audit', 'verify'], auth: 'session', capability: 'readAudit', handler: handleVerifyAudit },

  { method: 'GET', pattern: ['score-configs'], auth: 'session', handler: handleListScoreConfigs },
  { method: 'POST', pattern: ['score-configs'], auth: 'session', capability: 'publishScoreConfig', handler: handleCreateScoreConfig },
];

function matchRoute(method: string, segments: string[]): { route: Route; params: Record<string, string> } | null {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    if (route.pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < route.pattern.length; i++) {
      const p = route.pattern[i];
      if (p.startsWith(':')) {
        params[p.slice(1)] = decodeURIComponent(segments[i]);
      } else if (p !== segments[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

/** Shared param bag: handlers read via ctx helper below. */
const paramBag = new WeakMap<RequestContext, Record<string, string>>();
export function routeParam(ctx: RequestContext, name: string): string {
  return paramBag.get(ctx)?.[name] ?? '';
}

export async function dispatch(req: Request): Promise<Response> {
  const requestId = req.headers.get('x-request-id') ?? newRequestId();
  const url = new URL(req.url);
  const segments = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);

  // Global guards for mutating requests: method check + body size cap.
  if (!['GET', 'POST', 'PATCH', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return errorResponse(errors.badRequest(`Method ${req.method} not allowed`), requestId);
  }
  if (req.method === 'OPTIONS') {
    return jsonResponse(204, {}, requestId);
  }

  const match = matchRoute(req.method, segments);
  if (!match) {
    return errorResponse(
      errors.notFound(`No API route for ${req.method} /api/${segments.join('/')}`),
      requestId,
    );
  }

  // Rate limit auth attempts aggressively; everything else moderately.
  const rlKey = `${clientKey(req)}:${req.method}:${segments[0]}`;
  const limit = segments[0] === 'auth' ? 20 : 300;
  const rl = rateLimit(rlKey, limit, 60_000);
  if (!rl.allowed) {
    const res = errorResponse(errors.rateLimited(rl.retryAfterSec), requestId);
    return new Response(res.body, {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-request-id': requestId,
        'retry-after': String(rl.retryAfterSec),
      },
    });
  }

  const auth = match.route.auth === 'public' ? await authenticate(db, req) : await authenticate(db, req);
  const ctx: RequestContext = { req, requestId, segments, auth };
  paramBag.set(ctx, match.params);

  // Auth + capability checks run INSIDE the envelope so failures render as
  // proper 401/403 JSON errors (never unhandled 500s).
  try {
    if (match.route.auth !== 'public') {
      ctx.auth = await requireAuth(db, req);
    }
    if (match.route.capability && ctx.auth) {
      requireCapability(ctx.auth, match.route.capability);
    }
    return await match.route.handler(ctx);
  } catch (err) {
    return errorResponse(err, requestId);
  }
}

export { login, logout, publicUser };
