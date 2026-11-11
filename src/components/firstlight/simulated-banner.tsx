/* FirstLight — persistent simulated-exercise banner (demo mode only).
 * High-contrast, visible on every viewport, never dismissible: the demo must
 * be identified as a simulated exercise in the first viewport and kept so
 * for the whole session. */

'use client';

import { demoModeEnabled } from '@/lib/firstlight/mode';

export function SimulatedBanner() {
  if (!demoModeEnabled()) return null;
  return (
    <div
      role="status"
      aria-label="Simulated exercise notice"
      className="w-full bg-amber-400 text-zinc-950 border-b-2 border-amber-600 px-3 py-1.5 flex items-center gap-2 justify-center min-w-0"
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full bg-zinc-950"
      />
      <p className="text-[11px] sm:text-xs font-bold tracking-wide leading-tight text-center truncate">
        SIMULATED EXERCISE — generated scenario data; not current conditions
        <span className="hidden sm:inline font-semibold">
          {' '}
          · real basemap; every footprint, status, number &amp; report is generated
        </span>
      </p>
    </div>
  );
}
