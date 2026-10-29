/* ==========================================================================
 * FirstLight — API boundary validation (Zod).
 *
 * Every request body and query string crossing the API is parsed through a
 * schema here; unknown shapes, wrong types, and out-of-range values are
 * rejected with a structured error envelope (see http.ts). String-typed
 * Prisma enumerations are validated on THIS side of the boundary.
 * ========================================================================== */

import { z } from 'zod';

/* ------------------------------------------------------------------ enums */

export const ROLES = ['admin', 'approver', 'reviewer', 'analyst', 'observer'] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export const EVENT_STATUSES = [
  'draft',
  'ingesting',
  'processing',
  'review',
  'approved',
  'published',
  'archived',
] as const;
export const EventStatusSchema = z.enum(EVENT_STATUSES);

export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'dead'] as const;

export const ASSET_STATUSES = [
  'discovered',
  'acquired',
  'validated',
  'published',
  'failed',
] as const;

export const REVIEW_DECISIONS = ['confirmed', 'rejected', 'reclassified'] as const;
export const ReviewDecisionSchema = z.enum(REVIEW_DECISIONS);

export const DAMAGE_CLASSES = ['none', 'minor', 'major', 'destroyed'] as const;
export const DamageClassSchema = z.enum(DAMAGE_CLASSES);

export const EXPORT_KINDS = [
  'damage.geojson',
  'flood.geojson',
  'zones.geojson',
  'roads.geojson',
  'routes.geojson',
  'zones.csv',
  'sitrep.md',
  'audit.json',
  'offline-bundle',
] as const;
export const ExportKindSchema = z.enum(EXPORT_KINDS);
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const ARCHETYPES = ['hurricane', 'flood', 'earthquake'] as const;

/* ---------------------------------------------------------------- payloads */

export const LoginSchema = z.object({
  email: z.string().email(),
  token: z.string().min(8).max(256),
});

export const CreateEventSchema = z.object({
  name: z.string().min(3).max(120),
  archetype: z.enum(ARCHETYPES),
  country: z.string().min(2).max(80),
  location: z.string().min(2).max(160),
  center: z.object({ lat: z.number().min(-85).max(85), lng: z.number().min(-180).max(180) }),
  aoiKm: z.number().min(2).max(30).default(10),
  incidentTime: z.string().datetime().default(() => new Date().toISOString()),
  severity: z.number().min(0).max(1).default(0.7),
  /** Attach the labeled synthetic scenario layer (default true for pilot). */
  demoLayer: z.boolean().default(true),
});

export const IngestSchema = z.object({
  adapterId: z.string().min(3).max(60),
  params: z.record(z.string(), z.unknown()).default({}),
});

export const ReviewDecideSchema = z.object({
  decision: ReviewDecisionSchema,
  newClass: DamageClassSchema.optional(),
  reason: z.string().min(4, 'A decision reason is required').max(2000),
  notes: z.string().max(4000).optional(),
  /** Optimistic concurrency: must match the task's current version. */
  version: z.number().int().min(1),
});

export const ApproveSitrepSchema = z.object({
  reason: z.string().max(2000).optional(),
  /** Draft version being approved (freeze check). */
  expectedVersion: z.number().int().min(1),
});

export const CreateExportSchema = z.object({
  kind: ExportKindSchema,
  /** Sitrep exports require an approved draft; enforced in the handler. */
  options: z.record(z.string(), z.unknown()).default({}),
});

export const CreateBundleSchema = z.object({
  ttlHours: z.number().int().min(1).max(24 * 30).default(72),
});

export const ScoreConfigSchema = z.object({
  name: z.string().min(3).max(80),
  weights: z.object({
    w1: z.number().min(0).max(1),
    w2: z.number().min(0).max(1),
    w3: z.number().min(0).max(1),
    w4: z.number().min(0).max(1),
  }),
  normalization: z.enum(['max', 'p90robust']).default('max'),
  exposureMethod: z.enum([
    'heuristic-weighted-overlay-v1',
    'area-weighted-intersection-v1',
  ]).default('heuristic-weighted-overlay-v1'),
  missingPenalty: z.number().min(0).max(1).default(0.2),
});

/* ---------------------------------------------------------------- helpers */

export const UUIDISH = z.string().regex(/^[a-z0-9]{20,30}$/i, 'invalid id');
