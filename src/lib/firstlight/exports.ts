/* ==========================================================================
 * FirstLight — Export layer (blueprint: GeoJSON / CSV / PDF-ready sitrep /
 * audit trail). All exports are generated client-side from reviewed data.
 * ========================================================================== */

import { fnv1a } from './rng';
import { fmtInt } from './geo';
import type {
  DamageClass,
  EventDecisionData,
  EventRawData,
  NeedWeights,
  ReviewOverrides,
  RouteResult,
} from './types';
import type { SitrepResult } from './sitrep';

export interface ExportBundle {
  raw: EventRawData;
  decision: EventDecisionData;
  overrides: ReviewOverrides;
  weights: NeedWeights;
  routes: RouteResult[];
  sitrep: SitrepResult | null;
  runId: string;
  approvedBy: string | null;
  generatedAt: string;
}

const DAMAGE_COLOR: Record<DamageClass, string> = {
  destroyed: '#ef4444',
  major: '#f97316',
  minor: '#fbbf24',
  none: '#22c55e',
};

export function damageGeoJSON(raw: EventRawData, overrides: ReviewOverrides) {
  return {
    type: 'FeatureCollection' as const,
    features: raw.buildings
      .filter((b) => {
        const d = overrides.decisions.get(b.id);
        if (d === 'rejected') return false;
        const eff = d === 'reclassified' ? overrides.newClasses.get(b.id) ?? b.damage : b.damage;
        return eff !== 'none';
      })
      .map((b) => {
        const d = overrides.decisions.get(b.id);
        const eff = d === 'reclassified' ? overrides.newClasses.get(b.id) ?? b.damage : b.damage;
        return {
          type: 'Feature' as const,
          id: b.id,
          geometry: {
            type: 'Point' as const,
            coordinates: [b.lng, b.lat],
          },
          properties: {
            id: b.id,
            damage_class: eff,
            original_class: b.damage,
            confidence: Number(b.confidence.toFixed(3)),
            area_m2: Math.round(b.areaM2),
            zone_h3: b.zone,
            reviewed: overrides.decisions.has(b.id) ? 'yes' : 'no',
            review_reason: b.reviewReason,
            color: DAMAGE_COLOR[eff],
            provenance: 'simulated: Siamese UNet demo inference',
          },
        };
      }),
  };
}

export function floodGeoJSON(raw: EventRawData) {
  return {
    type: 'FeatureCollection' as const,
    features: raw.floods.map((f) => ({
      type: 'Feature' as const,
      id: f.id,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [f.ring],
      },
      properties: {
        id: f.id,
        depth_class: f.depthClass,
        area_km2: Number(f.areaKm2.toFixed(2)),
        detection: f.source,
        confidence: f.confidence,
        provenance: 'simulated: SAR threshold + U-Net demo',
      },
    })),
  };
}

export function zonesGeoJSON(decision: EventDecisionData) {
  return {
    type: 'FeatureCollection' as const,
    features: decision.zones.map((z) => ({
      type: 'Feature' as const,
      id: z.id,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [z.boundary],
      },
      properties: {
        h3_index: z.id,
        rank: z.rank,
        need: Number(z.need.toFixed(4)),
        tier: z.tier,
        D: Number(z.D.toFixed(4)),
        Pexp: Number(z.Pexp.toFixed(4)),
        Iso: Number(z.Iso.toFixed(4)),
        Crit: Number(z.Crit.toFixed(4)),
        buildings: z.buildings,
        destroyed: z.destroyed,
        major: z.major,
        minor: z.minor,
        population: z.population,
        affected_pop: z.affectedPop,
        isolated: z.isolated,
        flood_share: Number(z.floodShare.toFixed(3)),
        pre_hospital_min: isFinite(z.preHospitalMin) ? Math.round(z.preHospitalMin) : null,
        post_hospital_min: isFinite(z.postHospitalMin) ? Math.round(z.postHospitalMin) : null,
      },
    })),
  };
}

export function roadsGeoJSON(raw: EventRawData) {
  return {
    type: 'FeatureCollection' as const,
    features: raw.roads.map((r) => ({
      type: 'Feature' as const,
      id: r.id,
      geometry: {
        type: 'LineString' as const,
        coordinates: r.coords,
      },
      properties: {
        id: r.id,
        class: r.cls,
        blocked: r.blocked,
        block_cause: r.blockCause,
        speed_kmh: r.speedKmh,
        length_km: Number(r.lengthKm.toFixed(3)),
        confidence: Number(r.confidence.toFixed(3)),
      },
    })),
  };
}

