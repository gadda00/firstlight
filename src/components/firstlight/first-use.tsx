/* FirstLight — first-use introduction (demo mode).
 * Shown once (localStorage-gated) before the first scenario run: what
 * FirstLight demonstrates, what the demo data actually is, and a short
 * guided flow. Accessible: role=dialog, Escape to close, focus starts on
 * the primary button. The Guide tab carries the same content for reuse. */

'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { demoModeEnabled } from '@/lib/firstlight/mode';

const KEY = 'fl-intro-seen-v1';

export function FirstUseIntro() {
  const isDemo = demoModeEnabled();
  const [open, setOpen] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isDemo) return;
    let unseen = false;
    try {
      unseen = !window.localStorage.getItem(KEY);
    } catch {
      /* storage unavailable — stay closed rather than nag */
    }
    if (!unseen) return;
    // deferred open avoids a synchronous setState inside the effect body
    const t = setTimeout(() => setOpen(true), 0);
    return () => clearTimeout(t);
  }, [isDemo]);

  useEffect(() => {
    if (!open) return;
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!isDemo || !open) return null;

  function close() {
    try {
      window.localStorage.setItem(KEY, '1');
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  return (
    <div
      className="fixed inset-0 z-[200] bg-zinc-950/90 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fl-intro-title"
      aria-describedby="fl-intro-sub"
    >
      <div className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-zinc-800">
          <div className="rounded-lg bg-amber-400/15 border border-amber-500/40 p-2 shrink-0">
            <AlertTriangle className="h-5 w-5 text-amber-400" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 id="fl-intro-title" className="text-base font-bold text-zinc-50 leading-snug">
              Before you begin: this is a simulated exercise
            </h2>
            <p id="fl-intro-sub" className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
              Every damage footprint, closure, facility status, population figure,
              score, and report in this demo is <b>procedurally generated fiction</b>.
              No satellite imagery was acquired or processed, and nothing here
              reflects current conditions anywhere.
            </p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          <section aria-label="What is real and what is generated" className="grid sm:grid-cols-2 gap-2.5">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              <div className="text-[10px] font-bold tracking-widest text-emerald-400 mb-1">
                WHAT IS REAL
              </div>
              <ul className="text-[11px] leading-relaxed text-zinc-300 list-disc list-inside space-y-0.5">
                <li>The basemap (© OpenStreetMap · Esri · CARTO)</li>
                <li>The compute: H3 zoning, need scores, routing math</li>
                <li>The workflow: review → sitrep → export</li>
              </ul>
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="text-[10px] font-bold tracking-widest text-amber-400 mb-1">
                WHAT IS GENERATED
              </div>
              <ul className="text-[11px] leading-relaxed text-zinc-300 list-disc list-inside space-y-0.5">
                <li>All hazards, damage classes &amp; “scenario scores”</li>
                <li>Roads, closures, facilities, population grid</li>
                <li>Sensor metadata (illustrative — not acquired)</li>
              </ul>
            </div>
          </section>

          <section aria-label="What you can safely learn">
            <div className="text-[10px] font-bold tracking-widest text-zinc-500 mb-1.5">
              WHAT YOU CAN SAFELY LEARN HERE
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-400">
              How a disaster-intelligence workflow is structured: how evidence
              layers become a transparent, uncertainty-aware priority ranking, how
              human review gates derived statistics, and how every exported
              artifact carries provenance. You can <b>not</b> learn real impact
              figures, real facility statuses, or real conditions from this demo.
            </p>
          </section>

          <section aria-label="Guided flow">
            <div className="text-[10px] font-bold tracking-widest text-zinc-500 mb-1.5 flex items-center gap-1.5">
              <Compass className="h-3.5 w-3.5" aria-hidden="true" />
              A 5-MINUTE GUIDED FLOW
            </div>
            <ol className="text-[11px] leading-relaxed text-zinc-300 space-y-1 list-decimal list-inside">
              <li>Pick a <b>Synthetic Scenario</b> in the header (same seed ⇒ same data, every time).</li>
              <li>Inspect the map layers — flood, damage, closures, facilities (all generated).</li>
              <li>Open <b>Zones</b> to see how the need score is computed and what makes it fragile.</li>
              <li>Review synthetic detections in <b>Review</b> (ephemeral here — no persistence, no training).</li>
              <li>Export a clearly-marked simulation artifact from <b>Export</b>.</li>
            </ol>
          </section>

          <p className="text-[10px] leading-relaxed text-zinc-500 border-t border-zinc-800 pt-3">
            Unfamiliar terms (H3, need score, SAR, STAC, exposure, DSWx, sitrep)?
            Everything is defined in the <b>Guide</b> tab. FirstLight is not an
            operational service and is not affiliated with any emergency agency.
          </p>
        </div>

        <div className="px-5 py-4 border-t border-zinc-800 flex justify-end gap-2 bg-zinc-900/60">
          <Button
            ref={primaryRef}
            onClick={close}
            className="h-9 px-4 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs"
          >
            Start the exercise
            <ArrowRight className="h-3.5 w-3.5 ml-1" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
