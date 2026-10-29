/* ==========================================================================
 * FirstLight — HTTP envelope, request IDs, rate limiting (Phase 1).
 *
 * Every API response is either
 *   { "data": … }                                   (success)
 *   { "error": { code, message, requestId, … } }    (failure)
 *
 * `code` is a stable machine string; `message` is safe to show to a user
 * (never includes provider URLs, SQL, or stack traces); `requestId` ties the
 * response to structured logs; `retryable` marks transient conditions.
 * ========================================================================== */

import { randomBytes } from 'node:crypto';
import { ZodError, type ZodType } from 'zod';

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    retryable?: boolean;
    details?: unknown;
  };
}

export class ApiHttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryable = false,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiHttpError';
  }
}

export const errors = {
  badRequest: (msg: string, details?: unknown) =>
    new ApiHttpError(400, 'bad_request', msg, false, details),
  unauthorized: (msg = 'Authentication required') =>
    new ApiHttpError(401, 'unauthorized', msg),
  forbidden: (msg = 'Insufficient role for this action') =>
    new ApiHttpError(403, 'forbidden', msg),
  notFound: (msg = 'Resource not found') =>
    new ApiHttpError(404, 'not_found', msg),
  conflict: (msg: string, details?: unknown) =>
    new ApiHttpError(409, 'conflict', msg, false, details),
  stale: (msg: string, details?: unknown) =>
    new ApiHttpError(409, 'stale_version', msg, false, details),
  tooLarge: (msg = 'Request body too large') =>
    new ApiHttpError(413, 'payload_too_large', msg),
  rateLimited: (retryAfterSec: number) =>
    new ApiHttpError(429, 'rate_limited', 'Too many requests — slow down', true, {
      retryAfterSec,
    }),
  upstream: (msg: string, retryable = true) =>
    new ApiHttpError(502, 'upstream_error', msg, retryable),
  blockedDependency: (msg: string) =>
    new ApiHttpError(503, 'blocked_dependency', msg, false),
  internal: (msg = 'Internal error') =>
    new ApiHttpError(500, 'internal_error', msg),
};

export function newRequestId(): string {
  return `req_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`;
}

export function jsonResponse(
  status: number,
  body: unknown,
  requestId: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-request-id': requestId,
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export function ok(data: unknown, requestId: string, status = 200): Response {
  return jsonResponse(status, { data }, requestId);
}

export function errorResponse(err: unknown, requestId: string): Response {
  let status = 500;
  let body: ErrorBody['error'] = {
    code: 'internal_error',
    message: 'Internal error',
    requestId,
  };
  if (err instanceof ApiHttpError) {
    status = err.status;
    body = {
      code: err.code,
      message: err.message,
      requestId,
      retryable: err.retryable || undefined,
      details: err.details,
    };
  } else if (err instanceof ZodError) {
    status = 400;
    body = {
      code: 'validation_failed',
      message: 'Request body failed schema validation',
      requestId,
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  } else {
    // Server-side logs only — the client envelope never sees internals
    // (provider URLs, SQL, stack traces). Production keeps enough context
    // (name + message + stack) to actually debug; the response body stays
    // generic either way.
    if (err instanceof Error) {
      console.error(`[${requestId}] ${err.name}: ${err.message}`);
      if (err.stack) console.error(err.stack);
    } else {
      console.error(`[${requestId}]`, err);
    }
  }
  // Envelope contract: { "error": { code, message, requestId, … } }
  return jsonResponse(status, { error: body }, requestId);
}

/** Wrap a route handler with request-ID generation and the error envelope. */
export function withEnvelope(
  handler: (req: Request, requestId: string) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const requestId = req.headers.get('x-request-id') ?? newRequestId();
    try {
      return await handler(req, requestId);
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}

/** Parse + validate a JSON body with a hard size cap. */
export async function parseBody<T>(
  req: Request,
  schema: ZodType<T>,
  maxBytes = 64 * 1024,
): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw errors.tooLarge();
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw errors.badRequest('Body is not valid JSON');
  }
  return schema.parse(raw);
}

/* --------------------------------------------------------------- rate limit */

/**
 * Fixed-window in-memory rate limiter. Adequate for a single pilot node;
 * the production path is Redis (see OPERATIONS_RUNBOOK.md — the interface
 * stays the same so the swap is contained to this function).
 */
const buckets = new Map<string, { windowStart: number; count: number }>();

/** Buckets whose window closed more than this long ago are dead entries. */
const SWEEP_AGE_MS = 5 * 60_000;
let lastSweepAt = 0;

/** Drop long-dead buckets so the map stays bounded over a long-running
 * node (a client that never returns would otherwise leak its entry forever).
 * Exported for tests; rateLimit() invokes it lazily at most once a minute. */
export function sweepRateLimitBuckets(now = Date.now()): number {
  let removed = 0;
  for (const [key, b] of buckets) {
    if (now - b.windowStart > SWEEP_AGE_MS) {
      buckets.delete(key);
      removed++;
    }
  }
  return removed;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  if (now - lastSweepAt > 60_000) {
    lastSweepAt = now;
    sweepRateLimitBuckets(now);
  }
  const b = buckets.get(key);
  if (!b || now - b.windowStart >= windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return { allowed: true, retryAfterSec: 0 };
  }
  b.count++;
  if (b.count > limit) {
    return { allowed: false, retryAfterSec: Math.ceil((b.windowStart + windowMs - now) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** Extract a stable client key (session token hash if present, else IP). */
export function clientKey(req: Request, tokenHash?: string): string {
  if (tokenHash) return `t:${tokenHash.slice(0, 16)}`;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'local';
  return `ip:${ip}`;
}
