/* FirstLight — Sitrep panel: grounded situation-report generation with
 * tool-call citations, mandatory analyst sign-off before export. */

'use client';

import { useState } from 'react';
import { BadgeCheck, FileText, PenLine, ShieldAlert, Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useFirstLight } from '@/store/firstlight';
import { generateSitrep } from '@/lib/firstlight/sitrep';
import { downloadText } from '@/lib/firstlight/exports';
import { fmtInt } from '@/lib/firstlight/geo';

export function SitrepPanel() {
  const raw = useFirstLight((s) => s.raw);
  const decision = useFirstLight((s) => s.decision);
  const sitrep = useFirstLight((s) => s.sitrep);
  const setSitrep = useFirstLight((s) => s.setSitrep);
  const approvedBy = useFirstLight((s) => s.sitrepApprovedBy);
  const approveSitrep = useFirstLight((s) => s.approveSitrep);
  const reviewDecisions = useFirstLight((s) => s.reviewDecisions);
  const routes = useFirstLight((s) => s.routes);
  const runId = useFirstLight((s) => s.runId);
  const [analyst, setAnalyst] = useState('');
  const [agreed, setAgreed] = useState(false);

  if (!raw || !decision) return <div className="p-4 text-xs text-zinc-500">Loading…</div>;

  const routeNote = routes.length
    ? `${routes.length} dispatch route(s) computed; ${routes.filter((r) => r?.usesFlaggedSegments).length} rely on unverified segments — ground reconnaissance advised.`
    : 'No dispatch routes computed in this run.';

  const onGenerate = () => {
    const result = generateSitrep({
      raw,
      decision,
      overrides: { decisions: reviewDecisions, newClasses: new Map() },
      generatedAt: new Date(),
      runId,
      routeNote,
    });
    setSitrep(result);
    setAgreed(false);
  };

  return (
    <div className="space-y-3 p-3">
      {/* header / generate */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2.5">
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-zinc-500">
          <FileText className="h-3.5 w-3.5" />
          GROUNDED SITREP ENGINE
        </div>
        <p className="text-[11px] leading-relaxed text-zinc-400">
          Deterministic report drafting from typed tool calls over the results
          database — every number traces to a logged assertion hash. The model
          layer never invents measurements.
        </p>
        <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500">
          <Badge variant="outline" className="h-4 px-1 text-[8px] border-zinc-600 text-zinc-400">
            get_event_summary
          </Badge>
          <Badge variant="outline" className="h-4 px-1 text-[8px] border-zinc-600 text-zinc-400">
            top_zones
          </Badge>
          <Badge variant="outline" className="h-4 px-1 text-[8px] border-zinc-600 text-zinc-400">
            isolated_facilities
          </Badge>
        </div>
        <Button
          size="sm"
          className="w-full h-8 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-[11px]"
          onClick={onGenerate}
        >
          {sitrep ? <RefreshCw className="h-3.5 w-3.5" /> : <PenLine className="h-3.5 w-3.5" />}
          {sitrep ? 'Regenerate sitrep draft' : 'Generate sitrep draft'}
        </Button>
      </div>

      {/* preview */}
      {sitrep && (
        <div className="space-y-3">
          <div className="rounded-lg border border-zinc-800 overflow-hidden">
            <div className="px-3 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-widest text-zinc-400">
                DRAFT · {runId}
              </span>
              <span className="text-[9px] font-mono text-zinc-600">
                {sitrep.toolCalls.length} tool calls · {sitrep.assertions.length} assertions
              </span>
            </div>
            <div className="max-h-[340px] overflow-y-auto fl-scroll px-3 py-2.5 bg-zinc-950/60">
              <pre className="whitespace-pre-wrap font-mono text-[10px] leading-[1.55] text-zinc-300">
                {sitrep.markdown}
              </pre>
            </div>
          </div>

          {/* approval gate */}
          <div
            className={`rounded-lg border p-3 space-y-2.5 ${
              approvedBy
                ? 'border-emerald-500/50 bg-emerald-500/5'
                : 'border-amber-500/40 bg-amber-500/5'
            }`}
          >
            <div className="flex items-center gap-1.5">
              {approvedBy ? (
                <BadgeCheck className="h-4 w-4 text-emerald-400" />
              ) : (
                <ShieldAlert className="h-4 w-4 text-amber-400" />
              )}
              <span
                className={`text-[11px] font-bold ${
                  approvedBy ? 'text-emerald-300' : 'text-amber-300'
                }`}
              >
                {approvedBy
                  ? `APPROVED — ${approvedBy}`
                  : 'HUMAN-IN-THE-LOOP SIGN-OFF REQUIRED'}
              </span>
            </div>
            {!approvedBy && (
              <>
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-400">
                    Approving analyst (name / callsign)
                  </Label>
                  <Input
                    value={analyst}
                    onChange={(e) => setAnalyst(e.target.value)}
                    placeholder="e.g. M. Okafor, duty analyst"
                    className="h-8 text-[11px] bg-zinc-900 border-zinc-700"
                  />
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="sitrep-agree"
                    checked={agreed}
                    onCheckedChange={(v) => setAgreed(Boolean(v))}
                    className="mt-0.5"
                  />
                  <Label
                    htmlFor="sitrep-agree"
                    className="text-[10px] leading-relaxed text-zinc-400 font-normal"
                  >
                    I have reviewed every cited figure against the tool-call log
                    and understand this is SIMULATED DEMO data. Approval binds my
                    name to the audit trail.
                  </Label>
                </div>
                <Button
                  size="sm"
                  disabled={!agreed || analyst.trim().length < 2}
                  className="w-full h-8 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px] disabled:opacity-40"
                  onClick={() => approveSitrep(analyst.trim())}
                >
                  <BadgeCheck className="h-3.5 w-3.5" />
                  Approve for export
                </Button>
              </>
            )}
            {approvedBy && (
              <>
                <Button
                  size="sm"
                  className="w-full h-8 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px]"
                  onClick={() =>
                    downloadText(
                      `firstlight-sitrep-${raw.meta.id}.md`,
                      sitrep.markdown,
                      'text/markdown',
                    )
                  }
                >
                  <Download className="h-3.5 w-3.5" />
                  Download sitrep (.md)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full h-8 text-[11px] border-zinc-700"
                  onClick={() => approveSitrep(null)}
                >
                  Revoke approval
                </Button>
              </>
            )}
          </div>

          {/* key figures strip */}
          <div className="grid grid-cols-3 gap-1.5 text-center">
            <MiniStat label="Affected" value={fmtInt(decision.stats.affectedPop)} />
            <MiniStat label="Des / Maj" value={`${fmtInt(decision.stats.destroyed)} / ${fmtInt(decision.stats.major)}`} />
            <MiniStat label="Isolated" value={String(decision.stats.isolatedZones)} />
          </div>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/60 py-1.5">
      <div className="text-[8px] font-bold tracking-wider text-zinc-600 uppercase">
        {label}
      </div>
      <div className="text-[11px] font-mono font-bold text-zinc-200 mt-0.5">
        {value}
      </div>
    </div>
  );
}
