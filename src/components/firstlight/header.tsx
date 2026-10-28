/* FirstLight — top header: identity, event selector, KPI pills, status. */

'use client';

import { Activity, Github, Radio } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { EVENTS } from '@/lib/firstlight/events';
import { useFirstLight } from '@/store/firstlight';
import { fmtInt } from '@/lib/firstlight/geo';

export function Header() {
  const eventId = useFirstLight((s) => s.eventId);
  const loadEvent = useFirstLight((s) => s.loadEvent);
  const decision = useFirstLight((s) => s.decision);
  const raw = useFirstLight((s) => s.raw);
  const phase = useFirstLight((s) => s.phase);

  const s = decision?.stats;
  const event = raw?.meta;

  return (
    <header className="border-b border-zinc-800/80 bg-zinc-950/95 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/80 z-40">
      <div className="flex items-center gap-3 px-3 py-2 lg:px-4">
        {/* identity */}
        <div className="flex items-center gap-2.5 min-w-0">
          <svg width="34" height="34" viewBox="0 0 64 64" className="shrink-0">
            <rect width="64" height="64" rx="14" fill="#18181b" />
            <path d="M14 46a18 18 0 0 1 36 0z" fill="#f59e0b" />
            <circle cx="32" cy="46" r="5.5" fill="#fde68a" />
            <rect x="10" y="49" width="44" height="3.5" rx="1.75" fill="#f59e0b" />
            <path d="M20 22a12 12 0 0 1 24 0" fill="none" stroke="#fbbf24" strokeWidth="2.4" strokeLinecap="round" opacity="0.55" />
          </svg>
          <div className="leading-none min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-black tracking-tight text-lg text-zinc-50">
                FirstLight
              </span>
              <Badge
                variant="outline"
                className="h-5 px-1.5 text-[9px] font-bold tracking-wider border-amber-500/50 text-amber-400 hidden sm:inline-flex"
              >
                v2.1 DEMO
              </Badge>
            </div>
            <span className="hidden md:block text-[9px] font-semibold tracking-[0.22em] text-zinc-500 mt-1">
              DISASTER INTELLIGENCE · FIRST 6 HOURS
            </span>
          </div>
        </div>

        {/* event selector */}
        <div className="flex items-center gap-2 ml-2 lg:ml-6">
          <Select
            value={eventId}
            onValueChange={(v) => loadEvent(v)}
            disabled={phase === 'running'}
          >
            <SelectTrigger className="w-[190px] sm:w-[250px] h-9 bg-zinc-900 border-zinc-700 text-sm">
              <div className="flex items-center gap-2 truncate">
                <Activity className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <SelectValue />
              </div>
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700">
              {EVENTS.map((e) => (
                <SelectItem key={e.id} value={e.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className="uppercase text-[9px] font-bold tracking-wider text-amber-400 border border-amber-500/40 rounded px-1 py-px">
                      {e.archetype}
                    </span>
                    {e.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {event && (
            <span className="hidden xl:block text-[11px] text-zinc-500 font-mono truncate max-w-[240px]">
              {event.location} · post {event.postDate}
            </span>
          )}
        </div>

        <div className="flex-1" />

        {/* KPI pills */}
        {s && (
          <div className="hidden lg:flex items-center gap-1.5">
            <KpiPill
              label="AFFECTED"
              value={fmtInt(s.affectedPop)}
              tone="amber"
            />
            <KpiPill
              label="MAJOR+DESTR"
              value={fmtInt(s.destroyed + s.major)}
              tone="red"
            />
            <KpiPill
              label="FLOOD KM²"
              value={s.floodedAreaKm2.toFixed(1)}
              tone="sky"
            />
            <KpiPill
              label="ISOLATED ZONES"
              value={String(s.isolatedZones)}
              tone="zinc"
            />
          </div>
        )}

        {/* status + demo badge */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden md:flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-emerald-400">
            <Radio className="h-3 w-3 animate-pulse" />
            PIPELINE&nbsp;{phase === 'running' ? 'PROCESSING' : 'ONLINE'}
          </span>
          <Badge
            variant="outline"
            className="h-6 px-2 text-[9px] font-bold tracking-wider border-amber-500/60 bg-amber-500/10 text-amber-300 whitespace-nowrap"
          >
            ⚠ SIMULATED DEMO DATA
          </Badge>
          <a
            href="https://github.com/gadda00/firstlight"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repository"
            className="h-8 w-8 flex items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-100 hover:border-zinc-500 transition-colors"
          >
            <Github className="h-4 w-4" />
          </a>
        </div>
      </div>
    </header>
  );
}

function KpiPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'amber' | 'red' | 'sky' | 'zinc';
}) {
  const tones = {
    amber: 'border-amber-500/40 text-amber-300',
    red: 'border-red-500/40 text-red-300',
    sky: 'border-sky-500/40 text-sky-300',
    zinc: 'border-zinc-600 text-zinc-300',
  } as const;
  return (
    <div
      className={`rounded-md border bg-zinc-900/80 px-2.5 py-1 leading-none ${tones[tone]}`}
    >
      <div className="text-[8px] font-bold tracking-[0.14em] text-zinc-500">
        {label}
      </div>
      <div className="text-sm font-bold font-mono mt-0.5">{value}</div>
    </div>
  );
}
