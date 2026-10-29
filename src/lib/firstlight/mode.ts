/* ==========================================================================
 * FirstLight — run-mode detection (Phase 0 correctness baseline).
 *
 * Two supported modes, never silently mixed:
 *  - 'demo'        — client-side simulated platform (static export friendly).
 *  - 'operational' — server-backed: database, auth, open-data adapters.
 *
 * `NEXT_PUBLIC_DEMO_MODE` is read so Next.js can inline it into the client
 * bundle at build time; `DEMO_MODE` works for server-only callers. Demo is
 * the DEFAULT: a static GitHub Pages build must never pretend to be
 * operational, while an operational deployment must opt out explicitly.
 * ========================================================================== */

export type RunMode = 'demo' | 'operational';

export function demoModeEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_DEMO_MODE ?? process.env.DEMO_MODE;
  return v !== 'false' && v !== '0';
}

export function runMode(): RunMode {
  return demoModeEnabled() ? 'demo' : 'operational';
}
