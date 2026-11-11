/* FirstLight — Guide panel: how this demo works, a plain-language glossary,
 * the honest mode/capability summary, and the provider registry (from the
 * machine-readable provider-status.json). Uses native <details> for
 * progressive disclosure so it never blocks expert use. */

'use client';

import { BookOpen, CircleHelp, Database, Layers, Map, ShieldAlert } from 'lucide-react';
import providerStatus from '@/lib/firstlight/provider-status.json';

const GLOSSARY: { term: string; def: string }[] = [
  {
    term: 'Need score',
    def: 'A transparent, uncalibrated heuristic ranking of zones: need(z) = 0.35·D + 0.25·Pexp + 0.25·Iso + 0.15·Crit (damage, population exposure, isolation, critical facilities). It is not a measurement and not a probability — in this demo it is computed over generated data.',
  },
  {
    term: 'Scenario score',
    def: 'The value labeled "confidence" elsewhere in disaster tooling. Here every such number is a seeded procedural value — NOT a model probability. We renamed it so it can never be read as calibrated confidence.',
  },
  {
    term: 'H3 hexes',
    def: 'Uber H3 is a grid that tiles the Earth in hexagons. FirstLight aggregates analysis into resolution-8 hexagons (~0.7 km²) so zones have stable, comparable shapes.',
  },
  {
    term: 'SAR',
    def: 'Synthetic Aperture Radar. Cloud- and day/night-capable radar imaging (e.g. Sentinel-1). Resilient, not error-free: urban double-bounce and wind-roughened water cause false readings. This demo processes no SAR data.',
  },
  {
    term: 'Optical imagery',
    def: 'Passive sunlight imagery (Sentinel-2, Landsat, Planet). Blocked by cloud/shadow — interpretation must be cloud-aware. This demo processes no optical data.',
  },
  {
    term: 'STAC',
    def: 'SpatioTemporal Asset Catalog — a standard for searchable geospatial metadata. A STAC search tells you an image exists and its metadata; it does NOT mean the image was acquired by you.',
  },
  {
    term: 'DSWx',
    def: 'NASA OPERA Dynamic Surface Water eXtent product (DSWx-S1 from Sentinel-1, DSWx-HLS from Landsat/Sentinel-2): official 30 m surface-water classifications. A water class is not flood depth, damage, or safety.',
  },
  {
    term: 'Exposure',
    def: 'Who/what is inside a hazard footprint (here: a modelled affected-population estimate). Exposure is a model output with uncertainty and vintage — never a count of persons currently present.',
  },
  {
    term: 'Uncertainty',
    def: 'Need scores carry bounds (needLower/needUpper) propagated from input quality; zones whose data quality is too low are flagged "not enough evidence" instead of silently looking low-impact.',
  },
  {
    term: 'Sitrep',
    def: 'Situation report — a structured, grounded briefing document. In this demo it is generated entirely from the synthetic dataset and identifies itself as a synthetic exercise.',
  },
  {
    term: 'FNV-1a checksum',
    def: 'A fast non-cryptographic hash. Used here as a demo checksum that detects transcription drift only. It is NOT a digital signature and proves nothing about truth or origin. The local pilot uses a separate SHA-256 audit chain.',
  },
];

