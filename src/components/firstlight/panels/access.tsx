/* FirstLight — Access panel: isolation analysis (hospitals, communities)
 * + dispatch route planner on the passable-road graph. */

'use client';

import { useState } from 'react';
import { Ambulance, ArrowRight, Hospital, MapPinned, Trash2, TriangleAlert } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useFirstLight } from '@/store/firstlight';
import { fmtInt } from '@/lib/firstlight/geo';
import { dispatchOrigins } from '@/lib/firstlight/decision';

export function AccessPanel() {
  const raw = useFirstLight((s) => s.raw);
  const decision = useFirstLight((s) => s.decision);
  const routes = useFirstLight((s) => s.routes);
  const addRoute = useFirstLight((s) => s.addRoute);
  const clearRoutes = useFirstLight((s) => s.clearRoutes);
  const selectedZoneId = useFirstLight((s) => s.selectedZoneId);
  const selectZone = useFirstLight((s) => s.selectZone);

  if (!raw || !decision) return <div className="p-4 text-xs text-zinc-500">Loading…</div>;

  const hospitals = raw.facilities.filter((f) => f.type === 'hospital');
  const origins = dispatchOrigins(raw.facilities);
  const blockedCount = raw.roads.filter((r) => r.blocked).length;
  const floodBlocked = raw.roads.filter((r) => r.blockCause === 'flood').length;
  const isolatedZones = decision.zones.filter((z) => z.isolated);
  const isolatedPop = isolatedZones.reduce((a, z) => a + z.population, 0);
  const topZones = decision.zones.slice(0, 10);
  const destZoneId = selectedZoneId ?? topZones[0]?.id;

  return (
    <div className="space-y-4 p-3">
      {/* isolation summary */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-zinc-500">
          <TriangleAlert className="h-3.5 w-3.5 text-red-400" />
          ISOLATION ANALYSIS
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Isolated zones" value={String(isolatedZones.length)} tone="red" />
          <Stat label="Pop. cut off" value={fmtInt(isolatedPop)} tone="red" />
          <Stat label="Blocked roads" value={`${blockedCount}`} sub={`${floodBlocked} flood · ${blockedCount - floodBlocked} debris`} tone="amber" />
        </div>
        <p className="text-[10px] leading-relaxed text-zinc-500">
          Isolation = post-event travel time to the nearest functioning hospital
          exceeds baseline by &gt; 30 min, or unreachable — computed by Dijkstra on
          the passable-road graph (blocked edges removed).
        </p>
      </div>

      {/* hospitals table */}
      <section className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-zinc-500">
          <Hospital className="h-3.5 w-3.5" />
          HOSPITAL STATUS
        </div>
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          {hospitals.map((h) => (
            <div
              key={h.id}
              className="flex items-center justify-between px-2.5 py-1.5 border-b border-zinc-800/60 last:border-0 bg-zinc-900/40"
            >
              <div className="min-w-0">
                <div className="text-[11px] text-zinc-200 truncate">{h.name}</div>
                <div className="text-[9px] font-mono text-zinc-600">
                  access {fmtMin(h.preTravelMin)} → {fmtMin(h.postTravelMin)}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {h.isolated && (
                  <Badge variant="outline" className="h-4 px-1 text-[8px] font-bold border-red-500/60 bg-red-500/15 text-red-300">
                    ISOLATED
                  </Badge>
                )}
                <Badge
                  variant="outline"
                  className={`h-4 px-1.5 text-[8px] font-bold ${
                    h.status === 'operational'
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                      : h.status === 'degraded'
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                        : 'border-red-500/50 bg-red-500/10 text-red-300'
                  }`}
                >
                  {h.status.toUpperCase()}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* isolated communities */}
      {isolatedZones.length > 0 && (
        <section className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-zinc-500">
            <MapPinned className="h-3.5 w-3.5" />
            ISOLATED COMMUNITIES
          </div>
          <div className="space-y-1">
            {[...isolatedZones]
              .sort((a, b) => b.population - a.population)
              .slice(0, 6)
              .map((z) => (
                <button
                  key={z.id}
                  onClick={() => selectZone(z.id)}
                  className="w-full flex items-center justify-between rounded-md border border-red-500/30 bg-red-500/5 hover:bg-red-500/10 px-2.5 py-1.5 text-left transition-colors"
                >
                  <span className="text-[10px] font-mono text-zinc-400">
                    Zone #{z.rank}
                  </span>
                  <span className="text-[10px] text-zinc-300">
                    {fmtInt(z.population)} pop
                  </span>
                  <ArrowRight className="h-3 w-3 text-red-400/60" />
                </button>
              ))}
          </div>
        </section>
      )}

      {/* route planner */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-zinc-500">
          <Ambulance className="h-3.5 w-3.5" />
          DISPATCH ROUTE PLANNER
        </div>
        <RoutePlanner
          origins={origins.map((o) => ({ id: o.id, name: o.name, status: o.status }))}
          destZones={topZones.map((z) => ({ id: z.id, rank: z.rank, need: z.need }))}
          destZoneId={destZoneId}
          onRoute={(originId, zoneId) => addRoute(originId, zoneId)}
        />
        {routes.length > 0 && (
          <div className="space-y-1.5">
            {routes.map((r) =>
              r ? (
                <div key={r.id} className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-zinc-200 truncate">
                      {r.originName} → {r.destLabel}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5"
                      onClick={clearRoutes}
                      aria-label="Clear routes"
                    >
                      <Trash2 className="h-3 w-3 text-zinc-500" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-center">
                    <Stat label="Distance" value={`${r.distanceKm.toFixed(1)} km`} tone="zinc" />
                    <Stat label="ETA" value={`${r.etaMin.toFixed(0)} min`} tone="amber" />
                    <Stat label="Avoided" value={`${r.blockedEdgesAvoided} blk`} tone="zinc" />
                  </div>
                  {r.usesFlaggedSegments ? (
                    <div className="text-[9px] leading-relaxed text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1">
                      ⚠ Route relies on segments with unverified imagery /
                      flood-adjacent edges — advise physical reconnaissance.
                    </div>
                  ) : (
                    <div className="text-[9px] text-emerald-400/80 font-mono">
                      route confidence {r.confidence.toFixed(2)} — all segments verified
                    </div>
                  )}
                </div>
              ) : null,
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function RoutePlanner({
  origins,
  destZones,
  destZoneId,
  onRoute,
}: {
  origins: { id: string; name: string; status: string }[];
  destZones: { id: string; rank: number; need: number }[];
  destZoneId?: string;
  onRoute: (originId: string, zoneId: string) => void;
}) {
  const [originId, setOriginId] = useState(origins[0]?.id ?? '');
  const [zoneId, setZoneId] = useState(destZoneId ?? destZones[0]?.id ?? '');
  const currentZone = destZoneId ?? zoneId;

  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
      <div className="grid grid-cols-1 gap-2">
        <div className="space-y-1">
          <span className="text-[9px] font-bold tracking-wider text-zinc-500 uppercase">
            Origin (fire station)
          </span>
          <Select value={originId} onValueChange={setOriginId}>
            <SelectTrigger className="h-8 text-[11px] bg-zinc-900 border-zinc-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700">
              {origins.map((o) => (
                <SelectItem key={o.id} value={o.id} className="text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        o.status === 'operational' ? 'bg-emerald-400' : 'bg-amber-400'
                      }`}
                    />
                    {o.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <span className="text-[9px] font-bold tracking-wider text-zinc-500 uppercase">
            Destination (priority zone)
          </span>
          <Select value={currentZone} onValueChange={setZoneId}>
            <SelectTrigger className="h-8 text-[11px] bg-zinc-900 border-zinc-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700 max-h-56">
              {destZones.map((z) => (
                <SelectItem key={z.id} value={z.id} className="text-[11px]">
                  Zone #{z.rank} · need {z.need.toFixed(3)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button
        size="sm"
        className="w-full h-8 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-[11px]"
        onClick={() => onRoute(originId, currentZone)}
      >
        <Ambulance className="h-3.5 w-3.5" />
        Compute passable route
      </Button>
    </div>
  );
}

function fmtMin(m: number): string {
  if (!isFinite(m)) return '∞';
  return `${Math.round(m)}m`;
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: 'red' | 'amber' | 'zinc';
}) {
  const tones = {
    red: 'text-red-300 border-red-500/40',
    amber: 'text-amber-300 border-amber-500/40',
    zinc: 'text-zinc-200 border-zinc-700',
  } as const;
  return (
    <div className={`rounded-md border bg-zinc-900/60 py-1.5 px-1 ${tones[tone]}`}>
      <div className="text-[8px] font-bold tracking-wider text-zinc-600 uppercase">
        {label}
      </div>
      <div className="text-[12px] font-mono font-bold mt-0.5">{value}</div>
      {sub && <div className="text-[8px] text-zinc-600 font-mono">{sub}</div>}
    </div>
  );
}
