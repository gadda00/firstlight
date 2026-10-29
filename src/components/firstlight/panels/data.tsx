/* FirstLight — Data provenance panel: source hierarchy per layer with
 * sensor, date, resolution, cloud, license & processing version —
 * "never silently mix public and paid sources". */

'use client';

import { Database, ShieldAlert, Satellite, Users, Waypoints, Building } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useFirstLight } from '@/store/firstlight';
import { fmtInt } from '@/lib/firstlight/geo';
import { demoModeEnabled } from '@/lib/firstlight/mode';

export function DataPanel() {
  const raw = useFirstLight((s) => s.raw);
  const decision = useFirstLight((s) => s.decision);
  const reviewDecisions = useFirstLight((s) => s.reviewDecisions);
  const isDemo = demoModeEnabled();

  if (!raw || !decision) return <div className="p-4 text-xs text-zinc-500">Loading…</div>;

  const blocked = raw.roads.filter((r) => r.blocked).length;

  return (
    <div className="space-y-3 p-3">
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <ShieldAlert className="h-4 w-4 text-amber-400" />
          <span className="text-[11px] font-bold text-amber-300">
            LICENSING & ETHICS GUARDRAILS
          </span>
        </div>
        <p className="text-[10px] leading-relaxed text-zinc-400">
          {isDemo ? (
            <>
              Prototype on public benchmarks (xBD, Sen1Floods11), then transition
              to commercially clean data + pilot labels. This demo SIMULATES all
              footprints — no real imagery or population data is processed.
              Verify every license before shipping derivative products.
            </>
          ) : raw.demo ? (
            <>
              Operational event carrying a <b>labeled synthetic layer</b> — the
              analysis layer below is demo-scenario content (provider{' '}
              <code>{raw.demo.provider}</code>, seed {raw.demo.seed}), applied
              with an explicit opt-in at event creation. Real hazard metadata
              ingested via the adapters is cataloged with license records; the
              raster processing phase is deferred (see DATA_SOURCES.md). Scores
              and review state ARE server-authoritative.
            </>
          ) : (
            <>
              Operational event — layers are built server-side from the asset
              catalog with license records and quality notes attached. Verify
              every license before shipping derivative products.
            </>
          )}
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-zinc-500">
          <Satellite className="h-3.5 w-3.5" />
          IMAGERY & SOURCE HIERARCHY
        </div>
        {raw.meta.sensors.map((src) => (
          <div
            key={src.id}
            className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 space-y-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-zinc-200 truncate">
                {src.platform}
              </span>
              <Badge
                variant="outline"
                className={`h-4 px-1.5 text-[8px] font-bold shrink-0 ${
                  src.role === 'post'
                    ? 'border-red-500/50 bg-red-500/10 text-red-300'
                    : src.role === 'pre'
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                      : 'border-zinc-600 text-zinc-400'
                }`}
              >
                {src.role.toUpperCase()}
              </Badge>
            </div>
            <div className="grid grid-cols-[86px_1fr] gap-x-2 gap-y-0.5 text-[9px] font-mono">
              <span className="text-zinc-600">sensor</span>
              <span className="text-zinc-300 truncate">{src.sensor}</span>
              <span className="text-zinc-600">date</span>
              <span className="text-zinc-300">{src.date}</span>
              <span className="text-zinc-600">resolution</span>
              <span className="text-zinc-300">{src.resolutionM} m GSD</span>
              <span className="text-zinc-600">cloud</span>
              <span className="text-zinc-300">
                {src.cloudPct === null ? 'n/a (SAR)' : `${src.cloudPct}%`}
              </span>
              <span className="text-zinc-600">license</span>
              <span className="text-zinc-400 leading-snug">{src.license}</span>
              <span className="text-zinc-600">processing</span>
              <span className="text-zinc-400 leading-snug">{src.processing}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-zinc-500">
          <Database className="h-3.5 w-3.5" />
          DERIVED LAYERS
        </div>
        <div className="rounded-lg border border-zinc-800 overflow-hidden text-[10px]">
          <LayerRow
            icon={<Building className="h-3 w-3 text-orange-400" />}
            name="Building damage"
            detail={`${fmtInt(raw.buildings.length)} detections · Siamese UNet (simulated inference) · mean conf ${decision.stats.meanConfidence.toFixed(3)}`}
          />
          <LayerRow
            icon={<Waypoints className="h-3 w-3 text-zinc-300" />}
            name="Road network graph"
            detail={`${raw.roads.length} segments · ${blocked} blocked (${raw.roads.filter((r) => r.blockCause === 'flood').length} flood / ${raw.roads.filter((r) => r.blockCause === 'debris').length} debris) · OSM-derived synthetic grid`}
          />
          <LayerRow
            icon={<Users className="h-3 w-3 text-emerald-400" />}
            name="Population grid"
            detail={`${fmtInt(raw.popGrid.length)} cells @ ~300 m · WorldPop-style UN-adjusted (simulated) · total ${fmtInt(raw.totalPop)}`}
          />
          <LayerRow
            icon={<Building className="h-3 w-3 text-sky-400" />}
            name="H3 priority zones"
            detail={`${decision.zones.length} hexagons @ res 8 (~0.74 km²) · need-score weights tunable`}
          />
          <LayerRow
            icon={<Building className="h-3 w-3 text-red-400" />}
            name="Review labels"
            detail={`${reviewDecisions.size} analyst decisions · corrections feed the active-learning loop (the moat)`}
          />
        </div>
      </div>

      <p className="text-[9px] text-zinc-600 leading-relaxed font-mono">
        Base map: Esri World Imagery / CARTO dark (attribution in map footer).
        {isDemo
          ? ' Demo labels every artifact with its source, timestamp, sensor, resolution, quality flags, license class, and processing version.'
          : ' Every artifact in the catalog carries source, timestamp, license, checksum, and quality notes — see the Data tab of the API catalog.'}
      </p>
    </div>
  );
}

function LayerRow({
  icon,
  name,
  detail,
}: {
  icon: React.ReactNode;
  name: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2 bg-zinc-900/40 border-b border-zinc-800/60 last:border-0">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-zinc-200">{name}</div>
        <div className="text-[9px] text-zinc-500 font-mono leading-snug">
          {detail}
        </div>
      </div>
    </div>
  );
}