export function GuidePanel() {
  return (
    <div className="space-y-3 p-3">
      {/* how this demo works */}
      <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3" aria-labelledby="fl-guide-how">
        <div className="flex items-center gap-1.5 mb-1.5">
          <CircleHelp className="h-4 w-4 text-amber-400" aria-hidden="true" />
          <h3 id="fl-guide-how" className="text-[11px] font-bold text-amber-300">
            HOW THIS DEMO WORKS
          </h3>
        </div>
        <ol className="text-[11px] leading-relaxed text-zinc-300 list-decimal list-inside space-y-1">
          <li>Pick a <b>Synthetic Scenario</b> — its seed makes generation deterministic (same seed ⇒ identical data).</li>
          <li>A procedural generator creates the roads, buildings, hazards, closures, facilities and population grid <b>in your browser</b> — no network data is fetched.</li>
          <li>Real compute then runs on that fiction: H3 zoning, need scores with uncertainty, routing/isolation on the toy graph.</li>
          <li>You review synthetic detections, draft a sitrep, and export clearly-marked simulation artifacts.</li>
        </ol>
        <p className="text-[10px] leading-relaxed text-zinc-400 mt-2">
          The map animation pacing is UI presentation, not pipeline telemetry.
          Nothing in this demo acquires or processes real satellite imagery.
        </p>
      </section>

      {/* glossary — progressive disclosure */}
      <section aria-labelledby="fl-guide-glossary">
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-zinc-500 mb-1.5">
          <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
          <h3 id="fl-guide-glossary">GLOSSARY — TERMS USED IN THIS APP</h3>
        </div>
        <div className="space-y-1">
          {GLOSSARY.map((g) => (
            <details
              key={g.term}
              className="group rounded-lg border border-zinc-800 bg-zinc-900/50 open:bg-zinc-900"
            >
              <summary className="px-3 py-2 text-[11px] font-semibold text-zinc-200 cursor-pointer list-none flex items-center justify-between focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500">
                {g.term}
                <span className="text-zinc-600 group-open:rotate-90 transition-transform" aria-hidden="true">▸</span>
              </summary>
              <p className="px-3 pb-2.5 text-[10px] leading-relaxed text-zinc-400">{g.def}</p>
            </details>
          ))}
        </div>
      </section>

      {/* mode & capability summary */}
      <section aria-labelledby="fl-guide-modes">
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-zinc-500 mb-1.5">
          <Layers className="h-3.5 w-3.5" aria-hidden="true" />
          <h3 id="fl-guide-modes">MODES — WHAT RUNS WHERE</h3>
        </div>
        <div className="rounded-lg border border-zinc-800 overflow-hidden text-[10px] divide-y divide-zinc-800">
          <ModeRow label="Simulated exercise (this site)" value="Static page · browser-only · every analysis layer generated fiction" />
          <ModeRow label="Local pilot (repo, not deployed)" value="Server + DB + auth · real catalog ingestion · analysis still synthetic-labeled · SHA-256 audit chain" />
          <ModeRow label="Real-data catalog" value="Copernicus STAC discovery live in pilot; asset download/processing NOT implemented" />
          <ModeRow label="Processed real product" value="Not implemented (worker reports blocked_scaffold — no raster/ML pipeline exists)" />
          <ModeRow label="Validated output / deployment" value="None. No public operational deployment; no field validation anywhere" />
        </div>
      </section>

      {/* provider registry */}
      <section aria-labelledby="fl-guide-providers">
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-zinc-500 mb-1.5">
          <Database className="h-3.5 w-3.5" aria-hidden="true" />
          <h3 id="fl-guide-providers">SOURCE &amp; PROVIDER REGISTRY (machine-readable)</h3>
        </div>
        <p className="text-[10px] leading-relaxed text-zinc-500 mb-1.5">
          Statuses come from <code>provider-status.json</code> in the repository — the same
          file that generates the README table. Adapter statuses are backed by tests;
          candidates are research leads whose access has <b>not</b> been verified.
          Verified {providerStatus.lastVerified}.
        </p>
        <div className="space-y-1">
          {providerStatus.implemented.map((p) => (
            <ProviderRow
              key={p.id}
              name={p.provider}
              dataset={p.dataset}
              status={p.pilotStatus}
              note={p.dataRole}
            />
          ))}
          {providerStatus.candidates.map((p) => (
            <ProviderRow
              key={p.id}
              name={p.provider}
              dataset={p.dataset}
              status={p.status}
              note={p.researchedTerms}
              candidate
            />
          ))}
        </div>
        <p className="text-[9px] leading-relaxed text-zinc-600 mt-1.5">
          * LIVE = the adapter is implemented and exercised by repository tests <b>in the local
          pilot</b> — never in this static public demo (all external network access is off here).
          A catalog listing is not an acquisition; no provider supplies a processed product here.
        </p>
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3" aria-labelledby="fl-guide-safety">
        <div className="flex items-center gap-1.5 mb-1">
          <ShieldAlert className="h-4 w-4 text-red-400" aria-hidden="true" />
          <h3 id="fl-guide-safety" className="text-[11px] font-bold text-red-300">
            LIFE-SAFETY BOUNDARY
          </h3>
        </div>
        <p className="text-[10px] leading-relaxed text-zinc-400">
          Disaster decision support can affect life safety. This prototype issues no
          dispatch, evacuation, or safe-route instructions; routes shown are toy-graph
          exercise paths. Missing or stale data is never rendered as low impact. Any
          consequential reading requires human review with explicit uncertainty.
          FirstLight is not operationally deployed and is not affiliated with any
          emergency agency.
        </p>
      </section>
    </div>
  );
}

function ModeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid sm:grid-cols-[190px_1fr] gap-x-3 gap-y-0.5 px-3 py-2">
      <span className="text-zinc-300 font-semibold">{label}</span>
      <span className="text-zinc-500 leading-relaxed">{value}</span>
    </div>
  );
}

function ProviderRow({
  name,
  dataset,
  status,
  note,
  candidate,
}: {
  name: string;
  dataset: string;
  status: string;
  note: string;
  candidate?: boolean;
}) {
  const blocked = /blocked|fixtures|candidate|not connected|not implemented/i.test(status);
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        candidate ? 'border-dashed border-zinc-800 bg-zinc-950/40' : 'border-zinc-800 bg-zinc-900/50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-zinc-200 truncate">{name}</span>
        <span
          className={`text-[8px] font-bold tracking-wider rounded px-1.5 py-px shrink-0 border ${
            blocked
              ? 'border-zinc-700 text-zinc-400'
              : 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
          }`}
        >
          {blocked ? 'NOT LIVE' : 'LIVE*'}
        </span>
      </div>
      <div className="text-[9px] text-zinc-500 leading-snug mt-0.5 truncate">{dataset}</div>
      <div className="text-[9px] text-zinc-400 leading-snug mt-0.5">
        <span className="text-zinc-600">status:</span> {status}
      </div>
      <div className="text-[9px] text-zinc-500 leading-snug mt-0.5 line-clamp-2">{note}</div>
    </div>
  );
}
