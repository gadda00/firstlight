/* ==========================================================================
 * FirstLight — Disaster Intelligence Platform
 * Core type definitions (mirrors the Technical Blueprint v2.0)
 * ========================================================================== */

export type DamageClass = 'none' | 'minor' | 'major' | 'destroyed';
export type EventArchetype = 'hurricane' | 'flood' | 'earthquake';
/** 'insufficient_evidence' = not enough data to rank — never silently
 *  presented as "informational" (see scoring.ts). */
export type AlertTier = 'warning' | 'watch' | 'informational' | 'insufficient_evidence';
export type FacilityType =
  | 'hospital'
  | 'school'
  | 'shelter'
  | 'water'
  | 'fire_station'
  | 'power';
export type FacilityStatus = 'operational' | 'degraded' | 'offline';
export type RoadClass = 'highway' | 'arterial' | 'local';
export type ReviewDecision = 'confirmed' | 'rejected' | 'reclassified';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Imagery / data source provenance record — "never silently mix sources". */
export interface ImagerySource {
  id: string;
  role: 'pre' | 'post' | 'aux';
  platform: string;
  sensor: string;
  date: string;
  resolutionM: number;
  cloudPct: number | null; // null => SAR (cloud-independent)
  license: string;
  processing: string;
}

export interface EventMeta {
  id: string;
  name: string;
  archetype: EventArchetype;
  location: string;
  country: string;
  center: LatLng;
  aoiKm: number; // half-extent of the square AOI (km)
  description: string;
  preDate: string;
  postDate: string;
  sensors: ImagerySource[];
  severity: number; // 0..1 archetype intensity
  seed: number;
  landfall?: LatLng; // hurricane
  riverAmplitudeKm?: number; // flood meander
  epicenter?: LatLng; // earthquake
  population: number;
  eventDate: string;
}

export interface Building {
  id: string;
  lng: number;
  lat: number;
  footprint: [number, number][]; // closed ring [lng, lat]
  damage: DamageClass;
  confidence: number; // 0..1
  areaM2: number;
  zone: string; // H3 index (res 8)
  reviewReason: string | null;
  truthCorrect: boolean; // seeded ground-truth flag (demo benchmarking only)
}

/** Time-stamped closure observation — replaces the bare `blocked` boolean.
 *  kind: hard = impassable; probable = likely impassable; reduced_speed =
 *  passable with delay; unverified = hazard reported, needs field check. */
export interface RoadClosure {
  observedAt: string;
  source: string;
  confidence: number;
  kind: 'hard' | 'probable' | 'reduced_speed' | 'unverified';
  expiresAt?: string | null;
}

export interface RoadSegment {
  id: string;
  coords: [number, number][]; // polyline [lng, lat]
  cls: RoadClass;
  lengthKm: number;
  speedKmh: number;
  blocked: boolean;
  blockCause: 'flood' | 'debris' | null;
  confidence: number;
  /** graph node ids [start, end] */
  nodes: [string, string];
  /** Directed edge (OSM oneway): traversal only start → end. */
  oneway?: boolean;
  /** Structured closure observation when blocked/affected. */
  closure?: RoadClosure;
}

export interface Facility {
  id: string;
  type: FacilityType;
  name: string;
  lng: number;
  lat: number;
  status: FacilityStatus;
  zone: string;
  /** travel time (minutes) from city EOC node on baseline / post-event graph */
  preTravelMin: number;
  postTravelMin: number;
  isolated: boolean;
  node: string; // nearest graph node
}

export interface PopCell {
  lng: number;
  lat: number;
  pop: number;
}

export interface FloodPolygon {
  id: string;
  ring: [number, number][]; // closed ring [lng, lat]
  depthClass: 'shallow' | 'moderate' | 'deep';
  areaKm2: number;
  source: string;
  confidence: number;
}

export interface PipelineStage {
  name: string;
  detail: string;
  ms: number;
}

/** Stamp applied by the DemoScenarioProvider to every synthetic dataset. */
export interface DemoProvenance {
  provider: 'demo-scenario-provider';
  simulated: true;
  seed: number;
  generatedAt: string;
}

