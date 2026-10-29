# ARCHITECTURE.md — FirstLight

## 1. System overview

FirstLight is a modular monolith with two run modes sharing one codebase:

```
                          ┌────────────────────────────────────────────┐
                          │                DEMO MODE                   │
                          │  static export (out/) — no server          │
                          │  DemoScenarioProvider → decision layer →   │
                          │  client-only exports (unchanged v2.1 UX)   │
                          └────────────────────────────────────────────┘
                                         │ separated by DEMO_MODE flag
                          ┌────────────────────────────────────────────┐
                          │             OPERATIONAL MODE               │
                          │                                            │
  browser ── /api/* ────▶ │  catch-all route (src/app/api/[[...path]]) │
                          │    └─ dispatch(): rate limit → auth → RBAC │
                          │        → Zod validation → handler          │
                          │  handlers: auth, events, review, sitrep,   │
                          │    exports, bundles, audit, score-configs  │
                          │  domain services (src/lib/server/):        │
                          │    ingestion ← adapters (registry)         │
                          │    event-core → decision layer (scoring v2)│
                          │    claims → sitrep-server (freeze)         │
                          │    exports-server (checksums, bundles)     │
                          │    audit (SHA-256 append-only chain)       │
                          │  persistence: Prisma → SQLite (pilot)      │
                          └────────────────────────────────────────────┘
```

**Separation rule (Phase 0):** `DemoScenarioProvider.generate()` throws in operational mode unless a caller passes an explicit `allowInOperationalMode` opt-in (used when an operational event attaches a *labeled* synthetic layer). There is no path where synthetic data silently masquerades as operational output: every layer, export, sitrep claim, and catalog row carries its `simulated` flag / `demo` provenance stamp.

## 2. Request lifecycle (operational)

1. **Edge**: single Next.js catch-all (`force-dynamic`, Node runtime) — one serverless surface.
2. **dispatch()** (`src/server/api/router.ts`): method allowlist → route match (table-driven) → fixed-window rate limit (20/min auth, 300/min general; Redis seam documented) → `requireAuth` (bearer → SHA-256 → live session) → `requireCapability` (lattice) — *all inside the error envelope so failures return JSON 401/403, never HTML 500s*.
3. **Handlers**: parse bodies through Zod (`src/lib/server/schemas.ts`) with a 64 KB cap; org-scoped queries via `getOrgEvent` (cross-tenant reads return 404, not 403 — existence hiding).
4. **Response envelope**: `{data}` or `{error:{code,message,requestId,retryable,details}}` + `x-request-id` on every response.
5. **Audit**: state-changing flows append to the per-org SHA-256 chain (gap-free seq inside a transaction).

## 3. Trust boundaries

| Boundary | Control |
|---|---|
| Browser ↔ server | Bearer session (192-bit, hash-stored, server-revocable, 24 h TTL); RBAC capability checks on every resolver; request size caps; rate limits |
| Server ↔ providers | HTTPS-only + per-adapter host allowlist (SSRF guard); timeouts (AbortController); bounded bodies; retries w/ backoff + Retry-After; content-type validation; secrets server-side only |
| Provider data ↔ catalog | Adapter `validate()` gate: geometry/timestamp/quality checks; failures recorded `failed`, never promoted |
| Catalog ↔ decisions | Scoring v2 manifest; missingness penalties; `insufficient_evidence` tier; uncertainty bounds |
| Decisions ↔ reports | Typed claim tools only; every claim cites asset IDs + query hash; approval freezes claim set by SHA-256 |
| Reports ↔ distribution | Two-person approval (generator ≠ approver); exports embed manifest + approval state + checksums; bundles expire/revoke |

## 4. Persistence design

Pilot: SQLite via Prisma (`db/firstlight.db`, **absolute** `DATABASE_URL` — see the relative-path trap in `src/lib/server/db.ts`). Production path: PostgreSQL + PostGIS for authoritative vector data, S3-compatible object storage for rasters/bundles, Redis for locks/queue coordination, BullMQ/Cloud Tasks for processing jobs. The schema (`prisma/schema.prisma`) is relational and metadata-first so this is a migration, not a redesign:

