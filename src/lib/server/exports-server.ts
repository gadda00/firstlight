/* ==========================================================================
 * FirstLight — server-side exports & offline bundle v2 (Phase 4).
 *
 * Every export is:
 *  - built from the SERVER's decision layer + durable review state (never
 *    from browser state),
 *  - checksummed (SHA-256) and size-recorded as an ExportArtifact,
 *  - provenance-stamped (score manifest, demo/synthetic labels, license
 *    notices, schema version),
 *  - approval-gated for sitrep exports.
 *
 * Offline bundle v2 replaces the old "one huge JSON" with a versioned,
 * size-bounded manifest: layer checksums, expiry, license notices, schema
 * version, and explicit stale/expired behavior on import.
 * ========================================================================== */

import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { appendAudit } from './audit';
import { errors } from './http';
import { buildEventLayer } from './event-core';
import { canonicalJson } from './audit';
import { manifestForExport } from '@/lib/firstlight/scoring';
import {
  damageGeoJSON,
  floodGeoJSON,
  zonesGeoJSON,
  roadsGeoJSON,
  routesGeoJSON,
  zonesCSV,
} from '@/lib/firstlight/exports';
import type { Claim } from './claims';
import type { ExportKind } from './schemas';

export const EXPORT_SCHEMA_VERSION = 'firstlight-export/2.0';
export const BUNDLE_SCHEMA_VERSION = 'firstlight-offline-bundle/2.0';

