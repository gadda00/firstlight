/* FirstLight — Overview panel: event brief, KPI grid, alert tiers,
 * damage distribution, top priority zones, run details. */

'use client';

import { useMemo } from 'react';
import { AlertTriangle, Eye, Gauge, MapPin, Users, Waves, Building2, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useFirstLight } from '@/store/firstlight';
import { fmtInt, fmtPct } from '@/lib/firstlight/geo';

export function OverviewPanel() {
  const raw = useFirstLight((s) => s.raw);
  const decision = useFirstLight((s) => s.decision);
  const runId = useFirstLight((s) => s.runId);
  const selectZone = useFirstLight((s) => s.selectZone);
  const selectedZoneId = useFirstLight((s) => s.selectedZoneId);

  const top = useMemo(
    () =>
      decision
        ? [...decision.zones].sort((a, b) => a.rank - b.rank).slice(0, 5)
        : [],
    [decision],
  );

  if (!raw || !decision) {
    return <PanelShell>Loading run…</PanelShell>;
  }
  const meta = raw.meta;
  const s = decision.stats;
  const tiers = decision.zones.reduce(
    (acc, z) => {
      acc[z.tier]++;
      return acc;
    },
    { warning: 0, watch: 0, informational: 0, insufficient_evidence: 0 },
  );
  const totalMs = raw.stages.reduce((a, st) => a + st.ms, 0);
  const damageMax = Math.max(
    s.destroyed,
    s.major,
    s.minor,
    Math.max(1, s.totalBuildings - s.destroyed - s.major - s.minor),
  );

  return (
    <PanelShell>
      {/* tier banner */}
      <div
        className={`rounded-lg border px-3 py-2.5 flex items-start gap-2.5 ${
          tiers.warning > 0
            ? 'border-red-500/50 bg-red-500/10'
            : 'border-amber-500/40 bg-amber-500/10'
        }`}
      >
        <AlertTriangle
          className={`h-4 w-4 mt-0.5 shrink-0 ${
            tiers.warning > 0 ? 'text-red-400' : 'text-amber-400'
          }`}
        />
        <div className="text-[11px] leading-relaxed">
          <span className="font-bold text-zinc-100">
            {tiers.warning > 0
              ? `${tiers.warning} WARNING-tier zones`
              : `${tiers.watch} WATCH-tier zones`}
          </span>
          <span className="text-zinc-400">
            {' '}
            require prioritized response.{' '}
            {s.isolatedZones > 0 &&
              `${s.isolatedZones} zones isolated (travel-time delta > 30 min).`}
          </span>
        </div>
      </div>

      {/* event brief */}
      <Section icon={<MapPin className="h-3 w-3" />} title="EVENT BRIEF">
        <div className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-1 text-[11px]">
          <Meta k="Type" v={meta.archetype.toUpperCase()} />
          <Meta k="Location" v={`${meta.location}, ${meta.country}`} />
          <Meta k="Event date" v={meta.eventDate} />
          <Meta k="AOI" v={`${(2 * meta.aoiKm).toFixed(0)} × ${(2 * meta.aoiKm).toFixed(0)} km (${s.aoiKm2.toFixed(0)} km²)`} />
          <Meta k="Pre-image" v={`${meta.sensors.find((x) => x.role === 'pre')?.platform ?? ''} · ${meta.preDate}`} />
          <Meta k="Post-image" v={`${meta.sensors.find((x) => x.role === 'post')?.platform ?? ''} · ${meta.postDate}`} />
          <Meta k="Run ID" v={runId} mono />
        </div>
        <p className="text-[11px] leading-relaxed text-zinc-400 mt-2">
          {meta.description}
        </p>
      </Section>

      {/* KPI grid */}
      <Section icon={<Gauge className="h-3 w-3" />} title="IMPACT KPIs">
        <div className="grid grid-cols-2 gap-2">
          <Kpi icon={<Users className="h-3.5 w-3.5" />} label="Affected population" value={fmtInt(s.affectedPop)} sub={`${fmtPct(s.affectedPct)} of ${fmtInt(s.totalPop)}`} tone="amber" />
          <Kpi icon={<Building2 className="h-3.5 w-3.5" />} label="Major + destroyed" value={fmtInt(s.destroyed + s.major)} sub={`${fmtInt(s.destroyed)} des · ${fmtInt(s.major)} maj of ${fmtInt(s.totalBuildings)}`} tone="red" />
          <Kpi icon={<Waves className="h-3.5 w-3.5" />} label="Flood extent" value={`${s.floodedAreaKm2.toFixed(1)} km²`} sub={raw.floods.length ? `${raw.floods.length} SAR polygons` : 'not applicable'} tone="sky" />
          <Kpi icon={<Eye className="h-3.5 w-3.5" />} label="Mean confidence" value={s.meanConfidence.toFixed(3)} sub={`${s.pendingReview} pending review`} tone="zinc" />
        </div>
      </Section>

      {/* damage distribution */}
      <Section icon={<Building2 className="h-3 w-3" />} title="DAMAGE DISTRIBUTION">
        <div className="space-y-1.5">
          <DistBar label="Destroyed" value={s.destroyed} max={damageMax} color="#ef4444" />
          <DistBar label="Major" value={s.major} max={damageMax} color="#f97316" />
          <DistBar label="Minor" value={s.minor} max={damageMax} color="#fbbf24" />
          <DistBar
            label="No damage"
            value={Math.max(0, s.totalBuildings - s.destroyed - s.major - s.minor)}
            max={damageMax}
            color="#22c55e"
          />
        </div>
      </Section>

      {/* top zones */}
      <Section icon={<Gauge className="h-3 w-3" />} title="TOP PRIORITY ZONES">
        <div className="space-y-1">
          {top.map((z) => (
            <button
              key={z.id}
              onClick={() => selectZone(z.id === selectedZoneId ? null : z.id)}
              className={`w-full text-left rounded-md border px-2.5 py-1.5 transition-colors ${
                z.id === selectedZoneId
                  ? 'border-amber-500/60 bg-amber-500/10'
                  : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-600'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-zinc-200">
                  #{z.rank} · {z.need.toFixed(3)}
                </span>
                <TierBadge tier={z.tier} />
              </div>
              <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                {z.destroyed} des / {z.major} maj · {fmtInt(z.population)} pop
                {z.isolated ? ' · ISOLATED' : ''}
              </div>
            </button>
          ))}
        </div>
      </Section>

      {/* run details */}
      <Section icon={<Clock className="h-3 w-3" />} title="RUN DETAILS">
        <div className="space-y-1">
          {raw.stages.map((st) => (
            <div key={st.name} className="flex items-center justify-between text-[10px] font-mono">
              <span className="text-zinc-500">{st.name}</span>
              <span className="text-zinc-400">{st.ms} ms</span>
            </div>
          ))}
          <div className="flex items-center justify-between text-[10px] font-mono pt-1 border-t border-zinc-800">
            <span className="text-zinc-500">total (demo-scaled)</span>
            <span className="text-amber-400">{totalMs} ms</span>
          </div>
        </div>
      </Section>
    </PanelShell>
  );
}

function PanelShell({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4 p-3">{children}</div>;
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-zinc-500">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

function Meta({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <>
      <span className="text-zinc-500">{k}</span>
      <span className={`text-zinc-200 ${mono ? 'font-mono text-[10px]' : ''}`}>
        {v}
      </span>
    </>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: 'amber' | 'red' | 'sky' | 'zinc';
}) {
  const tones = {
    amber: 'text-amber-300',
    red: 'text-red-300',
    sky: 'text-sky-300',
    zinc: 'text-zinc-200',
  } as const;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-zinc-500">
        {icon}
        <span className="text-[9px] font-bold tracking-wider uppercase">
          {label}
        </span>
      </div>
      <div className={`text-lg font-bold font-mono mt-0.5 ${tones[tone]}`}>
        {value}
      </div>
      <div className="text-[9px] text-zinc-600 font-mono">{sub}</div>
    </div>
  );
}

function DistBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] w-16 text-zinc-400">{label}</span>
      <div className="flex-1 h-3.5 rounded bg-zinc-800/60 overflow-hidden">
        <div
          className="h-full rounded transition-all"
          style={{ width: `${(value / max) * 100}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[10px] font-mono w-12 text-right text-zinc-300">
        {fmtInt(value)}
      </span>
    </div>
  );
}

export function TierBadge({ tier }: { tier: 'warning' | 'watch' | 'informational' | 'insufficient_evidence' }) {
  const map = {
    warning: 'border-red-500/60 bg-red-500/15 text-red-300',
    watch: 'border-amber-500/60 bg-amber-500/15 text-amber-300',
    informational: 'border-zinc-600 bg-zinc-800 text-zinc-400',
    insufficient_evidence: 'border-dashed border-sky-500/60 bg-sky-500/10 text-sky-300',
  } as const;
  return (
    <Badge
      variant="outline"
      className={`h-4 px-1.5 text-[8px] font-bold tracking-wider ${map[tier]}`}
    >
      {tier === 'insufficient_evidence' ? 'NOT ENOUGH EVIDENCE' : tier.toUpperCase()}
    </Badge>
  );
}