export function routesGeoJSON(routes: RouteResult[]) {
  return {
    type: 'FeatureCollection' as const,
    features: routes
      .filter((r) => r)
      .map((r) => ({
        type: 'Feature' as const,
        id: r.id,
        geometry: {
          type: 'LineString' as const,
          coordinates: r.coords,
        },
        properties: {
          origin: r.originName,
          dest_zone: r.destZoneId,
          dest_label: r.destLabel,
          distance_km: Number(r.distanceKm.toFixed(2)),
          eta_min: Number(r.etaMin.toFixed(1)),
          uses_flagged_segments: r.usesFlaggedSegments,
          blocked_edges_avoided: r.blockedEdgesAvoided,
          confidence: Number(r.confidence.toFixed(3)),
        },
      })),
  };
}

export function zonesCSV(decision: EventDecisionData): string {
  const head = [
    'rank',
    'h3_index',
    'tier',
    'need',
    'D',
    'Pexp',
    'Iso',
    'Crit',
    'buildings',
    'destroyed',
    'major',
    'minor',
    'population',
    'affected_pop',
    'isolated',
    'flood_share',
    'pre_hospital_min',
    'post_hospital_min',
  ].join(',');
  const rows = [...decision.zones]
    .sort((a, b) => a.rank - b.rank)
    .map((z) =>
      [
        z.rank,
        z.id,
        z.tier,
        z.need.toFixed(4),
        z.D.toFixed(4),
        z.Pexp.toFixed(4),
        z.Iso.toFixed(4),
        z.Crit.toFixed(4),
        z.buildings,
        z.destroyed,
        z.major,
        z.minor,
        z.population,
        z.affectedPop,
        z.isolated ? 'yes' : 'no',
        z.floodShare.toFixed(3),
        isFinite(z.preHospitalMin) ? Math.round(z.preHospitalMin) : 'inf',
        isFinite(z.postHospitalMin) ? Math.round(z.postHospitalMin) : 'inf',
      ].join(','),
    );
  return [head, ...rows].join('\n');
}

export function auditTrail(bundle: ExportBundle) {
  const { raw, decision, overrides, weights, routes, sitrep, runId, approvedBy } =
    bundle;
  const reviewLog = [...overrides.decisions.entries()].map(([bid, d]) => ({
    building: bid,
    decision: d,
    reclassified_to: d === 'reclassified' ? overrides.newClasses.get(bid) : undefined,
  }));
  const sections = {
    event: raw.meta.id,
    weights,
    stats: decision.stats,
    review_log: reviewLog,
    routes: routes.map((r) => ({ id: r.id, km: r.distanceKm, eta: r.etaMin })),
    sitrep_approved_by: approvedBy,
    sitrep_assertions: sitrep ? sitrep.assertions : [],
  };
  const hash = fnv1a(JSON.stringify(sections));
  return {
    format: 'firstlight-audit-trail/1.0',
    run_id: runId,
    generated_at: bundle.generatedAt,
    disclaimer: 'SIMULATED DEMO DATA — cryptographic assertion hashes are FNV-1a demo checksums',
    human_in_loop: {
      sitrep_approved: Boolean(approvedBy),
      approved_by: approvedBy,
      review_decisions: reviewLog.length,
    },
    ...sections,
    audit_hash: hash,
  };
}

export function offlineBundle(bundle: ExportBundle) {
  return {
    format: 'firstlight-offline-bundle/1.0',
    run_id: bundle.runId,
    generated_at: bundle.generatedAt,
    note: 'Air-gapped field bundle: layer GeoJSON, sitrep, and audit trail in one JSON file. See blueprint Layer 5 offline mode.',
    event: bundle.raw.meta,
    layers: {
      damage: damageGeoJSON(bundle.raw, bundle.overrides),
      flood: floodGeoJSON(bundle.raw),
      zones: zonesGeoJSON(bundle.decision),
      roads: roadsGeoJSON(bundle.raw),
      routes: routesGeoJSON(bundle.routes),
    },
    sitrep_markdown: bundle.sitrep?.markdown ?? null,
    audit: auditTrail(bundle),
  };
}

export function downloadJSON(filename: string, data: unknown) {
  downloadText(filename, JSON.stringify(data, null, 2), 'application/json');
}

export function downloadText(
  filename: string,
  text: string,
  mime = 'text/plain',
) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function slugEvent(eventId: string): string {
  return eventId.replace(/^ev-/, '');
}

export function statsLine(decision: EventDecisionData): string {
  const s = decision.stats;
  return `${fmtInt(s.affectedPop)} affected · ${fmtInt(s.destroyed + s.major)} bldg major+ · ${s.floodedAreaKm2.toFixed(1)} km² flood`;
}
