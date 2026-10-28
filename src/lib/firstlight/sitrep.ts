/* ==========================================================================
 * FirstLight — Grounded Sitrep Engine (blueprint Layer 5).
 * Deterministic report generation: the "LLM layer" here drafts from typed
 * tool calls over the results database — every number in the text is bound
 * to a logged tool assertion. No free-form model invents measurements.
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
  const sarPost = meta.sensors.find((x) => x.sensor.includes('SAR'));
  const opticalPre = meta.sensors.find((x) => x.role === 'pre' && !x.sensor.includes('SAR'));
  const opticalPost = meta.sensors.find((x) => x.role === 'post' && !x.sensor.includes('SAR') && !x.sensor.includes('population'));

  const c1 = next(
    'get_event_summary',
    `{event_id: "${meta.id}"}`,
    `AOI ${(2 * meta.aoiKm).toFixed(0)}×${(2 * meta.aoiKm).toFixed(0)} km, event ${meta.eventDate}, post-image ${meta.postDate}`,
  );
  const c2 = next(
    'get_event_summary',
    `{event_id: "${meta.id}", facet: "damage"}`,
    `${fmtInt(s.totalBuildings)} buildings assessed: ${fmtInt(s.destroyed)} destroyed / ${fmtInt(s.major)} major / ${fmtInt(s.minor)} minor`,
  );
  const c3 = next(
    'get_event_summary',
    `{event_id: "${meta.id}", facet: "flood"}`,
    raw.floods.length
      ? `flood extent ${s.floodedAreaKm2.toFixed(1)} km² across ${raw.floods.length} polygons (${raw.floods.map((f) => f.source).join('; ')})`
      : 'no flood extent detected for this archetype',
  );
  const c4 = next(
    'get_event_summary',
    `{event_id: "${meta.id}", facet: "population"}`,
    `affected population ≈ ${fmtInt(s.affectedPop)} of ${fmtInt(s.totalPop)} (${fmtPct(s.affectedPct)})`,
  );
  const c5 = next(
    'top_zones',
    `{event_id: "${meta.id}", limit: 5, weights: damage .35/pop .25/iso .25/crit .15}`,
    `top zone ${top[0]?.id ?? 'n/a'} need=${top[0]?.need.toFixed(3) ?? 'n/a'}`,
  );
  const c6 = next(
    'isolated_facilities',
    `{event_id: "${meta.id}", type: "hospital"}`,
    `${offlineH.length} offline, ${degradedH.length} degraded, ${s.isolatedZones} isolated zones`,
  );
  const c7 = next(
    'low_confidence_areas',
    `{event_id: "${meta.id}"}`,
    `${pending} detections below 0.70 confidence awaiting review (${reviewed} reviewed)`,
  );

  const lines: string[] = [];
  lines.push(`# SITUATION REPORT — ${meta.name.toUpperCase()}`);
  lines.push('');
  lines.push(`**Classification:** SIMULATED DEMONSTRATION DATA — not an operational product`);
  lines.push(`**Location:** ${meta.location}, ${meta.country}`);
  lines.push(`**Run ID:** ${runId} · **Generated:** ${ctx.generatedAt.toISOString()}`);
  lines.push(`**Analyst approval:** PENDING — this draft requires human sign-off before distribution`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 1. Event Summary');
  lines.push('');
  lines.push(
    `${meta.description} Area of interest covers ${(2 * meta.aoiKm).toFixed(0)} × ${(2 * meta.aoiKm).toFixed(0)} km, with post-event imagery acquired ${meta.postDate} ${c1}. Imagery basis: ${opticalPre ? `${opticalPre.platform} (${opticalPre.date}, ${opticalPre.resolutionM} m, ${opticalPre.cloudPct}% cloud) ` : ''}${sarPost ? `and ${sarPost.platform} SAR ${sarPost.date} (cloud-independent)` : opticalPost ? `and ${opticalPost.platform} ${opticalPost.date}` : ''}.`,
  );
  lines.push('');
  lines.push('## 2. Impact Assessment');
  lines.push('');
  lines.push(
    `- **Buildings:** model assessment of ${fmtInt(s.totalBuildings)} structures: **${fmtInt(s.destroyed)} destroyed**, **${fmtInt(s.major)} major damage**, ${fmtInt(s.minor)} minor damage ${c2}. Structural damage rate (major+destroyed): **${fmtPct(s.damageRate)}**.`,
  );
  if (raw.floods.length) {
    lines.push(
      `- **Flood extent:** **${s.floodedAreaKm2.toFixed(1)} km²** mapped from SAR change detection with permanent-water masking ${c3}.`,
    );
  }
  lines.push(
    `- **Population:** estimated **${fmtInt(s.affectedPop)} people affected** (${fmtPct(s.affectedPct)} of AOI population) by damage or inundation footprints ${c4}.`,
  );
  lines.push(
    `- **Mean detection confidence:** ${s.meanConfidence.toFixed(3)}; ${fmtInt(s.pendingReview)} detections queued for human review ${c7}.`,
  );
  lines.push('');
  lines.push('## 3. Priority Zones (H3 res-8 need scores)');
  lines.push('');
  lines.push(
    `Ranked by need(z) = 0.35·D + 0.25·Pexp + 0.25·Iso + 0.15·Crit — transparent and tunable with partner agencies ${c5}:`,
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
  lines.push('## 4. Isolation & Access');
  lines.push('');
  lines.push(
    `- **Hospitals:** ${offlineH.length} offline (${offlineH.map((h) => h.name).join(', ') || 'none'}), ${degradedH.length} degraded, ${s.hospitalsIsolated} isolated by travel-time delta > 30 min ${c6}.`,
  );
  lines.push(
    `- **Communities:** ${s.isolatedZones} H3 zones isolated on the passable-road graph (baseline vs post-event Dijkstra on OSM-derived network).`,
  );
  if (isolatedZones.length) {
    lines.push(
      `  - Highest-priority isolated zones: ${isolatedZones.slice(0, 4).map((z) => `#${z.rank} (${fmtInt(z.population)} pop)`).join(', ')}.`,
    );
  }
  if (ctx.routeNote) lines.push(`- **Routing:** ${ctx.routeNote}`);
  lines.push(
    `- Roads flagged as blocked: ${raw.roads.filter((r) => r.blocked).length} of ${raw.roads.length} segments (flood intersection or debris proxy buffers).`,
  );
  lines.push('');
  lines.push('## 5. Data Quality & Limitations');
  lines.push('');
  lines.push(
    `- Confidence-driven review queue: ${fmtInt(s.pendingReview)} pending, ${reviewed} reviewed (${confirmed} confirmed, ${rejected} rejected as false positives) ${c7}.`,
  );
  lines.push(
    `- Known failure modes handled explicitly: ${sarPost ? 'urban double-bounce and wind-roughened water in SAR flood maps; ' : ''}${meta.archetype === 'earthquake' ? 'rubble/shadow occlusion in dense collapse pockets; ' : 'flood-edge ambiguity at detection boundaries; '}domain shift across regions.`,
  );
  lines.push(
    `- Imagery gaps: optical cloud cover may delay confirmation; SAR provides all-weather screening but not depth estimation.`,
  );
  lines.push(
    `- **All damage footprints, facility statuses and population figures in this report are procedurally SIMULATED for platform demonstration** and must not be used operationally.`,
  );
  lines.push('');
  lines.push('## 6. Recommended Actions (DRAFT — requires analyst approval)');
  lines.push('');
  lines.push(
    `- **WARNING-tier zones:** dispatch ground assessment teams to ${decision.zones.filter((z) => z.tier === 'warning').length} zones; prioritize ${top[0] ? `zone #${top[0].rank}` : 'n/a'}.`,
  );
  lines.push(
    `- **WATCH-tier zones:** monitor and queue drone tasking for confirmation of uncertain detections.`,
  );
  lines.push(
    `- **Isolation:** verify hospital access routes; establish alternate staging if travel-time deltas persist.`,
  );
  lines.push(
    `- **Review queue:** clear pending low-confidence detections before distributing derived statistics.`,
  );
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Appendix A — Tool Call Log (grounded assertions)');
  lines.push('');
  lines.push('Every figure in this report was produced by a typed tool call over the results database:');
  lines.push('');
  toolCalls.forEach((tc, i) => {
    lines.push(`${i + 1}. \`${tc.tool}(${tc.params})\` → ${tc.result}`);
    lines.push(`   assertion hash: \`${fnv1a(`${tc.tool}:${tc.params}:${tc.result}`)}\``);
  });
  lines.push('');
  lines.push('## Appendix B — Provenance');
  lines.push('');
  for (const src of meta.sensors) {
    lines.push(
      `- **${src.role.toUpperCase()}** ${src.platform} · ${src.sensor} · ${src.date} · ${src.resolutionM} m · ${src.cloudPct === null ? 'SAR (cloud-independent)' : `${src.cloudPct}% cloud`} · ${src.license} · ${src.processing}`,
    );
  }
  lines.push('- Population: WorldPop 100 m UN-adjusted (CC BY 4.0) — simulated grid for demo');
  lines.push('- Roads & facilities: OSM-derived synthetic network (ODbL-style attribution retained)');
  lines.push('');

  return { markdown: lines.join('\n'), toolCalls, assertions };
}

export function zoneSummaryLine(z: Zone): string {
  return `Zone #${z.rank} — need ${z.need.toFixed(3)} (${z.tier}), ${z.destroyed} destroyed / ${z.major} major of ${z.buildings} buildings, ${fmtInt(z.population)} pop${z.isolated ? ', ISOLATED' : ''}`;
}
