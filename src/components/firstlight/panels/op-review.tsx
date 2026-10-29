/* FirstLight — operational review panel (server workflow).
 *
 * Renders the server-side review queue: tasks are immutable, decisions are
 * attributed + reasoned, and the version guard surfaces optimistic-
 * concurrency conflicts honestly instead of silently overwriting. After a
 * decision lands, the layer is reloaded so scores reflect the server's
 * recomputation — the browser never re-derives them.
 */

'use client';

import { useEffect, useState } from 'react';
import { ClipboardCheck, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFirstLight } from '@/store/firstlight';
import {
  ApiError,
  decideReviewTask,
  getSession,
  listReviewTasks,
  type ReviewTaskView,
} from '@/lib/firstlight/server-client';
import { fmtPct } from '@/lib/firstlight/geo';

const DAMAGE_CLASSES = ['destroyed', 'major', 'minor', 'none'] as const;

export function OperationalReviewPanel() {
  const activeServerEventId = useFirstLight((s) => s.activeServerEventId);
  const loadServerEvent = useFirstLight((s) => s.loadServerEvent);
  const [tasks, setTasks] = useState<ReviewTaskView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [pendingDecision, setPendingDecision] = useState<
    'confirmed' | 'rejected' | 'reclassified'
  >('confirmed');
  const [newClass, setNewClass] = useState<string>('none');
  const [selectedTask, setSelectedTask] = useState<string | null>(null);

  const session = getSession();
  const canDecide =
    session?.user.role === 'reviewer' || session?.user.role === 'admin';

  useEffect(() => {
    if (!activeServerEventId) return;
    let cancelled = false;
    void (async () => {
      setTasks(null);
      setError(null);
      try {
        const t = await listReviewTasks(activeServerEventId);
        if (!cancelled) setTasks(t);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load tasks');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeServerEventId]);

  async function refresh(eventId: string, reloadLayer: boolean) {
    setBusy(true);
    setError(null);
    try {
      setTasks(await listReviewTasks(eventId));
      if (reloadLayer) {
        // Server recomputes scores from the immutable decision history.
        await loadServerEvent(eventId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setBusy(false);
    }
  }

  async function submit(task: ReviewTaskView) {
    if (!activeServerEventId) return;
    if (reason.trim().length < 4) {
      setError('A decision reason is required (min 4 characters) — decisions are audited.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await decideReviewTask(task.id, {
        decision: pendingDecision,
        reason: reason.trim(),
        ...(pendingDecision === 'reclassified' ? { newClass } : {}),
        version: task.version,
      });
      setReason('');
      setSelectedTask(null);
      setNotice(
        `Decision recorded (v${task.version} → v${task.version + 1}). Scores are recomputed server-side on the next layer read.`,
      );
      await refresh(activeServerEventId, true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'stale_version') {
        setError(`${err.message} — reloading the queue…`);
        await refresh(activeServerEventId, false);
      } else {
        setError(err instanceof Error ? err.message : 'Decision failed');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!activeServerEventId) {
    return (
      <div className="p-4 text-xs text-zinc-500">
        Select an event to load its review queue.
      </div>
    );
  }

  const open = (tasks ?? []).filter((t) => t.status === 'open');
  const decided = (tasks ?? []).filter((t) => t.status === 'decided');
  const coverage = tasks && tasks.length > 0 ? decided.length / tasks.length : 0;

  return (
    <div className="space-y-3 p-3">
      {/* summary */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-zinc-500">
          <ClipboardCheck className="h-3.5 w-3.5" />
          SERVER REVIEW QUEUE · IMMUTABLE DECISIONS
        </div>
        <p className="text-[10px] leading-relaxed text-zinc-500">
          Every decision is attributed, reasoned, and append-only (audit-chained).
          Decisions update scores on the next server layer read — this browser
          never re-derives them. Concurrency is version-guarded.
        </p>
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <Stat label="Open" value={String(open.length)} tone="amber" />
          <Stat label="Decided" value={String(decided.length)} tone="emerald" />
          <Stat label="Coverage" value={fmtPct(coverage, 0)} tone="zinc" />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[10px] border-zinc-700 bg-zinc-900"
          disabled={busy}
          onClick={() => void refresh(activeServerEventId, false)}
        >
          <RefreshCw className="h-3 w-3" /> Refresh queue
        </Button>
      </div>

      {error && (
        <div className="text-[10px] text-red-400 border border-red-500/30 bg-red-500/10 rounded p-2">
          {error}
        </div>
      )}
      {notice && (
        <div className="text-[10px] text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded p-2">
          {notice}
        </div>
      )}
      {!canDecide && (
        <div className="flex items-start gap-2 text-[10px] text-amber-400 border border-amber-500/30 bg-amber-500/10 rounded p-2">
          <ShieldAlert className="h-3.5 w-3.5 mt-px shrink-0" />
          <span>
            Your role ({session?.user.role ?? 'unknown'}) cannot decide review
            tasks — the queue is read-only for you. The server enforces this;
            this notice is UX only.
          </span>
        </div>
      )}

      {/* queue */}
      {tasks === null && (
        <div className="flex items-center gap-2 text-xs text-zinc-500 p-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading tasks…
        </div>
      )}
      {tasks !== null && tasks.length === 0 && (
        <div className="text-[11px] text-zinc-500 px-1 py-4 text-center">
          No review tasks for this event.
        </div>
      )}
      <div className="space-y-1.5">
        {tasks?.slice(0, 40).map((t) => {
          const isSelected = selectedTask === t.id;
          const last = t.decisions[t.decisions.length - 1];
          return (
            <div
              key={t.id}
              className={`rounded-lg border px-2.5 py-2 space-y-1.5 ${
                t.status === 'decided'
                  ? 'border-zinc-800/60 bg-zinc-900/30'
                  : 'border-zinc-800 bg-zinc-900/50'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-zinc-300 truncate">
                  {t.targetId.slice(0, 14)}
                </span>
                <Badge variant="outline" className="h-4 px-1 text-[8px] font-bold">
                  {t.targetType}
                </Badge>
                <span className="ml-auto text-[9px] font-mono text-zinc-500">
                  conf {t.modelConfidence.toFixed(2)} · P{t.priority} · v{t.version}
                </span>
                {t.status === 'decided' && (
                  <Badge
                    variant="outline"
                    className="h-4 px-1 text-[8px] font-bold border-emerald-500/50 text-emerald-400"
                  >
                    DECIDED
                  </Badge>
                )}
              </div>
              <div className="text-[10px] text-zinc-500">{t.reason}</div>
              {last && (
                <div className="text-[9px] font-mono text-zinc-600 border-l-2 border-zinc-700 pl-2">
                  {last.decision}
                  {last.newClass ? ` → ${last.newClass}` : ''} · {last.reviewer} ·{' '}
                  {last.reason}
                </div>
              )}
              {canDecide && t.status === 'open' && (
                <div className="pt-1">
                  {isSelected ? (
                    <div className="space-y-1.5 border-t border-zinc-800 pt-2">
                      <div className="flex items-center gap-1.5">
                        <Select
                          value={pendingDecision}
                          onValueChange={(v) =>
                            setPendingDecision(v as typeof pendingDecision)
                          }
                        >
                          <SelectTrigger className="h-7 text-[10px] bg-zinc-900 border-zinc-700 w-[130px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-zinc-900 border-zinc-700">
                            <SelectItem value="confirmed" className="text-xs">Confirmed</SelectItem>
                            <SelectItem value="rejected" className="text-xs">Rejected</SelectItem>
                            <SelectItem value="reclassified" className="text-xs">Reclassify</SelectItem>
                          </SelectContent>
                        </Select>
                        {pendingDecision === 'reclassified' && (
                          <Select value={newClass} onValueChange={setNewClass}>
                            <SelectTrigger className="h-7 text-[10px] bg-zinc-900 border-zinc-700 w-[120px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-zinc-900 border-zinc-700">
                              {DAMAGE_CLASSES.map((c) => (
                                <SelectItem key={c} value={c} className="text-xs">
                                  {c}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                      <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Reason (required, audited) — e.g. 'roof line visible on imagery, class is correct'"
                        rows={2}
                        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[10px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                      />
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          className="h-7 text-[10px] bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold"
                          disabled={busy}
                          onClick={() => void submit(t)}
                        >
                          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                          Submit decision
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[10px] border-zinc-700"
                          onClick={() => setSelectedTask(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[9px] border-zinc-700 bg-zinc-900"
                      onClick={() => {
                        setSelectedTask(t.id);
                        setPendingDecision('confirmed');
                        setReason('');
                      }}
                    >
                      Decide…
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'amber' | 'emerald' | 'zinc' }) {
  const tones = {
    amber: 'text-amber-300',
    emerald: 'text-emerald-300',
    zinc: 'text-zinc-300',
  } as const;
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 py-1.5">
      <div className="text-[8px] font-bold tracking-[0.14em] text-zinc-600">{label}</div>
      <div className={`text-sm font-bold font-mono ${tones[tone]}`}>{value}</div>
    </div>
  );
}
