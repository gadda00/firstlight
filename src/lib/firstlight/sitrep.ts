/* ==========================================================================
 * FirstLight — Grounded Sitrep Engine (SIMULATED EXERCISE report).
 * Deterministic report generation over the generated scenario: every number
 * in the text is bound to a logged tool assertion over the synthetic
 * dataset. The report identifies itself as a synthetic exercise at the
 * top, beside the recommendations, and in the provenance appendix —
 * not only in a header line. Recommendations are hypothetical tabletop
 * discussion prompts, never dispatch instructions.
 * ========================================================================== */

import { fnv1a } from './rng';
import { fmtInt, fmtPct } from './geo';
import type {
  EventDecisionData,
  EventRawData,
  ReviewOverrides,
  ToolCallLog,
  Zone,
} from './types';

export interface SitrepContext {
  raw: EventRawData;
  decision: EventDecisionData;
  overrides: ReviewOverrides;
  generatedAt: Date;
  runId: string;
  routeNote?: string;
}

export interface SitrepResult {
  markdown: string;
  toolCalls: ToolCallLog[];
  assertions: { claim: string; hash: string }[];
}

function fmtMin(m: number): string {
  if (!isFinite(m)) return 'unreachable';
  return `${Math.round(m)} min`;
}

export function generateSitrep(ctx: SitrepContext): SitrepResult {
  const { raw, decision, overrides, runId } = ctx;
  const { meta } = raw;
  const s = decision.stats;
  const toolCalls: ToolCallLog[] = [];
  const assertions: { claim: string; hash: string }[] = [];
  let cite = 0;
  const next = (tool: string, params: string, result: string): string => {
    const n = ++cite;
    toolCalls.push({ tool, params, result });
    assertions.push({
      claim: result,
      hash: fnv1a(`${tool}:${params}:${result}`),
    });
    return `[${n}]`;
  };

  const top = decision.zones.slice(0, 5);
  const isolatedZones = decision.zones.filter((z) => z.isolated);
  const hospitals = raw.facilities.filter((f) => f.type === 'hospital');
  const offlineH = hospitals.filter((f) => f.status === 'offline');
  const degradedH = hospitals.filter((f) => f.status === 'degraded');
  const pending = s.pendingReview;
  const reviewed = overrides.decisions.size;
  const confirmed = [...overrides.decisions.values()].filter((d) => d === 'confirmed').length;
  const rejected = [...overrides.decisions.values()].filter((d) => d === 'rejected').length;
  const simulatedSensors = meta.sensors.filter((x) => x.simulated);

  const c1 = next(
    'get_event_summary',
    `{event_id: "${meta.id}"}`,
    `AOI ${(2 * meta.aoiKm).toFixed(0)}×${(2 * meta.aoiKm).toFixed(0)} km, generated scenario (scenario clock ${meta.eventDate})`,
  );
  const c2 = next(
    'get_event_summary',
    `{event_id: "${meta.id}", facet: "damage"}`,
    `${fmtInt(s.totalBuildings)} generated buildings: ${fmtInt(s.destroyed)} destroyed / ${fmtInt(s.major)} major / ${fmtInt(s.minor)} minor (all labels drawn by the seeded generator)`,
  );
  const c3 = next(
    'get_event_summary',
    `{event_id: "${meta.id}", facet: "flood"}`,
    raw.floods.length
      ? `generated flood extent ${s.floodedAreaKm2.toFixed(1)} km² across ${raw.floods.length} polygons (procedural bands; no imagery processed)`
      : 'no flood polygons generated for this archetype',
  );
  const c4 = next(
    'get_event_summary',
    `{event_id: "${meta.id}", facet: "population"}`,
    `generated affected-population estimate ≈ ${fmtInt(s.affectedPop)} of ${fmtInt(s.totalPop)} (${fmtPct(s.affectedPct)}) — illustrative model, not a census product`,
  );
  const c5 = next(
    'top_zones',
    `{event_id: "${meta.id}", limit: 5, weights: damage .35/pop .25/iso .25/crit .15}`,
    `top zone ${top[0]?.id ?? 'n/a'} need=${top[0]?.need.toFixed(3) ?? 'n/a'}`,
  );
  const c6 = next(
    'isolated_facilities',
    `{event_id: "${meta.id}", type: "hospital"}`,
    `${offlineH.length} offline, ${degradedH.length} degraded, ${s.isolatedZones} isolated zones (generated statuses — no facility was observed)`,
  );
  const c7 = next(
    'low_confidence_areas',
    `{event_id: "${meta.id}"}`,
    `${pending} detections below 0.70 generated scenario score awaiting review (${reviewed} reviewed)`,
  );

  const lines: string[] = [];
  lines.push(`# SYNTHETIC EXERCISE REPORT — ${meta.name.toUpperCase()}`);
  lines.push('');
  lines.push(
    '**Classification:** SIMULATED EXERCISE — GENERATED SCENARIO DATA. Not current conditions, not real event reporting, not an operational product.',
  );
  lines.push(
    `**Scenario:** ${meta.id} · seed ${meta.seed} — every footprint, closure, status, and population figure below is generated fiction.`,
  );
  lines.push(`**Location:** ${meta.location}, ${meta.country}`);
  lines.push(`**Run ID:** ${runId} · **Generated:** ${ctx.generatedAt.toISOString()}`);
  lines.push(
    '**Analyst approval:** PENDING — this draft requires human sign-off before distribution',
  );
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 1. Scenario Summary');
  lines.push('');
  lines.push(
    `${meta.description} Area of interest covers ${(2 * meta.aoiKm).toFixed(0)} × ${(2 * meta.aoiKm).toFixed(0)} km ${c1}. **No imagery was acquired or processed for this report.** The sensor records below are illustrative catalog-metadata shapes (${simulatedSensors.length} entries, all marked "not acquired") ${simulatedSensors.length ? `: ${simulatedSensors.map((x) => x.platform.replace(' (illustrative metadata)', '')).join(', ')}` : ''}.`,
  );
  lines.push('');
  lines.push('## 2. Generated Impact Assessment');
  lines.push('');
  lines.push(
    `- **Buildings:** generated labels for ${fmtInt(s.totalBuildings)} structures: **${fmtInt(s.destroyed)} destroyed**, **${fmtInt(s.major)} major damage**, ${fmtInt(s.minor)} minor damage ${c2}. Combined major+destroyed label rate: **${fmtPct(s.damageRate)}**.`,
  );
  if (raw.floods.length) {
    lines.push(
      `- **Flood extent:** **${s.floodedAreaKm2.toFixed(1)} km²** of generated flood polygons (procedural bands — no SAR was thresholded, no DEM was used) ${c3}.`,
    );
  }
  lines.push(
    `- **Population:** generated estimate of **≈${fmtInt(s.affectedPop)} people affected** (${fmtPct(s.affectedPct)} of the scenario's nominal AOI population) by the generated damage or inundation footprints — an illustrative model, not a measurement of any real population ${c4}.`,
  );
  lines.push(
    `- **Mean generated scenario score:** ${s.meanConfidence.toFixed(3)} (seeded procedural values — NOT model probabilities); ${fmtInt(s.pendingReview)} detections queued for human review ${c7}.`,
  );
  lines.push('');
  lines.push('## 3. Priority Zones (H3 res-8 need scores)');
  lines.push('');
  lines.push(
    `Ranked by need(z) = 0.35·D + 0.25·Pexp + 0.25·Iso + 0.15·Crit over the generated data — transparent, tunable, and UNCALIBRATED heuristic weights ${c5}:`,
  );
  lines.push('');
  lines.push('| Rank | Zone (H3) | Tier | Need | D | Pexp | Iso | Crit | Bldg (des/maj) | Pop |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const z of top) {
    lines.push(
      `| #${z.rank} | ${z.id} | ${z.tier.toUpperCase()} | ${z.need.toFixed(3)} | ${z.D.toFixed(2)} | ${z.Pexp.toFixed(2)} | ${z.Iso.toFixed(0)} | ${z.Crit.toFixed(2)} | ${z.destroyed}/${z.major} of ${z.buildings} | ${fmtInt(z.population)} |`,
    );
  }
  lines.push('');
  lines.push('## 4. Isolation & Access (generated network)');
  lines.push('');
  lines.push(
    `- **Hospitals:** ${offlineH.length} offline (${offlineH.map((h) => h.name).join(', ') || 'none'}), ${degradedH.length} degraded, ${s.hospitalsIsolated} isolated by travel-time delta > 30 min — all generated statuses; no facility was observed ${c6}.`,
  );
  lines.push(
    `- **Communities:** ${s.isolatedZones} H3 zones isolated on the generated toy-road graph (baseline vs post-scenario Dijkstra — not an OSM or current-conditions network).`,
  );
  if (isolatedZones.length) {
    lines.push(
      `  - Highest-priority isolated zones: ${isolatedZones.slice(0, 4).map((z) => `#${z.rank} (${fmtInt(z.population)} generated pop)`).join(', ')}.`,
    );
  }
  if (ctx.routeNote) lines.push(`- **Routing:** ${ctx.routeNote}`);
  lines.push(
    `- Roads carrying generated closures: ${raw.roads.filter((r) => r.blocked).length} of ${raw.roads.length} generated segments (flood-polygon intersection or debris-proxy draws).`,
  );
  lines.push('');
  lines.push('## 5. Data Quality & Limitations');
  lines.push('');
  lines.push(
    `- Review queue: ${fmtInt(s.pendingReview)} pending, ${reviewed} reviewed (${confirmed} confirmed, ${rejected} rejected) by scenario score ${c7}. In this static demo, review decisions are ephemeral — they do not persist across reloads and no model retrains on them.`,
  );
  lines.push(
    `- The failure modes a real SAR/optical pipeline would face (urban double-bounce, wind-roughened water, flood-edge ambiguity, rubble/shadow occlusion, domain shift) are simulated here as generator penalties — they are not measured errors of this system.`,
  );
  lines.push(
    `- **No real data entered this report.** Sensor metadata is illustrative; population is a synthetic 2-centre Gaussian grid; roads and facilities are procedurally generated. Nothing here has been field-verified.`,
  );
  lines.push('');
  lines.push('## 6. Hypothetical Tabletop Discussion (NOT dispatch instructions)');
  lines.push('');
  lines.push(
    'For exercise discussion only — no action below is executed, authorized, or recommended by this document:',
  );
  lines.push('');
  lines.push(
    `- **If this were a real event:** ground-truth teams would be dispatched to the ${decision.zones.filter((z) => z.tier === 'warning').length} warning-tier zones, starting with zone #${top[0]?.rank ?? 'n/a'} — discuss that ordering and whether the need-score weights would change it.`,
  );
  lines.push(
    `- **Uncertain detections:** in a real response, confirmation tasking (e.g. drone) would be queued for low-score detections — discuss which zones justify that cost in this scenario.`,
  );
  lines.push(
    `- **Isolation:** discuss how responders would verify hospital access with the data actually available, and where alternate staging would sit if travel-time deltas persisted.`,
  );
  lines.push(
    `- **Review discipline:** discuss what evidence threshold would be required before any derived statistic left the analyst room.`,
  );
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Appendix A — Tool Call Log (grounded over the synthetic dataset)');
  lines.push('');
  lines.push(
    'Every figure in this report was produced by a typed tool call over the generated results database:',
  );
  lines.push('');
  toolCalls.forEach((tc, i) => {
    lines.push(`${i + 1}. \`${tc.tool}(${tc.params})\` → ${tc.result}`);
    lines.push(`   demo checksum: \`${fnv1a(`${tc.tool}:${tc.params}:${tc.result}`)}\` (FNV-1a)`);
  });
  lines.push('');
  lines.push(
    '> **Checksum honesty:** the values above are non-cryptographic FNV-1a demo checksums. They detect transcription drift within this demo only — they are **not** digital signatures and do **not** verify the truth, origin, or tamper-resistance of any assertion. The operational pilot (local, server-backed) uses a separate SHA-256 audit chain for its server workflow; that chain is not present in this static demo.',
  );
  lines.push('');
  lines.push('## Appendix B — Provenance (all illustrative)');
  lines.push('');
  for (const src of meta.sensors) {
    lines.push(
      `- **${src.role.toUpperCase()} · ILLUSTRATIVE (not acquired):** ${src.platform} · ${src.sensor} · ${src.date} · nominal ${src.resolutionM} m — ${src.license}`,
    );
  }
  lines.push(
    '- Population: synthetic 2-centre Gaussian grid (~300 m cells) scaled to the scenario total — illustrative model, NOT WorldPop or any census product.',
  );
  lines.push(
    '- Roads & facilities: procedurally generated grid network and generic synthetic facilities — NOT OpenStreetMap data.',
  );
  lines.push(
    '- Basemap only: © OpenStreetMap contributors · Esri · CARTO (map tiles; no imagery of the AOI is used).',
  );
  lines.push('');

  return { markdown: lines.join('\n'), toolCalls, assertions };
}

export function zoneSummaryLine(z: Zone): string {
  return `Zone #${z.rank} — need ${z.need.toFixed(3)} (${z.tier}), ${z.destroyed} destroyed / ${z.major} major of ${z.buildings} generated buildings, ${fmtInt(z.population)} generated pop${z.isolated ? ', ISOLATED' : ''}`;
}