- **Tenancy**: `Organization` → users/events/score-configs/audit all org-scoped.
- **Auth**: `User.tokenHash` (pilot credential), `Session` (bearer hash, expiry, revocation).
- **Events**: `IncidentEvent` with lifecycle states + `version` (optimistic concurrency) + `demoLayer` flag.
- **Catalog**: `AssetRecord` unique on (eventId, adapterId, externalId) — provider-native identity; quality/geometry JSON; `simulated` flag.
- **Ingestion**: `IngestionRun` (idempotency key = event+adapter+param digest; **only SUCCEEDED runs replay** — failed runs are re-attemptable) + immutable `IngestionAttempt` log.
- **Review**: `ReviewTask` (version-guarded) + append-only `ReviewDecision` (reviewer identity, required reason, new class).
- **Scoring**: `ScoreConfig` versioned per org (admin-published).
- **Sitrep**: `SitrepDraft` (claims JSON + claimsHash) → `SitrepClaim` rows → `SitrepApproval` (approver, hash check).
- **Exports**: `ExportArtifact` (sha256, size, approval state) and `OfflineBundle` (manifest, expiry, revocation).
- **Audit**: `AuditEvent` — per-org monotonic seq, prevHash chain, canonical JSON payload.

## 5. Data flow: event → approved sitrep

```
create event (analyst) ──▶ demo layer bootstrap + review tasks created
ingest (analyst) ──▶ adapter discover→validate→normalize ──▶ AssetRecords (+audit)
layer read ──▶ event-core: DemoScenarioProvider(explicit opt-in) + DB review decisions
                + org score config ──▶ computeDecision(scoring v2)
review decide (reviewer) ──▶ immutable ReviewDecision (reason required, version check)
sitrep generate (analyst) ──▶ buildClaims (typed tools cite AssetRecords)
                           ──▶ deterministic markdown render ──▶ SitrepDraft vN
approve (approver ≠ generator) ──▶ claimsHash freeze ──▶ status approved
export (analyst) ──▶ server-built payload + sha256 ──▶ ExportArtifact (+audit)
bundle (analyst) ──▶ per-layer checksums + expiry ──▶ OfflineBundle
import ──▶ validateOfflineBundle: checksums, expiry, revocation, staleness
```

Scores are recomputed **server-side from the immutable decision history** on every layer/sitrep read — browser state is never the source of truth (Zustand holds only ephemeral UI state: layer visibility, camera, selection).

## 6. Adapter framework

`DataSourceAdapter` (`src/lib/server/adapters/types.ts`): `discover → acquire → validate → normalize → license()`, with injectable `AdapterDeps.fetchImpl` so contract tests run offline against recorded payloads. Cross-cutting I/O rules live once in `http-client.ts` (see trust boundaries above). Adapters are registered in `registry.ts`; `/api/meta` publishes their honest health (`live` / `fixtures-only` / `blocked`).

**Deliberate honesty rules encoded in adapters**: discharge forecasts are `forecast-risk`, never flood polygons; magnitude is never converted to damage; imagery items stay `discovered` references until raster processing exists; OSM facility operational status stays `unknown` until field-confirmed; FIRMS refuses to run without its token (`BlockedDependencyError` → 503 with the dependency named) rather than returning simulated hotspots.

## 7. Deferred components (and their seams)

| Component | Status | Seam |
|---|---|---|
| Python raster workers (SAR RTC, cloud masking, indices, COG) | Deferred | Adapters already emit STAC references; processing phase consumes them into `AssetRecord` products |
| ML detection models | Deferred | `DetectionProduct` contract specified in the transformation brief; `MODEL_CARD_TEMPLATE.md` is the required disclosure format; no synthetic "accuracy" claims allowed |
| Full road graph (OSM bulk, one-ways, turn restrictions) | Partial | `RoadGraph` supports directed edges + `RoadClosure` observations; PostGIS ingest is the scale path |
| OIDC/SAML + MFA | Deferred | Only `login()` changes — session/role seam is `src/lib/server/auth.ts` |
| Object storage / queue / Redis | Deferred | `IngestionRun` staging + `rateLimit()` are the containment points |
| PMTiles/MBTiles delivery | Deferred | Bundle v2 already checksums bounded GeoJSON layers |

## 8. Build topology

- `bun run build` — standalone server bundle; API route is `force-dynamic`.
- `bun run build:static` (`scripts/build-static.sh`) — static export; the API route directory is **temporarily stashed** during the build (trap-protected restore) because `output: export` cannot contain a dynamic route — and the demo build must never ship an accidental server surface.
- CI (`.github/workflows/ci.yml`): frozen install → lint → typecheck → 130 tests → operational build → static build. Pages deploy (`.github/workflows/deploy-pages.yml`) runs the static build with the `/firstlight` base path.
