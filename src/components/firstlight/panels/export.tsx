/* FirstLight — Export panel: GeoJSON / CSV / sitrep / audit trail /
 * offline field bundle — all generated client-side from reviewed data. */

'use client';

import { Download, FileJson, FileSpreadsheet, FileText, Package, ShieldCheck, Map } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFirstLight } from '@/store/firstlight';
import {
  auditTrail,
  damageGeoJSON,
  downloadJSON,
  downloadText,
  floodGeoJSON,
  offlineBundle,
  roadsGeoJSON,
  routesGeoJSON,
  slugEvent,
  zonesCSV,
  zonesGeoJSON,
} from '@/lib/firstlight/exports';

export function ExportPanel() {
  const raw = useFirstLight((s) => s.raw);
  const decision = useFirstLight((s) => s.decision);
  const reviewDecisions = useFirstLight((s) => s.reviewDecisions);
  const reviewClasses = useFirstLight((s) => s.reviewClasses);
  const routes = useFirstLight((s) => s.routes);
  const sitrep = useFirstLight((s) => s.sitrep);
  const approvedBy = useFirstLight((s) => s.sitrepApprovedBy);
  const weights = useFirstLight((s) => s.weights);
  const runId = useFirstLight((s) => s.runId);

  if (!raw || !decision) return <div className="p-4 text-xs text-zinc-500">Loading…</div>;

  const slug = slugEvent(raw.meta.id);
  const overrides = { decisions: reviewDecisions, newClasses: reviewClasses };
  const generatedAt = new Date().toISOString();
  const bundleCtx = {
    raw,
    decision,
    overrides,
    weights,
    routes,
    sitrep,
    runId,
    approvedBy,
    generatedAt,
  };
  const s = decision.stats;

  return (
    <div className="space-y-3 p-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-zinc-500">
          <Download className="h-3.5 w-3.5" />
          EXPORT LAYER
        </div>
        <p className="text-[10px] leading-relaxed text-zinc-500">
          Standard exports: GeoJSON, CSV, sitrep markdown, audit trail — per the
          evidence workflow (blueprint §7). Every download carries provenance and
          the demo-data disclaimer.
        </p>
      </div>

      <ExportCard
        icon={<Map className="h-4 w-4 text-red-400" />}
        title="Building damage · damage.geojson"
        desc={`${s.destroyed + s.major + s.minor} damage detections (post-review) with class, confidence, zone, provenance`}
        onDownload={() => downloadJSON(`firstlight-${slug}-damage.geojson`, damageGeoJSON(raw, overrides))}
      />
      <ExportCard
        icon={<Map className="h-4 w-4 text-sky-400" />}
        title="Flood extent · flood.geojson"
        desc={raw.floods.length ? `${s.floodedAreaKm2.toFixed(1)} km² across ${raw.floods.length} SAR polygons` : 'no flood polygons in this event'}
        disabled={!raw.floods.length}
        onDownload={() => downloadJSON(`firstlight-${slug}-flood.geojson`, floodGeoJSON(raw))}
      />
      <ExportCard
        icon={<FileJson className="h-4 w-4 text-amber-400" />}
        title="H3 priority zones · zones.geojson"
        desc={`${decision.zones.length} zones with need, tier, D/Pexp/Iso/Crit components`}
        onDownload={() => downloadJSON(`firstlight-${slug}-zones.geojson`, zonesGeoJSON(decision))}
      />
      <ExportCard
        icon={<FileSpreadsheet className="h-4 w-4 text-emerald-400" />}
        title="Ranked zones · zones.csv"
        desc="Ranked queue with all component scores — spreadsheet-ready"
        onDownload={() => downloadText(`firstlight-${slug}-zones.csv`, zonesCSV(decision), 'text/csv')}
      />
      <ExportCard
        icon={<FileJson className="h-4 w-4 text-zinc-300" />}
        title="Road network · roads.geojson"
        desc={`${raw.roads.length} segments, blocked flags & block causes`}
        onDownload={() => downloadJSON(`firstlight-${slug}-roads.geojson`, roadsGeoJSON(raw))}
      />
      <ExportCard
        icon={<FileJson className="h-4 w-4 text-amber-300" />}
        title="Dispatch routes · routes.geojson"
        desc={routes.length ? `${routes.length} computed routes with ETA & confidence flags` : 'no routes computed yet (see Access tab)'}
        disabled={!routes.length}
        onDownload={() => downloadJSON(`firstlight-${slug}-routes.geojson`, routesGeoJSON(routes))}
      />
      <ExportCard
        icon={<FileText className="h-4 w-4 text-zinc-200" />}
        title="Sitrep · sitrep.md"
        desc={
          sitrep
            ? approvedBy
              ? `approved by ${approvedBy} — cleared for export`
              : 'drafted but NOT approved — sign off in the Sitrep tab first'
            : 'not generated yet (see Sitrep tab)'
        }
        disabled={!sitrep || !approvedBy}
        onDownload={() =>
          sitrep &&
          downloadText(`firstlight-sitrep-${slug}.md`, sitrep.markdown, 'text/markdown')
        }
      />
      <ExportCard
        icon={<ShieldCheck className="h-4 w-4 text-emerald-300" />}
        title="Audit trail · audit.json"
        desc="Run metadata, review decisions, tool assertions, human sign-off state"
        onDownload={() => downloadJSON(`firstlight-${slug}-audit.json`, auditTrail(bundleCtx))}
      />
      <ExportCard
        icon={<Package className="h-4 w-4 text-amber-400" />}
        title="Offline field bundle · bundle.json"
        desc="All layers + sitrep + audit in one file — air-gapped field deployment mode"
        highlight
        onDownload={() =>
          downloadJSON(`firstlight-${slug}-offline-bundle.json`, offlineBundle(bundleCtx))
        }
      />
    </div>
  );
}

function ExportCard({
  icon,
  title,
  desc,
  onDownload,
  disabled,
  highlight,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onDownload: () => void;
  disabled?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
        highlight
          ? 'border-amber-500/40 bg-amber-500/5'
          : 'border-zinc-800 bg-zinc-900/50'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <div className="shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold text-zinc-200 truncate">
          {title}
        </div>
        <div className="text-[9px] text-zinc-500 leading-snug">{desc}</div>
      </div>
      <Button
        size="sm"
        variant={highlight ? 'default' : 'outline'}
        className={`h-7 px-2.5 shrink-0 text-[10px] font-semibold ${
          highlight
            ? 'bg-amber-500 hover:bg-amber-400 text-zinc-950'
            : 'border-zinc-700 text-zinc-300'
        }`}
        disabled={disabled}
        onClick={onDownload}
      >
        <Download className="h-3 w-3" />
        Get
      </Button>
    </div>
  );
}
