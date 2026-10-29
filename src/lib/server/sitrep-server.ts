/* ==========================================================================
 * FirstLight — server-backed sitrep flow (Phase 4).
 *
 * Draft generation: builds the claim set via typed tools (claims.ts) and
 * renders Markdown DETERMINISTICALLY from those claims. No LLM is involved
 * in producing numbers; if an LLM later polishes wording, it receives the
 * claim set + template version and its output hash is logged — measurements
 * stay tool-bound.
 *
 * Approval freeze: an approver (different person from the draft generator —
 * two-person rule) freezes the exact claim set by its SHA-256 hash. Any
 * later data change produces a NEW draft version; the approved artifact
 * stays byte-stable and re-servable forever.
 * ========================================================================== */

import type { PrismaClient, AssetRecord } from '@prisma/client';
import { appendAudit } from './audit';
import { errors } from './http';
import { buildClaims, claimsHash, type Claim } from './claims';
import { buildEventLayer } from './event-core';

export interface DraftSummary {
  id: string;
  eventId: string;
  version: number;
  status: 'draft' | 'approved' | 'superseded';
  claimsHash: string;
  generatedBy: string;
  approvedBy: string | null;
  claims: Claim[];
  markdown: string;
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function renderMarkdown(
  ev: { name: string; location: string; country: string; incidentTime: Date },
  claims: Claim[],
  assets: AssetRecord[],
  approval: { approverName: string | null; approvedAt: string | null },
): string {
  const byTool = (tool: string) => claims.filter((c) => c.tool === tool);
  const cite = (c: Claim) => `[${c.seq}]`;
  const lines: string[] = [];

  lines.push(`# SITUATION REPORT — ${ev.name.toUpperCase()}`);
  lines.push('');
  lines.push(`**Classification:** ${approval.approverName ? 'APPROVED (frozen claim set)' : 'DRAFT — pending approval'}`);
  lines.push(`**Location:** ${ev.location}, ${ev.country}`);
  lines.push(`**Incident time:** ${ev.incidentTime.toISOString()}`);
  lines.push(`**Claim set hash (SHA-256):** \`${claimsHash(claims)}\``);
  if (approval.approverName) {
    lines.push(`**Approved by:** ${approval.approverName} at ${approval.approvedAt}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  /* Summary section */
  lines.push('## 1. Event Summary');
  lines.push('');
  for (const c of byTool('get_event_summary').slice(0, 1)) {
    lines.push(
      `Area of interest and timing recorded from the event workspace ${cite(c)}.`,
    );
  }
  lines.push('');

  /* Impact */
  lines.push('## 2. Impact Assessment');
  lines.push('');
  const damage = byTool('get_event_summary').find((c) => c.params.facet === 'damage');
  if (damage) {
    lines.push(
      `- **Buildings:** ${fmtInt(damage.value.buildings_assessed as number)} assessed — **${fmtInt(damage.value.destroyed as number)} destroyed**, **${fmtInt(damage.value.major as number)} major**, ${fmtInt(damage.value.minor as number)} minor ${cite(damage)}${damage.qualityNote ? ` _(${damage.qualityNote})_` : ''}`,
    );
  }
  const flood = byTool('get_event_summary').find((c) => c.params.facet === 'flood');
  if (flood) {
    lines.push(
      `- **Flood extent:** ${flood.value.flooded_area_km2} km² across ${flood.value.flood_polygons} polygons, mean confidence ${flood.value.mean_flood_confidence} ${cite(flood)}`,
    );
  }
  const pop = byTool('get_event_summary').find((c) => c.params.facet === 'population');
  if (pop) {
    lines.push(
      `- **Population:** estimated **${fmtInt(pop.value.affected_population as number)} people affected** (${pop.value.affected_pct}% of AOI population) ${cite(pop)}${pop.qualityNote ? ` _(${pop.qualityNote})_` : ''}`,
    );
  }
  lines.push('');

  /* Hazard feeds (real sources) */
  const hazardClaims = byTool('hazard_feed');
  const imagery = byTool('imagery_coverage');
  if (hazardClaims.length || imagery.length) {
    lines.push('## 3. External Hazard & Source Evidence');
    lines.push('');
    for (const c of hazardClaims) {
      const v = c.value as Record<string, unknown>;
      lines.push(`- ${String(v.event ?? v.product_class ?? 'provider record')} ${cite(c)}${c.qualityNote ? ` — _${c.qualityNote}_` : ''}`);
    }
    for (const c of imagery) {
      lines.push(`- Imagery catalogue: ${c.value.stac_items} STAC item(s), ${JSON.stringify(c.value.collections)} ${cite(c)} — _${c.qualityNote}_`);
    }
    lines.push('');
  }

  /* Zones */
  const top = byTool('top_zones')[0];
  if (top) {
    lines.push('## 4. Priority Zones (need-score v2)');
    lines.push('');
    lines.push(`Ranked with the versioned score configuration ${cite(top)}:`);
    lines.push('');
    lines.push('| Rank | Zone (H3) | Tier | Need | Bounds | Unstable? |');
    lines.push('|---|---|---|---|---|---|');
    for (const z of top.value.zones as Array<Record<string, unknown>>) {
      lines.push(
        `| #${z.rank} | ${z.h3} | ${String(z.tier).toUpperCase()} | ${z.need} | [${(z.need_bounds as number[])[0]}, ${(z.need_bounds as number[])[1]}] | ${z.ranking_unstable ? '⚠ yes' : 'no'} |`,
      );
    }
    lines.push('');
  }