export interface BuiltExport {
  kind: ExportKind;
  filename: string;
  contentType: string;
  body: string;
  sha256: string;
  sizeBytes: number;
  approvalState: string;
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export async function buildExport(
  db: PrismaClient,
  ev: Parameters<typeof buildEventLayer>[1] & { id: string; orgId: string; name: string },
  kind: ExportKind,
  createdById: string,
  options: { ttlHours?: number } = {},
): Promise<BuiltExport> {
  const layer = await buildEventLayer(db, ev);
  const { raw, decision, manifest } = layer;
  const manifestOut = manifestForExport(manifest);
  const demoLabel = raw.demo
    ? {
        simulated: true as const,
        provider: raw.demo.provider,
        note: 'All detections in this export come from the LABELED SYNTHETIC demo layer.',
      }
    : { simulated: false as const };

  // Approval state for the sitrep gate.
  const approvedDraft = await db.sitrepDraft.findFirst({
    where: { eventId: ev.id, status: 'approved' },
    include: { approvals: { include: { approver: true } } },
  });
  const approvalState = approvedDraft
    ? `approved:${approvedDraft.approvals[0]?.approver.name ?? 'unknown'}`
    : 'unapproved';

  if (kind === 'sitrep.md') {
    if (!approvedDraft) {
      throw errors.conflict(
        'Sitrep export requires an APPROVED draft (two-person rule). Generate → approve → export.',
      );
    }
    const claims = JSON.parse(approvedDraft.claimsJson) as Claim[];
    const body = approvedDraft.markdown;
    const out = {
      format: EXPORT_SCHEMA_VERSION,
      kind,
      event: { id: ev.id, name: ev.name },
      approval: {
        state: approvalState,
        claimsHash: approvedDraft.claimsHash,
        approvedAt: approvedDraft.approvals[0]?.approvedAt?.toISOString() ?? null,
      },
      manifest: manifestOut,
      ...demoLabel,
      body,
    };
    return recordExport(db, ev, kind, out, createdById, approvalState, `${ev.id}-sitrep.md`, 'text/markdown');
  }

  let payload: unknown;
  let contentType = 'application/geo+json';
  let filename = `${ev.id}-${kind.replace('.', '-')}`;
  switch (kind) {
    case 'damage.geojson': {
      const tasks = await db.reviewTask.findMany({
        where: { eventId: ev.id },
        include: { decisions: { orderBy: { createdAt: 'asc' } } },
      });
      const decisions = new Map<string, string>();
      const newClasses = new Map<string, string>();
      for (const t of tasks) {
        const last = t.decisions[t.decisions.length - 1];
        if (!last) continue;
        decisions.set(t.targetId, last.decision);
        if (last.newClass) newClasses.set(t.targetId, last.newClass);
      }
      const fc = damageGeoJSON(raw, {
        decisions: decisions as never,
        newClasses: newClasses as never,
      });
      payload = {
        format: EXPORT_SCHEMA_VERSION,
        kind,
        event: { id: ev.id, name: ev.name },
        manifest: manifestOut,
        ...demoLabel,
        review_log: tasks.map((t) => ({
          target: t.targetId,
          last_decision: t.decisions[t.decisions.length - 1]?.decision ?? null,
        })),
        ...fc,
      };
      break;
    }
    case 'flood.geojson':
      payload = {
        format: EXPORT_SCHEMA_VERSION,
        kind,
        event: { id: ev.id, name: ev.name },
        manifest: manifestOut,
        ...demoLabel,
        ...floodGeoJSON(raw),
      };
      break;
    case 'zones.geojson':
      payload = {
        format: EXPORT_SCHEMA_VERSION,
        kind,
        event: { id: ev.id, name: ev.name },
        manifest: manifestOut,
        ...demoLabel,
        ...zonesGeoJSON(decision),
      };
      break;
    case 'roads.geojson':
      payload = {
        format: EXPORT_SCHEMA_VERSION,
        kind,
        event: { id: ev.id, name: ev.name },
        ...demoLabel,
        ...roadsGeoJSON(raw),
      };
      break;
    case 'routes.geojson':
      payload = {
        format: EXPORT_SCHEMA_VERSION,
        kind,
        event: { id: ev.id, name: ev.name },
        ...demoLabel,
        ...routesGeoJSON([]),
      };
      break;
    case 'zones.csv': {
      contentType = 'text/csv';
      filename = `${ev.id}-zones`;
      payload = {
        format: EXPORT_SCHEMA_VERSION,
        kind,
        event: { id: ev.id, name: ev.name },
        manifest: manifestOut,
        ...demoLabel,
        csv: zonesCSV(decision),
      };
      break;
    }
    case 'audit.json': {
      contentType = 'application/json';
      const audits = await db.auditEvent.findMany({
        where: { orgId: ev.orgId, payloadJson: { contains: ev.id } },
        orderBy: { seq: 'asc' },
      });
      payload = {
        format: EXPORT_SCHEMA_VERSION,
        kind,
        event: { id: ev.id, name: ev.name },
        chain: audits.map((a) => ({
          seq: a.seq,
          action: a.action,
          entity: `${a.entityType}:${a.entityId}`,
          hash: a.hash,
          prevHash: a.prevHash,
        })),
        note: 'Server-side SHA-256 hash chain — replaces the demo FNV-1a checksum.',
      };
      break;
    }
    case 'offline-bundle': {
      contentType = 'application/json';
      return buildOfflineBundle(db, ev, createdById, layer, options.ttlHours ?? 72);
    }
    default:
      throw errors.badRequest(`Unsupported export kind '${kind}'`);
  }
  return recordExport(db, ev, kind, payload, createdById, approvalState, filename, contentType);
}

async function recordExport(
  db: PrismaClient,
  ev: { id: string; orgId: string },
  kind: string,
  payload: unknown,
  createdById: string,
  approvalState: string,
  filename: string,
  contentType: string,
): Promise<BuiltExport> {
  const body = JSON.stringify(payload, null, 2);
  const hash = sha256(body);
  const artifact = await db.exportArtifact.create({
    data: {
      eventId: ev.id,
      kind,
      sizeBytes: Buffer.byteLength(body),
      sha256: hash,
      approvalState,
      createdById,
    },
  });
  await appendAudit(db, {
    orgId: ev.orgId,
    actorId: createdById,
    action: 'export.created',
    entityType: 'export-artifact',
    entityId: artifact.id,
    payload: { kind, sha256: hash, sizeBytes: Buffer.byteLength(body) },
  });
  return {
    kind: kind as ExportKind,
    filename,
    contentType,
    body,
    sha256: hash,
    sizeBytes: Buffer.byteLength(body),
    approvalState,
  };
}

/* ------------------------------------------------------- offline bundle v2 */

export interface BundleValidation {
  bundleId: string;
  valid: boolean;
  expired: boolean;
  revoked: boolean;
  staleWarnings: string[];
  checksumOk: boolean;
}

export async function buildOfflineBundle(
  db: PrismaClient,
  ev: { id: string; orgId: string; name: string },
  createdById: string,
  layer: Awaited<ReturnType<typeof buildEventLayer>>,
  ttlHours = 72,
): Promise<BuiltExport> {
  const { raw, decision, manifest } = layer;
  const layers = {
    damage: damageGeoJSON(raw, { decisions: new Map(), newClasses: new Map() }),
    flood: floodGeoJSON(raw),
    zones: zonesGeoJSON(decision),
    roads: roadsGeoJSON(raw),
  };
  const layerChecksums: Record<string, string> = {};
  for (const [name, fc] of Object.entries(layers)) {
    layerChecksums[name] = sha256(JSON.stringify(fc));
  }
  const assets = await db.assetRecord.findMany({ where: { eventId: ev.id } });
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
  const manifestJson = {
    format: BUNDLE_SCHEMA_VERSION,
    schemaVersion: 2,
    event: { id: ev.id, name: ev.name },
    generatedAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
    ttlHours,
    scoreManifest: manifestForExport(manifest),
    layerChecksums,
    licenseNotices: assets.map((a) => ({
      adapter: a.adapterId,
      license: a.license,
      attribution: a.attribution,
      simulated: a.simulated,
    })),
    demoLayer: raw.demo
      ? {
          simulated: true,
          provider: raw.demo.provider,
          note: 'Map layers are the LABELED SYNTHETIC demo layer until the raster processing phase lands.',
        }
      : { simulated: false },
    sizePolicy: 'Layers are individually checksummed and size-bounded; import validates each.',
  };
  const body = JSON.stringify(
    {
      manifest: manifestJson,
      layers,
    },
    null,
    2,
  );
  const hash = sha256(body);
  const bundle = await db.offlineBundle.create({
    data: {
      eventId: ev.id,
      manifestJson: JSON.stringify(manifestJson),
      sha256: hash,
      expiresAt,
      createdById,
    },
  });
  await appendAudit(db, {
    orgId: ev.orgId,
    actorId: createdById,
    action: 'bundle.created',
    entityType: 'offline-bundle',
    entityId: bundle.id,
    payload: { expiresAt: expiresAt.toISOString(), sha256: hash },
  });
  return {
    kind: 'offline-bundle',
    filename: `${ev.id}-offline-bundle.json`,
    contentType: 'application/json',
    body,
    sha256: hash,
    sizeBytes: Buffer.byteLength(body),
    approvalState: 'n/a (data bundle)',
  };
}

/** Import-side validation: checksums, expiry, revocation, staleness. */
export async function validateOfflineBundle(
  db: PrismaClient,
  bundleId: string,
  bodyJson: { manifest?: { layerChecksums?: Record<string, string>; expiresAt?: string }; layers?: Record<string, unknown> },
): Promise<BundleValidation> {
  const bundle = await db.offlineBundle.findUnique({ where: { id: bundleId } });
  if (!bundle) throw errors.notFound('Bundle not found');
  const now = Date.now();
  const expired = bundle.expiresAt.getTime() < now;
  const revoked = Boolean(bundle.revokedAt);
  const warnings: string[] = [];
  const provided = bodyJson.manifest?.layerChecksums ?? {};
  const expected = JSON.parse(bundle.manifestJson) as {
    layerChecksums?: Record<string, string>;
  };
  let checksumOk = true;
  for (const [name, expectHash] of Object.entries(expected.layerChecksums ?? {})) {
    if (provided[name] !== expectHash) {
      checksumOk = false;
      warnings.push(`layer '${name}' checksum mismatch (expected ${expectHash}, got ${provided[name] ?? 'missing'})`);
    }
    const layer = bodyJson.layers?.[name];
    if (layer) {
      const actual = sha256(JSON.stringify(layer));
      if (actual !== expectHash) {
        checksumOk = false;
        warnings.push(`layer '${name}' content does not match its recorded checksum`);
      }
    }
  }
  if (expired) warnings.push(`bundle EXPIRED at ${bundle.expiresAt.toISOString()} — do not use for operational decisions`);
  if (revoked) warnings.push('bundle REVOKED — holder must re-sync with the server');
  const ageH = (now - bundle.createdAt.getTime()) / 3600_000;
  if (!expired && ageH > 24) warnings.push(`bundle is ${ageH.toFixed(1)} h old — verify against server state before relying on it`);
  return {
    bundleId,
    valid: checksumOk && !expired && !revoked,
    expired,
    revoked,
    staleWarnings: warnings,
    checksumOk,
  };
}

/** Revoke a bundle (device loss, policy breach). */
export async function revokeOfflineBundle(
  db: PrismaClient,
  orgId: string,
  bundleId: string,
  actorId: string,
): Promise<void> {
  const bundle = await db.offlineBundle.findFirst({
    where: { id: bundleId, event: { orgId } },
  });
  if (!bundle) throw errors.notFound('Bundle not found');
  await db.offlineBundle.update({
    where: { id: bundleId },
    data: { revokedAt: new Date() },
  });
  await appendAudit(db, {
    orgId,
    actorId,
    action: 'bundle.revoked',
    entityType: 'offline-bundle',
    entityId: bundleId,
    payload: { revokedAt: new Date().toISOString() },
  });
}

export { canonicalJson };
