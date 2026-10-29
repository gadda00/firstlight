/* ==========================================================================
 * FirstLight — typed claim tools (Phase 4).
 *
 * Sitrep numbers are ONLY allowed to come from these tools. Every claim:
 *  - names the tool + canonical params,
 *  - carries the value (unit-annotated),
 *  - cites the AssetRecords that back it (catalog lineage),
 *  - is hash-bound (SHA-256 of tool:canonical(params):canonical(value)),
 *  - carries an honest quality note (synthetic labeling, staleness,
 *    uncertainty).
 *
 * An LLM may later improve the WORDING of a sitrep; it can never invent a
 * measurement, because the draft is assembled exclusively from this claim
 * set (see SITREP flow in ARCHITECTURE.md).
 * ========================================================================== */

import { createHash } from 'node:crypto';
import type { PrismaClient, AssetRecord } from '@prisma/client';
import { canonicalJson } from './audit';
import type { EventLayer } from './event-core';

export interface Claim {
  seq: number;
  tool: string;
  params: Record<string, unknown>;
  value: Record<string, unknown>;
  evidenceAssetIds: string[];
  queryHash: string;
  qualityNote: string | null;
}

function claimQueryHash(tool: string, params: unknown, value: unknown): string {
  return createHash('sha256')
    .update(`${tool}:${canonicalJson(params)}:${canonicalJson(value)}`)
    .digest('hex');
}

function mk(
  seq: number,
  tool: string,
  params: Record<string, unknown>,
  value: Record<string, unknown>,
  evidenceAssetIds: string[] = [],
  qualityNote: string | null = null,
): Claim {
  return {
    seq,
    tool,
    params,
    value,
    evidenceAssetIds,
    queryHash: claimQueryHash(tool, params, value),
    qualityNote,
  };
}

