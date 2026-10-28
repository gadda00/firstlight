/* FirstLight — pipeline run overlay: paced stage animation mirroring the
 * blueprint's 5-stage pipeline (STAC ingest → preprocess → inference →
 * decision → delivery). Compute is real; timings are demo-scaled. */

'use client';

import { CheckCircle2, Loader2, Cpu, Database, Layers, Map, FileDown, ChevronRight } from 'lucide-react';
import { useFirstLight } from '@/store/firstlight';
import { Button } from '@/components/ui/button';
import { eventById } from '@/lib/firstlight/events';

const STAGE_ICONS = [Database, Cpu, Layers, Map, FileDown];

export function PipelineOverlay() {
  const phase = useFirstLight((s) => s.phase);
  const stageIndex = useFirstLight((s) => s.stageIndex);
  const raw = useFirstLight((s) => s.raw);
  const eventId = useFirstLight((s) => s.eventId);
  const finishPipeline = useFirstLight((s) => s.finishPipeline);

  if (phase !== 'running' || !raw) return null;
  const meta = eventById(eventId);
  const stages = raw.stages;
  const totalMs = stages.reduce((a, s) => a + s.ms, 0);
  const pct = Math.min(100, (stageIndex / stages.length) * 100);

  return (
    <div className="fixed inset-0 z-[100] bg-zinc-950/97 backdrop-blur-md flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-3 mb-1">
          <svg width="44" height="44" viewBox="0 0 64 64">
            <rect width="64" height="64" rx="14" fill="#18181b" />
            <path d="M14 46a18 18 0 0 1 36 0z" fill="#f59e0b" />
            <circle cx="32" cy="46" r="5.5" fill="#fde68a" />
            <rect x="10" y="49" width="44" height="3.5" rx="1.75" fill="#f59e0b" />
            <path d="M20 22a12 12 0 0 1 24 0" fill="none" stroke="#fbbf24" strokeWidth="2.4" strokeLinecap="round" opacity="0.55" />
          </svg>
          <div>
            <div className="text-xl font-black tracking-tight text-zinc-50">
              Processing run
            </div>
            <div className="text-xs text-zinc-500 font-mono">
              {meta.name} · {meta.location}
            </div>
          </div>
        </div>

        <div className="mt-5 h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-500 to-red-500 transition-all duration-300 rounded-full"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5 mb-4 text-[10px] font-mono text-zinc-500">
          <span>
            stage {Math.min(stageIndex + 1, stages.length)} / {stages.length}
          </span>
          <span>target &lt; 30 min (demo-scaled: {(totalMs / 1000).toFixed(1)} s)</span>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 divide-y divide-zinc-800/70">
          {stages.map((st, i) => {
            const done = i < stageIndex;
            const active = i === stageIndex;
            const Icon = STAGE_ICONS[i % STAGE_ICONS.length];
            return (
              <div
                key={st.name}
                className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
                  active ? 'bg-amber-500/5' : ''
                }`}
              >
                {done ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                ) : active ? (
                  <Loader2 className="h-4 w-4 text-amber-400 animate-spin shrink-0" />
                ) : (
                  <Icon className="h-4 w-4 text-zinc-600 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-[13px] font-semibold ${
                      done
                        ? 'text-zinc-400'
                        : active
                          ? 'text-zinc-100'
                          : 'text-zinc-600'
                    }`}
                  >
                    {st.name}
                  </div>
                  <div className="text-[10px] text-zinc-600 truncate font-mono">
                    {st.detail}
                  </div>
                </div>
                <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                  {st.ms} ms
                </span>
                {active && (
                  <ChevronRight className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-between items-center mt-4">
          <span className="text-[10px] text-zinc-600 font-mono">
            all layers procedurally simulated · deterministic seed {meta.seed}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-zinc-700 text-zinc-400"
            onClick={finishPipeline}
          >
            Skip
          </Button>
        </div>
      </div>
    </div>
  );
}
