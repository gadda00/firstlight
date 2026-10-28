/* FirstLight — Priority Zones panel: ranked queue with component-score
 * breakdown, selected-zone detail, and fly-to selection. */

'use client';

import { ArrowUpRight, Crosshair, Info } from 'lucide-react';
import { useFirstLight } from '@/store/firstlight';
import { fmtInt } from '@/lib/firstlight/geo';
import { TierBadge } from './overview';

export function ZonesPanel() {
  const decision = useFirstLight((s) => s.decision);
  const selectedZoneId = useFirstLight((s) => s.selectedZoneId);
  const selectZone = useFirstLight((s) => s.selectZone);

  if (!decision) return <div className="p-4 text-xs text-zinc-500">Loading…</div>;

  const sorted = [...decision.zones].sort((a, b) => a.rank - b.rank);
  const selected = selectedZoneId
    ? decision.zoneIndex.get(selectedZoneId)
    : null;

  return (
    <div className="space-y-3 p-3">
      <div className="text-[10px] text-zinc-500 leading-relaxed bg-zinc-900/60 border border-zinc-800 rounded-md px-2.5 py-2">
        Ranked by <span className="font-mono text-zinc-300">need(z) = w₁·D + w₂·Pexp + w₃·Iso + w₄·Crit</span>{' '}
        — adjust weights in the map toolbar. Click a row to inspect & highlight on map.
      </div>

      {/* queue */}
      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <div className="grid grid-cols-[34px_1fr_58px_54px_46px] gap-1 px-2 py-1.5 bg-zinc-900 text-[9px] font-bold tracking-wider text-zinc-500 border-b border-zinc-800">
          <span>#</span>
          <span>TIER / ID</span>
          <span className="text-right">NEED</span>
          <span className="text-right">DES/MAJ</span>
          <span className="text-right">POP</span>
        </div>
        <div className="max-h-[380px] overflow-y-auto fl-scroll">
          {sorted.map((z) => (
            <button
              key={z.id}
              onClick={() => selectZone(z.id === selectedZoneId ? null : z.id)}
              className={`w-full grid grid-cols-[34px_1fr_58px_54px_46px] gap-1 px-2 py-1.5 items-center text-left border-b border-zinc-800/60 transition-colors ${
                z.id === selectedZoneId
                  ? 'bg-amber-500/10'
                  : 'hover:bg-zinc-900'
              }`}
            >
              <span className="text-[11px] font-bold font-mono text-zinc-400">
                {z.rank}
              </span>
              <span className="flex items-center gap-1.5 min-w-0">
                <TierBadge tier={z.tier} />
                <span className="text-[9px] font-mono text-zinc-600 truncate">
                  {z.id.slice(0, 12)}…
                </span>
                {z.isolated && (
                  <span className="text-[8px] font-bold text-red-400 border border-red-500/50 rounded px-1">
                    ISO
                  </span>
                )}
              </span>
              <span className="text-right text-[11px] font-mono font-bold text-amber-300">
                {z.need.toFixed(3)}
              </span>
              <span className="text-right text-[10px] font-mono text-zinc-300">
                {z.destroyed}/{z.major}
              </span>
              <span className="text-right text-[10px] font-mono text-zinc-400">
                {fmtInt(z.population)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* selected detail */}
      {selected ? (
        <ZoneDetail zone={selected} />
      ) : (
        <div className="flex items-center gap-2 text-[11px] text-zinc-600 px-1">
          <Info className="h-3.5 w-3.5" />
          Select a zone (map click or table row) for the component-score breakdown.
        </div>
      )}
    </div>
  );
}

function ZoneDetail({ zone }: { zone: NonNullable<ReturnType<typeof useFirstLight.getState>['decision']>['zones'][number] }) {
  const raw = useFirstLight((s) => s.raw);
  const addRoute = useFirstLight((s) => s.addRoute);
  const fireStation = raw?.facilities.find(
    (f) => f.type === 'fire_station' && f.status === 'operational',
  );
  const facilitiesHere = raw?.facilities.filter((f) => f.zone === zone.id) ?? [];

  return (
    <div className="rounded-lg border border-amber-500/40 bg-zinc-900/70 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-amber-500/10 border-b border-amber-500/30">
        <div className="flex items-center gap-2">
          <Crosshair className="h-3.5 w-3.5 text-amber-400" />
          <span className="text-xs font-bold text-zinc-100">
            Zone #{zone.rank} · {zone.tier.toUpperCase()}
          </span>
        </div>
        <span className="text-sm font-black font-mono text-amber-300">
          {zone.need.toFixed(3)}
        </span>
      </div>

      <div className="p-3 space-y-3">
        {/* component scores */}
        <div className="space-y-1.5">
          <CompRow label="D — damage ratio" v={zone.D} formula={`${zone.destroyed}·1.0 + ${zone.major}·0.6 + ${zone.minor}·0.2 of ${zone.buildings}`} />
          <CompRow label="Pexp — population" v={zone.Pexp} formula={`${fmtInt(zone.population)} pop · ${fmtInt(zone.affectedPop)} affected`} />
          <CompRow label="Iso — isolation" v={zone.Iso} formula={zone.isolated ? `travel Δ > 30 min (${fmtMin(zone.preHospitalMin)} → ${fmtMin(zone.postHospitalMin)})` : `access intact (${fmtMin(zone.preHospitalMin)} → ${fmtMin(zone.postHospitalMin)})`} />
          <CompRow label="Crit — facilities" v={zone.Crit} formula={`${zone.critImpacted} impacted of ${zone.critCount} critical`} />
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <MiniStat label="Buildings" value={`${zone.buildings}`} />
          <MiniStat label="Flood share" value={`${Math.round(zone.floodShare * 100)}%`} />
          <MiniStat label="H3 res-8" value={zone.id.slice(0, 8)} />
        </div>

        {/* facilities in zone */}
        {facilitiesHere.length > 0 && (
          <div className="space-y-1">
            <div className="text-[9px] font-bold tracking-widest text-zinc-500">
              FACILITIES IN ZONE
            </div>
            {facilitiesHere.map((f) => (
              <div key={f.id} className="flex items-center justify-between text-[10px]">
                <span className="text-zinc-300 truncate">{f.name}</span>
                <span
                  className={`font-semibold ${
                    f.status === 'operational'
                      ? 'text-emerald-400'
                      : f.status === 'degraded'
                        ? 'text-amber-400'
                        : 'text-red-400'
                  }`}
                >
                  {f.status}
                </span>
              </div>
            ))}
          </div>
        )}

        {fireStation && (
          <button
            onClick={() => addRoute(fireStation.id, zone.id)}
            className="w-full flex items-center justify-center gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-[11px] font-semibold py-1.5 transition-colors"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            Route dispatch from {fireStation.name}
          </button>
        )}
      </div>
    </div>
  );
}

function fmtMin(m: number): string {
  if (!isFinite(m)) return '∞';
  return `${Math.round(m)}m`;
}

function CompRow({ label, v, formula }: { label: string; v: number; formula: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-zinc-400 font-semibold">{label}</span>
        <span className="font-mono text-zinc-200">{v.toFixed(3)}</span>
      </div>
      <div className="h-1.5 rounded bg-zinc-800 overflow-hidden my-0.5">
        <div
          className="h-full rounded bg-gradient-to-r from-amber-500 to-red-500"
          style={{ width: `${Math.min(100, v * 100)}%` }}
        />
      </div>
      <div className="text-[9px] text-zinc-600 font-mono">{formula}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/60 py-1.5">
      <div className="text-[8px] font-bold tracking-wider text-zinc-600 uppercase">
        {label}
      </div>
      <div className="text-[11px] font-mono font-bold text-zinc-200 mt-0.5 truncate px-1">
        {value}
      </div>
    </div>
  );
}
