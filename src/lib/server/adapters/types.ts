/* ==========================================================================
 * FirstLight — DataSourceAdapter contract (Phase 2).
 *
 * Implements the adapter interface from the transformation brief so providers
 * can be swapped without rewriting the product. Every adapter must:
 *  - discover assets for an AOI/time window (bounded, quality-filtered),
 *  - acquire (download to a bounded staging buffer, or reference in place
 *    when the pilot stores metadata + URL only),
 *  - validate structure (geometry, timestamps, required fields),
 *  - normalize into catalog records,
 *  - and expose its license record for attribution and terms enforcement.
 *
 * Cross-cutting concerns live in http-client.ts (timeouts, retries with
 * backoff, rate-limit handling, response size bounds, SSRF host allowlists,
 * checksums) so individual adapters stay declarative.
 *
 * Adapters never see provider secrets from the browser: they run server-side
 * only and read keys from server env (see .env.example).
 * ========================================================================== */

export interface LicenseRecord {
  /** Short license/term name shown in the data catalog. */
  name: string;
  /** Required attribution line (null when none is required). */
  attribution: string | null;
  /** Terms URL for the record. */
  url?: string;
  /** True when commercial/derivative restrictions apply. */
  requiresReview?: boolean;
}

export interface DiscoveryRequest {
  eventId: string;
  aoi: { lat: number; lng: number; aoiKm: number };
  /** ISO time window [from, to] for the observation search. */
  timeWindow: { from: string; to: string };
  /** Maximum assets returned (adapters enforce a hard cap). */
  limit?: number;
  /** Adapter-specific parameters (validated per adapter). */
  params?: Record<string, unknown>;
}

export interface DiscoveredAsset {
  /** Provider-native identifier (stable across re-discovery). */
  externalId: string;
  title: string;
  assetType: string;
  acquiredAt?: string;
  publishedAt?: string;
  url?: string;
  /** Machine-readable quality metrics — surfaced in the catalog UI. */
  quality: Record<string, unknown>;
  /** GeoJSON geometry (Point or Polygon) when the provider supplies one. */
  geometry?: GeoJSONGeometry;
  license: LicenseRecord;
  /** Raw provider payload retained for provenance/debugging (bounded). */
  raw?: Record<string, unknown>;
}

export type GeoJSONGeometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'Polygon'; coordinates: [number, number][][] };

export interface AcquireDestination {
  /** 'reference' = catalog stores URL + checksum only (pilot default).
   *  'buffer'  = adapter downloads bounded bytes into memory for checksum. */
  mode: 'reference' | 'buffer';
  maxBytes: number;
}

export interface AcquiredAsset {
  mode: 'reference' | 'buffer';
  sizeBytes: number;
  sha256: string | null;
}

export interface ValidationCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface ValidationReport {
  ok: boolean;
  checks: ValidationCheck[];
}

export interface ProcessingContext {
  eventId: string;
  orgId: string;
}

export interface NormalizedProduct {
  adapterId: string;
  provider: string;
  assetType: string;
  externalId: string;
  title: string;
  acquiredAt: Date | null;
  publishedAt: Date | null;
  license: string;
  attribution: string | null;
  url: string | null;
  checksumSha256: string | null;
  sizeBytes: number | null;
  quality: Record<string, unknown>;
  geometry: GeoJSONGeometry | null;
  status: 'discovered' | 'acquired' | 'validated' | 'published' | 'failed';
  simulated: boolean;
}

/** Thrown when an adapter cannot run because an explicit external dependency
 *  (API key, licensed account, partner agreement) is not configured. The
 *  capability is then reported as BLOCKED — never fabricated. */
export class BlockedDependencyError extends Error {
  constructor(
    public adapterId: string,
    public missing: string,
    detail: string,
  ) {
    super(`${adapterId} is blocked by a missing dependency: ${missing}. ${detail}`);
    this.name = 'BlockedDependencyError';
  }
}

export type ProviderHealth = 'live' | 'fixtures-only' | 'blocked';

export interface DataSourceAdapter {
  id: string;
  /** Human-readable provider label for the catalog. */
  label: string;
  /** Data category (hazard feed, imagery catalog, exposure, roads, alert). */
  kind: 'hazard' | 'imagery' | 'exposure' | 'roads' | 'alert' | 'synthetic';
  /** Honest readiness statement surfaced in /api/meta and DATA_SOURCES.md. */
  health: ProviderHealth;
  healthNote: string;
  license(): LicenseRecord;
  discover(req: DiscoveryRequest, deps?: AdapterDeps): Promise<DiscoveredAsset[]>;
  acquire(asset: DiscoveredAsset, dest: AcquireDestination, deps?: AdapterDeps): Promise<AcquiredAsset>;
  validate(asset: DiscoveredAsset, acquired: AcquiredAsset): Promise<ValidationReport>;
  normalize(asset: DiscoveredAsset, acquired: AcquiredAsset, ctx: ProcessingContext): Promise<NormalizedProduct[]>;
}

/** Injectable IO so contract tests run without a network. */
export interface AdapterDeps {
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export const DEFAULT_DEPS: AdapterDeps = {};

/* ------------------------------------------------------------ shared helpers */

export function requireEnv(name: string, adapterId: string, hint: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new BlockedDependencyError(adapterId, name, hint);
  }
  return v.trim();
}

/** Validate a GeoJSON Point/Polygon minimally but strictly. */
export function validGeometry(g: GeoJSONGeometry | undefined): boolean {
  if (!g) return false;
  if (g.type === 'Point') {
    return (
      Array.isArray(g.coordinates) &&
      g.coordinates.length === 2 &&
      g.coordinates.every((n) => typeof n === 'number' && Number.isFinite(n))
    );
  }
  if (g.type === 'Polygon') {
    return (
      Array.isArray(g.coordinates) &&
      g.coordinates.length >= 1 &&
      g.coordinates.every(
        (ring) =>
          Array.isArray(ring) &&
          ring.length >= 4 &&
          ring.every(
            (pt) =>
              Array.isArray(pt) &&
              pt.length === 2 &&
              pt.every((n) => typeof n === 'number' && Number.isFinite(n)),
          ),
      )
    );
  }
  return false;
}

/** A bounded AOI in degrees — used to build provider bbox parameters. */
export function aoiToBbox(aoi: { lat: number; lng: number; aoiKm: number }): {
  west: number;
  south: number;
  east: number;
  north: number;
} {
  const dLat = aoi.aoiKm / 111.32;
  const dLng = aoi.aoiKm / Math.max(1e-6, 111.32 * Math.cos((aoi.lat * Math.PI) / 180));
  return {
    west: aoi.lng - dLng,
    south: aoi.lat - dLat,
    east: aoi.lng + dLng,
    north: aoi.lat + dLat,
  };
}
