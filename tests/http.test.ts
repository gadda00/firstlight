/* Unit tests — HTTP envelope, rate limiter (fixed window + lazy sweep). */

import { describe, expect, test } from 'bun:test';
import {
  ApiHttpError,
  errors,
  errorResponse,
  rateLimit,
  sweepRateLimitBuckets,
} from '@/lib/server/http';

describe('rate limiter (fixed window)', () => {
  test('allows up to the limit, blocks beyond it with retryAfter', () => {
    const key = `k-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      expect(rateLimit(key, 3, 60_000).allowed).toBe(true);
    }
    const blocked = rateLimit(key, 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
  });

  test('separate keys have separate buckets', () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    rateLimit(a, 1, 60_000);
    expect(rateLimit(a, 1, 60_000).allowed).toBe(false);
    expect(rateLimit(b, 1, 60_000).allowed).toBe(true);
  });

  test('sweep drops long-dead buckets so the map stays bounded', () => {
    const key = `sweep-${Math.random()}`;
    // Exhaust the bucket.
    rateLimit(key, 1, 60_000);
    expect(rateLimit(key, 1, 60_000).allowed).toBe(false);
    // Sweep from "5+ minutes in the future": the bucket is now dead state.
    const removed = sweepRateLimitBuckets(Date.now() + 6 * 60_000);
    expect(removed).toBeGreaterThanOrEqual(1);
    // A fresh window starts — previously-blocked key is allowed again.
    expect(rateLimit(key, 1, 60_000).allowed).toBe(true);
  });

  test('sweep keeps live buckets (only stale entries are dropped)', () => {
    const key = `live-${Math.random()}`;
    rateLimit(key, 1, 60_000);
    expect(rateLimit(key, 1, 60_000).allowed).toBe(false);
    // Sweep "now": bucket is < SWEEP_AGE_MS old, must survive.
    const removed = sweepRateLimitBuckets(Date.now());
    expect(removed).toBe(0);
    expect(rateLimit(key, 1, 60_000).allowed).toBe(false);
  });
});

describe('error envelope', () => {
  test('ApiHttpError maps to status/code/message with requestId', async () => {
    const res = errorResponse(errors.forbidden('nope'), 'req_test');
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string; message: string; requestId: string } };
    expect(json.error.code).toBe('forbidden');
    expect(json.error.message).toBe('nope');
    expect(json.error.requestId).toBe('req_test');
    expect(res.headers.get('x-request-id')).toBe('req_test');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('unexpected errors render the generic internal_error envelope (no leakage)', async () => {
    const res = errorResponse(new Error('postgres://secret@host/db failed'), 'req_x');
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('internal_error');
    expect(json.error.message).toBe('Internal error');
    expect(JSON.stringify(json)).not.toContain('secret');
  });

  test('retryable errors carry the retryable flag', async () => {
    const res = errorResponse(errors.upstream(' Provider responded 503 ', true), 'req_y');
    const json = (await res.json()) as { error: { retryable?: boolean } };
    expect(json.error.retryable).toBe(true);
  });

  test('rateLimited errors expose retryAfterSec details', async () => {
    const res = errorResponse(errors.rateLimited(30), 'req_z');
    const json = (await res.json()) as { error: { code: string; details?: { retryAfterSec: number } } };
    expect(json.error.code).toBe('rate_limited');
    expect(json.error.details?.retryAfterSec).toBe(30);
  });

  test('ApiHttpError is an Error subclass (instanceof checks work)', () => {
    const e = errors.badRequest('x');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ApiHttpError);
    expect(e.status).toBe(400);
    expect(e.retryable).toBe(false);
  });
});