export interface EventRawData {
  meta: EventMeta;
  buildings: Building[];
  roads: RoadSegment[];
  facilities: Facility[];
  popGrid: PopCell[];
  floods: FloodPolygon[];
  stages: PipelineStage[];
  totalPop: number;
  /** Present iff this dataset came from the DemoScenarioProvider. */
  demo?: DemoProvenance;
}

/** H3 zone with decision-layer component scores. */
export interface Zone {
  id: string; // H3 index res 8
  boundary: [number, number][]; // closed ring [lng, lat]
  centroid: LatLng;
  buildings: number;
  destroyed: number;
  major: number;
  minor: number;
  undamaged: number;
  /** Damage ratio D(z) — blueprint formula */
  D: number;
  /** Exposed population Pexp(z) — normalized */
  Pexp: number;
  /** Isolation Iso(z) — 1 if travel-time delta > 30 min or unreachable */
  Iso: number;
  /** Critical infrastructure Crit(z) — normalized count */
  Crit: number;
  need: number;
  tier: AlertTier;
  population: number;
  affectedPop: number;
  critCount: number;
  critImpacted: number;
  isolated: boolean;
  preHospitalMin: number;
  postHospitalMin: number;
  floodShare: number; // fraction of zone area under water (legacy point sampler)
  /** Area-weighted flood share (polygon∩hexagon area ratio) — scoring v2. */
  floodShareArea: number;
  /** Detection confidence mean in this zone (0..1). */
  meanConfidence: number;
  /** Input coverage quality (0..1) — drives missingness penalty + evidence tier. */
  dataQuality: number;
  /** 1 − dataQuality. */
  missingness: number;
  /** Need-score bounds from confidence propagation (scoring v2). */
  needLower: number;
  needUpper: number;
  /** Max rank shift under ±25% one-at-a-time weight perturbation. */
  sensitivity: number;
  /** True when ranking is fragile (rank shifts ≥ 2). */
  rankingUnstable: boolean;
  /** 'insufficient' → tier reported as insufficient_evidence. */
  evidenceTier: 'sufficient' | 'insufficient';
  /** Labeled exposure method id used for affectedPop (see SCORING_METHOD.md). */
  exposureMethod: string;
  rank: number;
}

export interface NeedWeights {
  w1: number; // damage
  w2: number; // population
  w3: number; // isolation
  w4: number; // critical facilities
}

/** Human-review state applied on top of model detections. */
export interface ReviewOverrides {
  decisions: Map<string, ReviewDecision>;
  newClasses: Map<string, DamageClass>;
}

export interface RouteResult {
  id: string;
  originName: string;
  destZoneId: string;
  destLabel: string;
  coords: [number, number][];
  distanceKm: number;
  etaMin: number;
  usesFlaggedSegments: boolean;
  blockedEdgesAvoided: number;
  confidence: number;
  /** Route-data honesty (Phase 3): closures crossed are itemized, and a
   *  route through unverified/probable closures demands field verification
   *  before dispatch — it is never presented as "safe". */
  closuresCrossed: Array<{ roadId: string; kind: string; confidence: number }>;
  requiresFieldVerification: boolean;
  graphVersion: string;
}

export interface EventDecisionData {
  zones: Zone[];
  zoneIndex: Map<string, Zone>;
  stats: {
    totalBuildings: number;
    destroyed: number;
    major: number;
    minor: number;
    damageRate: number;
    floodedAreaKm2: number;
    totalPop: number;
    affectedPop: number;
    affectedPct: number;
    isolatedZones: number;
    facilitiesOffline: number;
    facilitiesDegraded: number;
    hospitalsIsolated: number;
    meanConfidence: number;
    pendingReview: number;
    aoiKm2: number;
    /** Scoring-v2 stats. */
    zonesInsufficientEvidence: number;
    meanDataQuality: number;
    rankingUnstableZones: number;
    meanFloodConfidence: number;
  };
  routes: RouteResult[]; // computed on demand
}

export interface ReviewItem {
  building: Building;
  zoneRank: number;
  decision: ReviewDecision | null;
  newClass: DamageClass | null;
}

export interface ToolCallLog {
  tool: string;
  params: string;
  result: string;
}