/** All typed query tools over the event's durable state. */
export async function buildClaims(
  db: PrismaClient,
  ev: { id: string; name: string; location: string; country: string; incidentTime: Date; aoiKm: number; demoLayer: boolean },
  layer: EventLayer,
): Promise<Claim[]> {
  const claims: Claim[] = [];
  const push = (c: Omit<Claim, 'seq'>) => claims.push({ ...c, seq: claims.length + 1 });
  const s = layer.decision.stats;
  const { raw, manifest } = layer;
  const meta = raw.meta;

  const assets = await db.assetRecord.findMany({
    where: { eventId: ev.id },
    orderBy: { createdAt: 'asc' },
  });
  const assetIdsFor = (...adapterIds: string[]) =>
    assets.filter((a) => adapterIds.includes(a.adapterId)).map((a) => a.id);
  const demoSyntheticNote = ev.demoLayer
    ? 'detections from the LABELED SYNTHETIC layer (DemoScenarioProvider) — not operational measurements'
    : null;

  /* --- event summary (AOI, timing) --- */
  push(
    mk(0, 'get_event_summary', { event_id: ev.id, facet: 'aoi' }, {
      aoi_km_side: Number((2 * ev.aoiKm).toFixed(1)),
      incident_time: ev.incidentTime.toISOString(),
      analysis_layer: ev.demoLayer ? 'synthetic-labeled' : 'ingested-products',
    }),
  );

  /* --- damage --- */
  push(
    mk(0, 'get_event_summary', { event_id: ev.id, facet: 'damage' }, {
      buildings_assessed: s.totalBuildings,
      destroyed: s.destroyed,
      major: s.major,
      minor: s.minor,
      damage_rate_major_plus: Number(s.damageRate.toFixed(4)),
    }, [], demoSyntheticNote),
  );

  /* --- flood extent --- */
  push(
    mk(0, 'get_event_summary', { event_id: ev.id, facet: 'flood' }, {
      flood_polygons: raw.floods.length,
      flooded_area_km2: Number(s.floodedAreaKm2.toFixed(2)),
      mean_flood_confidence: Number((s.meanFloodConfidence ?? 1).toFixed(3)),
    }, [], demoSyntheticNote),
  );

  /* --- population exposure (labeled heuristic) --- */
  push(
    mk(0, 'get_event_summary', { event_id: ev.id, facet: 'population' }, {
      total_population: Math.round(s.totalPop),
      affected_population: s.affectedPop,
      affected_pct: Number((s.affectedPct * 100).toFixed(1)),
      units: 'persons (estimate)',
    }, assetIdsFor('worldpop'),
    `exposure method ${manifest.exposureMethod} — UNCALIBRATED pilot heuristic; population grid uncertainty ±${Math.round(manifest.populationUncertainty * 100)}%`),
  );

  /* --- top zones --- */
  const top = layer.decision.zones.slice(0, 5);
  push(
    mk(0, 'top_zones', { event_id: ev.id, limit: 5, weights: manifest.weights }, {
      zones: top.map((z) => ({
        h3: z.id,
        rank: z.rank,
        need: Number(z.need.toFixed(3)),
        need_bounds: [Number(z.needLower.toFixed(3)), Number(z.needUpper.toFixed(3))],
        tier: z.tier,
        ranking_unstable: z.rankingUnstable,
      })),
    }, [], demoSyntheticNote),
  );

  /* --- isolated facilities --- */
  push(
    mk(0, 'isolated_facilities', { event_id: ev.id, type: 'hospital' }, {
      hospitals_isolated: s.hospitalsIsolated,
      isolated_zones: s.isolatedZones,
      facilities_offline: s.facilitiesOffline,
      facilities_degraded: s.facilitiesDegraded,
    }, [], demoSyntheticNote),
  );

  /* --- review status --- */
  const [openTasks, decidedTasks, decisions] = await Promise.all([
    db.reviewTask.count({ where: { eventId: ev.id, status: 'open' } }),
    db.reviewTask.count({ where: { eventId: ev.id, status: 'decided' } }),
    db.reviewDecision.count({
      where: { task: { eventId: ev.id } },
    }),
  ]);
  push(
    mk(0, 'review_status', { event_id: ev.id }, {
      tasks_open: openTasks,
      tasks_decided: decidedTasks,
      review_decisions_total: decisions,
      pending_flagged_detections: s.pendingReview,
    }),
  );

  /* --- source freshness (catalog-driven) --- */
  const now = Date.now();
  const freshness = assets.map((a: AssetRecord) => {
    const t = (a.acquiredAt ?? a.publishedAt ?? a.createdAt).getTime();
    return {
      adapter: a.adapterId,
      asset_type: a.assetType,
      age_hours: Number(((now - t) / 3600000).toFixed(1)),
      status: a.status,
      simulated: a.simulated,
    };
  });
  push(
    mk(0, 'source_freshness', { event_id: ev.id }, {
      sources: freshness.length,
      oldest_source_hours: freshness.length
        ? Math.max(...freshness.map((f) => f.age_hours))
        : null,
      per_source: freshness.slice(0, 12),
    }),
  );

  /* --- hazard feeds (REAL adapter records, when ingested) --- */
  const quakes = assets.filter((a) => a.adapterId === 'usgs-earthquake');
  for (const q of quakes.slice(0, 3)) {
    const qual = JSON.parse(q.qualityJson) as Record<string, unknown>;
    push(
      mk(0, 'hazard_feed', { event_id: ev.id, source: 'usgs-earthquake', asset_id: q.id }, {
        event: q.title,
        magnitude: qual.magnitude ?? null,
        depth_km: qual.depthKm ?? null,
        alert_level: qual.alertLevel ?? null,
        origin_time: q.acquiredAt?.toISOString() ?? null,
      }, [q.id],
      'REAL provider record (USGS public domain); metadata only — magnitude is never converted to damage'),
    );
  }

  const floods = assets.filter((a) => a.adapterId === 'open-meteo-flood');
  for (const f of floods.slice(0, 2)) {
    const qual = JSON.parse(f.qualityJson) as Record<string, unknown>;
    push(
      mk(0, 'hazard_feed', { event_id: ev.id, source: 'open-meteo-flood', asset_id: f.id }, {
        product_class: 'forecast-risk',
        peak_discharge_m3s: qual.peakDischargeM3s ?? null,
        units: 'm³/s',
        forecast_days: qual.forecastDays ?? null,
        peak_valid_time: qual.peakValidTime ?? null,
      }, [f.id],
      'REAL provider record (GloFAS via Open-Meteo, CC BY 4.0) — a DISCHARGE FORECAST, not an observed flood polygon'),
    );
  }

  const alerts = assets.filter((a) => a.adapterId === 'nws-alerts');
  if (alerts.length) {
    push(
      mk(0, 'hazard_feed', { event_id: ev.id, source: 'nws-alerts' }, {
        active_alerts: alerts.length,
        highest_severity: alerts
          .map((a) => (JSON.parse(a.qualityJson) as Record<string, unknown>).severity as string)
          .filter(Boolean)
          .sort()
          .pop() ?? null,
        titles: alerts.slice(0, 5).map((a) => a.title),
      }, alerts.slice(0, 5).map((a) => a.id),
      'REAL provider records (NOAA/NWS public domain) — advisory metadata'),
    );
  }

  /* --- imagery coverage --- */
  const imagery = assets.filter((a) => a.adapterId === 'copernicus-stac');
  if (imagery.length) {
    push(
      mk(0, 'imagery_coverage', { event_id: ev.id, source: 'copernicus-stac' }, {
        stac_items: imagery.length,
        collections: [...new Set(imagery.map((a) => (JSON.parse(a.qualityJson) as Record<string, unknown>).collection as string))],
        processing_status: 'discovered (metadata only — raster processing deferred)',
      }, imagery.map((a) => a.id),
      'REAL STAC metadata (Copernicus free & open); assets are catalog REFERENCES, not processed detections'),
    );
  }

  /* --- data quality --- */
  push(
    mk(0, 'data_quality', { event_id: ev.id }, {
      zones_insufficient_evidence: s.zonesInsufficientEvidence,
      mean_data_quality: Number(s.meanDataQuality.toFixed(3)),
      zones_with_unstable_ranking: s.rankingUnstableZones,
      mean_detection_confidence: Number(s.meanConfidence.toFixed(3)),
    }, [], demoSyntheticNote),
  );

  /* --- score manifest --- */
  push(
    mk(0, 'score_manifest', { event_id: ev.id }, {
      version: manifest.version,
      weights: manifest.weights,
      normalization: manifest.normalization,
      exposure_method: manifest.exposureMethod,
      missing_penalty: manifest.missingPenalty,
    }, [],
    'Versioned score configuration — see SCORING_METHOD.md for formulas and calibration status'),
  );

  void meta;
  return claims.map((c, i) => ({ ...c, seq: i + 1 }));
}

export function claimsHash(claims: Claim[]): string {
  return createHash('sha256')
    .update(canonicalJson(claims.map((c) => ({
      tool: c.tool,
      params: c.params,
      value: c.value,
      evidenceAssetIds: c.evidenceAssetIds,
      queryHash: c.queryHash,
    }))))
    .digest('hex');
}
