/* FirstLight — operational export panel (server workflow).
 *
 * Exports are server-built, checksummed, and carry their manifest + synthetic
 * labels inline. sitrep.md is approval-gated server-side. Offline bundles
 * embed per-layer checksums, expiry, and revocation state. This panel lists,
 * builds, and downloads them — the browser composes nothing itself.
 */

'use client';

import { useEffect, useState } from 'react';
import { Download, Loader2, Package, RefreshCw, ShieldAlert } from 'lucide-react';
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
  createServerBundle,
  createServerExport,
  downloadText,
  getSession,
  listExports,
  type BundleView,
  type ExportView,
} from '@/lib/firstlight/server-client';

const EXPORT_KINDS = [
  'damage.geojson',
  'flood.geojson',
  'zones.geojson',
  'roads.geojson',
  'routes.geojson',
  'zones.csv',
  'sitrep.md',
  'audit.json',
] as const;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function OperationalExportPanel() {
  const activeServerEventId = useFirstLight((s) => s.activeServerEventId);
  const [exportsList, setExportsList] = useState<ExportView[] | null>(null);
  const [bundles, setBundles] = useState<BundleView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [kind, setKind] = useState<string>('zones.geojson');
  const [ttlHours, setTtlHours] = useState('72');

  const session = getSession();
  const canExport = ['analyst', 'reviewer', 'approver', 'admin'].includes(
    session?.user.role ?? '',
  );

  useEffect(() => {
    if (!activeServerEventId) return;
    let cancelled = false;
    void (async () => {
      setExportsList(null);
      setBundles(null);
      setError(null);
      try {
        const { exports: e, bundles: b } = await listExports(activeServerEventId);
        if (cancelled) return;
        setExportsList(e);
        setBundles(b);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load exports');
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
      const { exports: e, bundles: b } = await listExports(activeServerEventId);
      setExportsList(e);
      setBundles(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setBusy(false);
    }
  }

  async function buildExport() {
    if (!activeServerEventId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const built = await createServerExport(activeServerEventId, kind);
      downloadText(built.filename, built.body, built.contentType);
      setNotice(
        `${built.filename} built + downloaded (sha256 ${built.sha256.slice(0, 12)}…, ${fmtBytes(built.sizeBytes)}).`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  async function buildBundle() {
    if (!activeServerEventId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const built = await createServerBundle(
        activeServerEventId,
        Math.max(1, Math.min(24 * 30, Number(ttlHours) || 72)),
      );
      downloadText(built.filename, built.body, 'application/json');
      setNotice(
        `Offline bundle ${built.filename} downloaded — per-layer checksums, expiry (${ttlHours} h), and revocation state are embedded. Import-side validation is server-checked.`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bundle failed');
    } finally {
      setBusy(false);
    }
  }

  if (!activeServerEventId) {
    return (
      <div className="p-4 text-xs text-zinc-500">Select an event to load its exports.</div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      {/* builder */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-zinc-500">
          <Download className="h-3.5 w-3.5" />
          SERVER-BUILT EXPORTS
        </div>
        <p className="text-[10px] leading-relaxed text-zinc-500">
          Every export is composed server-side with a manifest, SHA-256
          checksum, and synthetic-content labels inline. sitrep.md requires an
          approved sitrep — the server enforces the gate.
        </p>
        {canExport ? (
          <>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="h-8 text-[10px] bg-zinc-900 border-zinc-700 w-[150px] font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  {EXPORT_KINDS.map((k) => (
                    <SelectItem key={k} value={k} className="text-xs font-mono">
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="h-8 text-[10px] bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold"
                disabled={busy}
                onClick={() => void buildExport()}
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                Build + download
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-[10px] border-zinc-700 bg-zinc-900"
                disabled={busy}
                onClick={() => void refresh()}
              >
                <RefreshCw className="h-3 w-3" /> Refresh
              </Button>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap border-t border-zinc-800 pt-2">
              <Package className="h-3.5 w-3.5 text-sky-400" />
              <span className="text-[10px] text-zinc-500">Offline bundle TTL (h):</span>
              <input
                value={ttlHours}
                onChange={(e) => setTtlHours(e.target.value.replace(/[^0-9]/g, ''))}
                className="w-16 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-mono text-zinc-200 focus:outline-none focus:ring-1 focus:ring-sky-500/50"
                aria-label="Bundle TTL hours"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-[10px] border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20"
                disabled={busy}
                onClick={() => void buildBundle()}
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Build offline bundle
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-start gap-2 text-[10px] text-amber-400 border border-amber-500/30 bg-amber-500/10 rounded p-2">
            <ShieldAlert className="h-3.5 w-3.5 mt-px shrink-0" />
            <span>
              Your role ({session?.user.role ?? 'unknown'}) can list exports but
              not create them — the server enforces this.
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

      {/* export list */}
      <div className="space-y-1.5">
        <div className="text-[9px] font-bold tracking-widest text-zinc-500">
          EXPORT ARTIFACTS ({exportsList?.length ?? 0})
        </div>
        {exportsList === null && (
          <div className="flex items-center gap-2 text-xs text-zinc-500 p-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        )}
        {exportsList?.length === 0 && (
          <div className="text-[11px] text-zinc-500 px-1 py-2">No exports yet.</div>
        )}
        {exportsList?.map((e) => (
          <div
            key={e.id}
            className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-2.5 py-2 flex items-center gap-2"
          >
            <span className="text-[10px] font-mono text-zinc-300 truncate">{e.kind}</span>
            <Badge
              variant="outline"
              className={`h-4 px-1 text-[8px] font-bold ${
                e.approvalState === 'approved'
                  ? 'border-emerald-500/50 text-emerald-400'
                  : 'border-zinc-600 text-zinc-400'
              }`}
            >
              {e.approvalState}
            </Badge>
            <span className="ml-auto text-[9px] font-mono text-zinc-600">
              {fmtBytes(e.sizeBytes)} · {e.createdAt.slice(0, 16).replace('T', ' ')}
            </span>
          </div>
        ))}
      </div>

      {/* bundle list */}
      <div className="space-y-1.5">
        <div className="text-[9px] font-bold tracking-widest text-zinc-500">
          OFFLINE BUNDLES ({bundles?.length ?? 0})
        </div>
        {bundles?.map((b) => (
          <div
            key={b.id}
            className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-2.5 py-2 flex items-center gap-2"
          >
            <Package className="h-3.5 w-3.5 text-sky-400 shrink-0" />
            <span className="text-[9px] font-mono text-zinc-500 truncate">
              {b.sha256.slice(0, 14)}…
            </span>
            {b.revoked && (
              <Badge variant="outline" className="h-4 px-1 text-[8px] font-bold border-red-500/50 text-red-400">
                REVOKED
              </Badge>
            )}
            <span className="ml-auto text-[9px] font-mono text-zinc-600">
              expires {b.expiresAt.slice(0, 16).replace('T', ' ')}
            </span>
          </div>
        ))}
        {bundles !== null && bundles.length === 0 && (
          <div className="text-[11px] text-zinc-500 px-1 py-2">No bundles yet.</div>
        )}
      </div>
    </div>
  );
}
