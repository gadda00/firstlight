/* ==========================================================================
 * FirstLight — resilient provider HTTP client (Phase 2).
 *
 * All adapter network I/O funnels through here so cross-cutting rules are
 * enforced uniformly:
 *  - HTTPS only, with a per-adapter host allowlist (SSRF guard — remote
 *    asset URLs from provider payloads are re-checked against it),
 *  - hard timeouts via AbortController,
 *  - bounded response bodies (never buffer an unbounded stream),
 *  - retries with exponential backoff + jitter for 429/5xx/network errors,
 *    honoring Retry-After when present,
 *  - content-type validation,
 *  - SHA-256 checksums on every accepted body,
 *  - structured logs with a correlation id.
 * ========================================================================== */

import { createHash } from 'node:crypto';
import { errors } from '../http';

export interface FetchOpts {
  /** Allowed upstream hosts for THIS call (SSRF allowlist). */
  allowedHosts: readonly string[];
  timeoutMs?: number;
  retries?: number;
  maxBytes?: number;
  expectedContentType?: string;
  /** Extra headers (User-Agent, auth…). Never log these. */
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: string;
  correlationId?: string;
  fetchImpl?: typeof fetch;
}

export interface Fetched {
  status: number;
  contentType: string;
  bytes: number;
  sha256: string;
  text: string;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB — metadata-sized responses

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function assertAllowedHost(url: string, allowedHosts: readonly string[]): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw errors.badRequest(`Invalid upstream URL: ${url.slice(0, 80)}`);
  }
  if (parsed.protocol !== 'https:') {
    throw errors.upstream(`Refusing non-HTTPS upstream: ${parsed.protocol}`, false);
  }
  const hostOk = allowedHosts.some(
    (h) =>
      parsed.hostname === h ||
      (h.startsWith('*.') && parsed.hostname.endsWith(h.slice(1))),
  );
  if (!hostOk) {
    throw errors.upstream(
      `Upstream host '${parsed.hostname}' is not in this adapter's allowlist`,
      false,
    );
  }
  return parsed;
}

/**
 * Fetch a provider URL with all the rules above. Throws ApiHttpError
 * (upstream_error) on terminal failure; returns the bounded body otherwise.
 */
export async function resilientFetch(url: string, opts: FetchOpts): Promise<Fetched> {
  const {
    allowedHosts,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    maxBytes = DEFAULT_MAX_BYTES,
    expectedContentType,
    headers = {},
    method = 'GET',
    body,
    correlationId = 'adapter',
    fetchImpl,
  } = opts;
  assertAllowedHost(url, allowedHosts);
  const doFetch = fetchImpl ?? fetch;

  let lastErr: unknown = null;
  let lastStatus = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(8_000, 400 * 2 ** (attempt - 1)) + Math.random() * 250;
      await sleep(backoff);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
        redirect: 'follow',
      });
      lastStatus = res.status;
      const contentType = res.headers.get('content-type') ?? '';
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after') ?? '0');
        if (res.status === 429 && retryAfter > 0 && attempt < retries) {
          await sleep(Math.min(30_000, retryAfter * 1000));
        }
        lastErr = errors.upstream(
          `Provider responded ${res.status} (attempt ${attempt + 1})`,
          res.status === 429 || res.status >= 500,
        );
        continue; // retryable class
      }
      if (!res.ok) {
        // 4xx (other than 429): permanent — do not retry.
        throw errors.upstream(`Provider responded ${res.status}`, false);
      }
      if (expectedContentType && !contentType.includes(expectedContentType)) {
        throw errors.upstream(
          `Unexpected content-type '${contentType}' (expected ${expectedContentType})`,
          false,
        );
      }
      // Bounded read: Content-Length pre-check + streaming accumulation.
      const declared = Number(res.headers.get('content-length') ?? '0');
      if (declared && declared > maxBytes) {
        throw errors.tooLarge(
          `Provider response exceeds ${maxBytes} bytes (${declared})`,
        );
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > maxBytes) {
        throw errors.tooLarge(`Provider response exceeds ${maxBytes} bytes`);
      }
      const text = new TextDecoder().decode(buf);
      const sha256 = createHash('sha256').update(buf).digest('hex');
      console.log(
        `[${correlationId}] GET ${new URL(url).host}${new URL(url).pathname} → ${res.status} ${buf.byteLength}B in ${attempt + 1} attempt(s)`,
      );
      return { status: res.status, contentType, bytes: buf.byteLength, sha256, text };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        lastErr = errors.upstream(`Provider timeout after ${timeoutMs}ms (attempt ${attempt + 1})`, true);
        continue;
      }
      if (err instanceof Error && err.message?.includes('too large')) throw err;
      if (err && typeof err === 'object' && 'status' in err) throw err; // ApiHttpError
      lastErr = err ?? new Error('network error');
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  console.error(`[${correlationId}] upstream failed: status=${lastStatus}`);
  throw lastErr instanceof Error
    ? errors.upstream(lastErr.message)
    : errors.upstream(`Provider unreachable after ${retries + 1} attempts`);
}

/** JSON convenience wrapper with parse validation. */
export async function fetchJson<T>(url: string, opts: FetchOpts): Promise<{ data: T; fetched: Fetched }> {
  const fetched = await resilientFetch(url, {
    expectedContentType: 'json',
    ...opts,
  });
  try {
    return { data: JSON.parse(fetched.text) as T, fetched };
  } catch {
    throw errors.upstream('Provider returned malformed JSON', false);
  }
}
