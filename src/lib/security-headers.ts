/** FirstLight — shared security header values (single source of truth).
 *
 * Used by BOTH next.config.ts (HTML/static assets) and
 * src/lib/server/http.ts (every API JSON response), so the operational
 * deployment speaks with one consistent security posture.
 *
 * CSP notes (pilot):
 *  - script-src needs 'unsafe-inline' because Next.js bootstraps with
 *    inline scripts; nonce-based strict CSP is the production upgrade
 *    (documented in SECURITY.md).
 *  - img-src/connect-src must allow https: because MapLibre fetches
 *    provider raster/vector tiles and font glyphs cross-origin.
 *  - frame-ancestors 'none' + X-Frame-Options DENY, base-uri and
 *    form-action 'self', object-src 'none' close the classic gaps.
 */

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https:",
  "font-src 'self' data: https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
];
