/* FirstLight — Review queue: low-confidence detections routed to
 * human-in-the-loop validation (active-learning loop from the blueprint).
 * Confirm / reject / reclassify — corrections become training labels. */

'use client';

import { Check, X, Pencil, CheckCircle2, XCircle, RotateCcw, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFirstLight } from '@/store/firstlight';
import { fmtInt, fmtPct } from '@/lib/firstlight/geo';
import type { DamageClass } from '@/lib/firstlight/types';

const DAMAGE_META: Record<DamageClass, { label: string; cls: string }> = {
  destroyed: { label: 'Destroyed', cls: 'border-red-500/60 bg-red-500/15 text-red-300' },
  major: { label: 'Major', cls: 'border-orange-500/60 bg-orange-500/15 text-orange-300' },
  minor: { label: 'Minor', cls: 'border-amber-500/60 bg-amber-500/15 text-amber-300' },
  none: { label: 'No damage', cls: 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300' },
};

export function ReviewPanel() {
  const raw = useFirstLight((s) => s.raw);
  const decision = useFirstLight((s) => s.decision);
  const reviewDecisions = useFirstLight((s) => s.reviewDecisions);
  const reviewClasses = useFirstLight((s) => s.reviewClasses);
  const setReviewDecision = useFirstLight((s) => s.setReviewDecision);
  const undoReview = useFirstLight((s) => s.undoReview);
  const selectZone = useFirstLight((s) => s.selectZone);

  if (!raw || !decision) return <div className="p-4 text-xs text-zinc-500">Loading…</div>;

  const queue = raw.buildings
    .filter((b) => b.reviewReason)
    .sort((a, b) => a.confidence - b.confidence);
  const pending = queue.filter((b) => !reviewDecisions.has(b.id));
  const confirmed = [...reviewDecisions.values()].filter((d) => d === 'confirmed').length;
  const rejected = [...reviewDecisions.values()].filter((d) => d === 'rejected').length;
  const reclassified = [...reviewDecisions.values()].filter((d) => d === 'reclassified').length;
  const reviewedTotal = reviewDecisions.size;
  const coverage = queue.length ? reviewedTotal / queue.length : 0;
  // "reviewed precision": confirmed true detections vs removed false positives
  const precision = confirmed + rejected > 0 ? confirmed / (confirmed + rejected) : 0;

  return (
    <div className="space-y-3 p-3">
      {/* stats */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-zinc-500">
          <ClipboardCheck className="h-3.5 w-3.5" />
          ACTIVE-LEARNING REVIEW QUEUE
        </div>
        <p className="text-[10px] leading-relaxed text-zinc-500">
          Detections routed here by epistemic uncertainty (conf &lt; 0.70, TTA variance,
          flood-edge ambiguity). Corrections become customer-specific labels — the
          reviewed longitudinal dataset is the moat.
        </p>
        <div className="grid grid-cols-4 gap-1.5 text-center">
          <Stat label="Pending" value={String(pending.length)} tone="amber" />
          <Stat label="Confirmed" value={String(confirmed)} tone="emerald" />
          <Stat label="Rejected" value={String(rejected)} tone="red" />
          <Stat label="Reclass" value={String(reclassified)} tone="zinc" />
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[9px] font-mono text-zinc-500">
            <span>review coverage {fmtPct(coverage, 0)}</span>
            <span>
              reviewed precision {precision > 0 ? fmtPct(precision, 0) : '—'}
              {precision > 0 && precision < 0.8 && (
                <span className="text-red-400"> (target ≥ 80%)</span>
              )}
            </span>
          </div>
          <div className="h-1.5 rounded bg-zinc-800 overflow-hidden">
            <div
              className="h-full rounded bg-gradient-to-r from-amber-500 to-emerald-500 transition-all"
              style={{ width: `${Math.min(100, coverage * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* queue list */}
      <div className="space-y-1.5">
        {queue.length === 0 && (
          <div className="text-[11px] text-zinc-500 px-1 py-4 text-center">
            No low-confidence detections in this event.
          </div>
        )}
        {queue.slice(0, 60).map((b) => {
          const d = reviewDecisions.get(b.id);
          const zone = decision.zoneIndex.get(b.zone);
          const effClass =
            d === 'reclassified' ? reviewClasses.get(b.id) ?? b.damage : b.damage;
          return (
            <div
              key={b.id}
              className={`rounded-lg border px-2.5 py-2 space-y-1.5 transition-colors ${
                d
                  ? 'border-zinc-800/60 bg-zinc-900/30 opacity-70'
                  : 'border-zinc-700 bg-zinc-900/70'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Badge
                    variant="outline"
                    className={`h-4 px-1.5 text-[8px] font-bold ${DAMAGE_META[effClass].cls}`}
                  >
                    {DAMAGE_META[effClass].label.toUpperCase()}
                  </Badge>
                  <span className="text-[9px] font-mono text-zinc-600 truncate">
                    {b.id.slice(-10)}
                  </span>
                </div>
                <span
                  className={`text-[10px] font-mono font-bold ${
                    b.confidence < 0.55 ? 'text-red-400' : 'text-amber-400'
                  }`}
                >
                  {b.confidence.toFixed(2)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 rounded bg-zinc-800 overflow-hidden">
                  <div
                    className={`h-full rounded ${
                      b.confidence < 0.55 ? 'bg-red-500' : 'bg-amber-500'
                    }`}
                    style={{ width: `${b.confidence * 100}%` }}
                  />
                </div>
                <span className="text-[9px] text-zinc-500 font-mono">
                  {b.reviewReason}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <button
                  className="text-[9px] font-mono text-zinc-500 hover:text-amber-400 transition-colors"
                  onClick={() => zone && selectZone(b.zone)}
                >
                  {zone ? `zone #${zone.rank} · ${fmtInt(zone.population)} pop` : b.zone.slice(0, 10)}
                </button>

                {d ? (
                  <div className="flex items-center gap-1.5">
                    <span className="flex items-center gap-1 text-[9px] font-semibold text-emerald-400">
                      {d === 'confirmed' && <CheckCircle2 className="h-3 w-3" />}
                      {d === 'rejected' && <XCircle className="h-3 w-3" />}
                      {d === 'reclassified' && <Pencil className="h-3 w-3" />}
                      {d}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5"
                      aria-label="undo review decision"
                      onClick={() => undoReview(b.id)}
                    >
                      <RotateCcw className="h-2.5 w-2.5 text-zinc-500" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      className="h-6 px-2 text-[9px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white"
                      onClick={() => setReviewDecision(b.id, 'confirmed')}
                    >
                      <Check className="h-3 w-3" />
                      Confirm
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[9px] font-bold border-red-500/50 text-red-300 hover:bg-red-500/10"
                      onClick={() => setReviewDecision(b.id, 'rejected')}
                    >
                      <X className="h-3 w-3" />
                      False pos.
                    </Button>
                    <ReclassifyMenu
                      current={b.damage}
                      onPick={(c) => setReviewDecision(b.id, 'reclassified', c)}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {queue.length > 60 && (
          <div className="text-[10px] text-zinc-600 text-center pt-1 font-mono">
            showing 60 of {queue.length} queued detections
          </div>
        )}
      </div>
    </div>
  );
}

function ReclassifyMenu({
  current,
  onPick,
}: {
  current: DamageClass;
  onPick: (c: DamageClass) => void;
}) {
  return (
    <Select onValueChange={(v) => onPick(v as DamageClass)}>
      <SelectTrigger className="h-6 w-[52px] text-[9px] font-bold border-zinc-600 bg-zinc-900 text-zinc-300 px-1.5">
        <Pencil className="h-2.5 w-2.5" />
        <SelectValue placeholder="Edit" />
      </SelectTrigger>
      <SelectContent className="bg-zinc-900 border-zinc-700 min-w-[130px]">
        {(['destroyed', 'major', 'minor', 'none'] as DamageClass[])
          .filter((c) => c !== current)
          .map((c) => (
            <SelectItem key={c} value={c} className="text-[10px]">
              → {DAMAGE_META[c].label}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'amber' | 'emerald' | 'red' | 'zinc';
}) {
  const tones = {
    amber: 'text-amber-300 border-amber-500/40',
    emerald: 'text-emerald-300 border-emerald-500/40',
    red: 'text-red-300 border-red-500/40',
    zinc: 'text-zinc-200 border-zinc-700',
  } as const;
  return (
    <div className={`rounded-md border bg-zinc-900/60 py-1.5 ${tones[tone]}`}>
      <div className="text-[8px] font-bold tracking-wider text-zinc-600 uppercase">
        {label}
      </div>
      <div className="text-[12px] font-mono font-bold mt-0.5">{value}</div>
    </div>
  );
}
