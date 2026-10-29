/* FirstLight — operational sitrep panel (server workflow).
 *
 * Sitreps are generated server-side from typed claim tools (every number
 * cites catalog asset IDs + query hashes). Approval freezes the claim set
 * by SHA-256 under the two-person rule (approver ≠ generator). The panel
 * renders the server's markdown verbatim — the browser composes nothing.
 */

'use client';

import { useEffect, useState } from 'react';
import { FileText, Loader2, RefreshCw, Snowflake, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useFirstLight } from '@/store/firstlight';
import {
  ApiError,
  approveServerSitrep,
  generateServerSitrep,
  getSession,
  listSitrepDrafts,
  type SitrepDraftView,
} from '@/lib/firstlight/server-client';

export function OperationalSitrepPanel() {
  const activeServerEventId = useFirstLight((s) => s.activeServerEventId);
  const [drafts, setDrafts] = useState<SitrepDraftView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [approveReason, setApproveReason] = useState('');

  const session = getSession();
  const canGenerate =
    session?.user.role === 'analyst' || session?.user.role === 'admin';
  const canApprove =
    session?.user.role === 'approver' || session?.user.role === 'admin';

  useEffect(() => {
    if (!activeServerEventId) return;
    let cancelled = false;
    void (async () => {
      setDrafts(null);
      setError(null);
      try {
        const d = await listSitrepDrafts(activeServerEventId);
        if (!cancelled) setDrafts(d);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load sitreps');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeServerEventId]);

  async function refresh() {
    if (!activeServerEventId) return;
    setBusy(true);
    try {
      const d = await listSitrepDrafts(activeServerEventId);
      setDrafts(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    if (!activeServerEventId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const draft = await generateServerSitrep(activeServerEventId);
      setNotice(
        `Draft v${draft.version} generated — claims frozen by SHA-256 on approval. ` +
          'Approval requires a different user (two-person rule).',
      );
      setSelectedDraftId(draft.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    const draft = drafts?.find((d) => d.id === selectedDraftId);
    if (!draft) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const approved = await approveServerSitrep(draft.id, {
        expectedVersion: draft.version,
        ...(approveReason.trim() ? { reason: approveReason.trim() } : {}),
      });
      setNotice(`Sitrep v${approved.version} APPROVED — claim set frozen by SHA-256.`);
      setApproveReason('');
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'stale_version') {
        setError(`${err.message} — refreshing drafts…`);
        await refresh();
      } else {
        setError(err instanceof Error ? err.message : 'Approval failed');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!activeServerEventId) {
    return (
      <div className="p-4 text-xs text-zinc-500">Select an event to load its sitreps.</div>
    );
  }

  // Newest draft by default; fall back to it when the selection goes stale
  // (e.g. after generating a new version).
  const selected =
    drafts?.find((d) => d.id === selectedDraftId) ?? drafts?.[0] ?? null;

  return (
    <div className="space-y-3 p-3">
      {/* header */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-zinc-500">
          <FileText className="h-3.5 w-3.5" />
          GROUNDED SITREPS · SERVER-COMPOSED
        </div>
        <p className="text-[10px] leading-relaxed text-zinc-500">
          Every figure in these drafts comes from a typed server query tool and
          cites catalog asset IDs with quality notes. Approval freezes the claim
          set by SHA-256; regeneration creates a new version — approved drafts
          stay byte-stable.
        </p>
        <div className="flex items-center gap-1.5">
          {canGenerate && (
            <Button
              size="sm"
              className="h-7 text-[10px] bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold"
              disabled={busy}
              onClick={() => void generate()}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Generate draft
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[10px] border-zinc-700 bg-zinc-900"
            disabled={busy}
            onClick={() => void refresh()}
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
        </div>
        {!canGenerate && (
          <div className="flex items-start gap-2 text-[10px] text-amber-400 border border-amber-500/30 bg-amber-500/10 rounded p-2">
            <ShieldAlert className="h-3.5 w-3.5 mt-px shrink-0" />
            <span>
              Generating sitreps requires the analyst or admin role — your role
              ({session?.user.role ?? 'unknown'}) can read only.
            </span>
          </div>
        )}
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

      {/* draft versions */}
      {drafts === null && (
        <div className="flex items-center gap-2 text-xs text-zinc-500 p-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading drafts…
        </div>
      )}
      {drafts !== null && drafts.length === 0 && (
        <div className="text-[11px] text-zinc-500 px-1 py-4 text-center">
          No sitrep drafts yet — generate one to start the approval workflow.
        </div>
      )}
      {drafts && drafts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {drafts.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelectedDraftId(d.id)}
              className={`rounded border px-2 py-1 text-[9px] font-mono transition-colors ${
                d.id === selectedDraftId
                  ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500'
              }`}
            >
              v{d.version} · {d.status}
              {d.approvedBy ? ` · ${d.approvedBy}` : ''}
            </button>
          ))}
        </div>
      )}

      {/* selected draft */}
      {selected && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-950/60">
            <Badge
              variant="outline"
              className={`h-4 px-1 text-[8px] font-bold ${
                selected.status === 'approved'
                  ? 'border-emerald-500/50 text-emerald-400'
                  : 'border-amber-500/50 text-amber-300'
              }`}
            >
              {selected.status.toUpperCase()}
            </Badge>
            <span className="text-[9px] font-mono text-zinc-500 truncate">
              claims sha256 {selected.claimsHash.slice(0, 16)}…
            </span>
            {selected.status === 'approved' && (
              <span className="ml-auto flex items-center gap-1 text-[9px] text-emerald-400">
                <Snowflake className="h-3 w-3" /> frozen
              </span>
            )}
          </div>
          <pre className="px-3 py-3 text-[10px] leading-relaxed text-zinc-300 whitespace-pre-wrap font-mono max-h-[420px] overflow-y-auto fl-scroll">
            {selected.markdown}
          </pre>
          {selected.status !== 'approved' && canApprove && (
            <div className="border-t border-zinc-800 px-3 py-2 space-y-1.5 bg-zinc-950/40">
              <div className="text-[9px] font-bold tracking-widest text-zinc-500">
                APPROVE (TWO-PERSON RULE — GENERATOR ≠ APPROVER)
              </div>
              <input
                value={approveReason}
                onChange={(e) => setApproveReason(e.target.value)}
                placeholder="Approval reason (optional, audited)"
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[10px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
              />
              <Button
                size="sm"
                className="h-7 text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                disabled={busy}
                onClick={() => void approve()}
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Approve + freeze
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