  /* Isolation */
  const iso = byTool('isolated_facilities')[0];
  if (iso) {
    lines.push('## 5. Isolation & Access');
    lines.push('');
    lines.push(
      `- **Hospitals:** ${iso.value.hospitals_isolated} isolated; ${iso.value.facilities_offline} facilities offline, ${iso.value.facilities_degraded} degraded ${cite(iso)}`,
    );
    lines.push(
      `- **Communities:** ${iso.value.isolated_zones} zones isolated on the post-event passable-road graph ${cite(iso)}`,
    );
    lines.push('');
  }

  /* Review + quality */
  const review = byTool('review_status')[0];
  const quality = byTool('data_quality')[0];
  const manifest = byTool('score_manifest')[0];
  const freshness = byTool('source_freshness')[0];
  lines.push('## 6. Review, Data Quality & Limitations');
  lines.push('');
  if (review) {
    lines.push(
      `- Review queue: ${review.value.tasks_open} open / ${review.value.tasks_decided} decided (${review.value.review_decisions_total} total decisions) ${cite(review)}`,
    );
  }
  if (quality) {
    lines.push(
      `- Data quality: mean ${quality.value.mean_data_quality}; ${quality.value.zones_insufficient_evidence} zones flagged NOT-ENOUGH-EVIDENCE; ${quality.value.zones_with_unstable_ranking} zones have unstable rankings ${cite(quality)}`,
    );
  }
  if (freshness) {
    lines.push(
      `- Source freshness: ${freshness.value.sources} catalog sources; oldest ${freshness.value.oldest_source_hours ?? 'n/a'} h ${cite(freshness)}`,
    );
  }
  if (manifest) {
    lines.push(
      `- Score configuration: ${manifest.value.version} — weights ${JSON.stringify(manifest.value.weights)}, normalization ${manifest.value.normalization}, exposure ${manifest.value.exposure_method} ${cite(manifest)}`,
    );
  }
  lines.push('');
  lines.push('## 7. Recommended Actions (DRAFT — requires authorized approval)');
  lines.push('');
  lines.push('- Deploy ground assessment to WARNING-tier zones in rank order.');
  lines.push('- Verify routes flagged "requires field verification" before dispatch.');
  lines.push('- Clear the low-confidence review queue before distributing derived statistics.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Appendix A — Claim Ledger');
  lines.push('');
  lines.push('Every number above was produced by a typed query tool over durable state:');
  lines.push('');
  for (const c of claims) {
    lines.push(
      `${c.seq}. \`${c.tool}(${JSON.stringify(c.params)})\` → ${JSON.stringify(c.value)}`,
    );
    lines.push(`   evidence assets: ${c.evidenceAssetIds.length ? c.evidenceAssetIds.join(', ') : '(computed layer)'}`);
    lines.push(`   query hash: \`${c.queryHash}\`${c.qualityNote ? ` — ${c.qualityNote}` : ''}`);
  }
  lines.push('');
  lines.push('## Appendix B — Source Licenses & Attribution');
  lines.push('');
  const seen = new Set<string>();
  for (const a of assets) {
    const key = `${a.adapterId}:${a.license}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`- **${a.adapterId}** — ${a.license}${a.attribution ? ` — ${a.attribution}` : ''}${a.simulated ? ' — **SIMULATED**' : ''}`);
  }
  if (!assets.length) lines.push('- (no external sources ingested for this event yet)');
  lines.push('');
  return lines.join('\n');
}

/** Generate (or regenerate) a draft sitrep from current durable state. */
export async function generateSitrepDraft(
  db: PrismaClient,
  ev: Parameters<typeof buildEventLayer>[1] & { id: string; orgId: string },
  generatedById: string,
): Promise<DraftSummary> {
  const layer = await buildEventLayer(db, ev);
  const claims = await buildClaims(db, ev, layer);
  const hash = claimsHash(claims);
  const assets = await db.assetRecord.findMany({ where: { eventId: ev.id } });

  // Any existing approved draft stays frozen; a new generation supersedes
  // prior DRAFTS only (approved versions remain queryable).
  const currentDraft = await db.sitrepDraft.findFirst({
    where: { eventId: ev.id, status: 'draft' },
  });
  if (currentDraft) {
    await db.sitrepDraft.update({
      where: { id: currentDraft.id },
      data: { status: 'superseded' },
    });
  }
  const maxVersion = await db.sitrepDraft.findFirst({
    where: { eventId: ev.id },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (maxVersion?.version ?? 0) + 1;

  const markdown = renderMarkdown(
    ev,
    claims,
    assets,
    { approverName: null, approvedAt: null },
  );

  const draft = await db.sitrepDraft.create({
    data: {
      eventId: ev.id,
      version,
      status: 'draft',
      markdown,
      claimsJson: JSON.stringify(claims),
      claimsHash: hash,
      generatedById,
    },
  });
  for (const c of claims) {
    await db.sitrepClaim.create({
      data: {
        draftId: draft.id,
        seq: c.seq,
        tool: c.tool,
        paramsJson: JSON.stringify(c.params),
        valueJson: JSON.stringify(c.value),
        evidenceAssetIds: JSON.stringify(c.evidenceAssetIds),
        queryHash: c.queryHash,
        qualityNote: c.qualityNote,
      },
    });
  }
  await appendAudit(db, {
    orgId: ev.orgId,
    actorId: generatedById,
    action: 'sitrep.generated',
    entityType: 'sitrep-draft',
    entityId: draft.id,
    payload: { eventId: ev.id, version, claimsHash: hash, claims: claims.length },
  });

  return {
    id: draft.id,
    eventId: ev.id,
    version,
    status: 'draft',
    claimsHash: hash,
    generatedBy: generatedById,
    approvedBy: null,
    claims,
    markdown,
  };
}

/** Approve (freeze) a draft — two-person rule + claim-set hash check. */
export async function approveSitrepDraft(
  db: PrismaClient,
  input: {
    draftId: string;
    orgId: string;
    approverId: string;
    approverName: string;
    expectedVersion: number;
    reason?: string;
    generatorId: string;
  },
): Promise<DraftSummary> {
  const draft = await db.sitrepDraft.findFirst({
    where: { id: input.draftId, event: { orgId: input.orgId } },
    include: { approvals: true },
  });
  if (!draft) throw errors.notFound('Sitrep draft not found');
  if (draft.status === 'approved') {
    throw errors.conflict('Draft is already approved (frozen)');
  }
  if (draft.version !== input.expectedVersion) {
    throw errors.stale(
      `Draft moved to version ${draft.version} (expected ${input.expectedVersion}) — re-fetch and retry`,
      { currentVersion: draft.version },
    );
  }
  if (draft.approvals.length > 0) {
    throw errors.conflict('Draft already has an approval record');
  }
  // Two-person rule: the approver must differ from the generator.
  if (input.approverId === input.generatorId) {
    throw errors.conflict(
      'Two-person rule: the approver must be a different person from the draft generator',
    );
  }
  const claims = JSON.parse(draft.claimsJson) as Claim[];
  const currentHash = claimsHash(claims);
  if (currentHash !== draft.claimsHash) {
    throw errors.conflict(
      'Claim set hash mismatch — the stored claims were modified after generation',
    );
  }
  await db.sitrepApproval.create({
    data: {
      draftId: draft.id,
      approverId: input.approverId,
      claimsHash: draft.claimsHash,
      reason: input.reason,
    },
  });
  await db.sitrepDraft.update({
    where: { id: draft.id },
    data: { status: 'approved' },
  });
  // The approval freezes the STORED artifact: the markdown and claim set
  // remain byte-stable and are re-served exactly as approved. (The approval
  // identity + hash are recorded above; regenerating after data changes
  // creates a NEW draft version rather than mutating this one.)
  await appendAudit(db, {
    orgId: input.orgId,
    actorId: input.approverId,
    action: 'sitrep.approved',
    entityType: 'sitrep-draft',
    entityId: draft.id,
    payload: { claimsHash: draft.claimsHash, reason: input.reason ?? null },
  });

  return {
    id: draft.id,
    eventId: draft.eventId,
    version: draft.version,
    status: 'approved',
    claimsHash: draft.claimsHash,
    generatedBy: draft.generatedById,
    approvedBy: input.approverName,
    claims,
    markdown: draft.markdown,
  };
}
