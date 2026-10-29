# DATA_DICTIONARY.md — FirstLight schemas

## 1. Database (pilot SQLite via Prisma — `prisma/schema.prisma`)

| Model | Key fields | Notes |
|---|---|---|
| Organization | `slug*`, `name` | tenant root |
| User | `orgId`, `email*`, `role` (admin\|approver\|reviewer\|analyst\|observer), `tokenHash?`, `revokedAt?` | pilot credential = SHA-256 of account token |
| Session | `userId`, `tokenHash*` (bearer hash), `expiresAt`, `revokedAt`, `lastSeenAt` | 24 h TTL |
| IncidentEvent | `orgId`, `name`, `archetype`, `status` (draft→ingesting→processing→review→approved→published→archived), `centerLat/Lng`, `aoiKm`, `incidentTime`, `severity`, `seed`, `demoLayer`, `version` (optimistic concurrency) | lifecycle transitions enforced server-side |
| AssetRecord | `eventId`, `adapterId`, `externalId`, `assetType` (hazard.earthquake, hazard.flood-forecast, hazard.fire-hotspot, alert.cap, imagery.stac-item, exposure.population, roads.osm, roads.facility), `acquiredAt?`, `publishedAt?`, `license`, `attribution?`, `url?`, `checksumSha256?`, `qualityJson`, `geometryJson?`, `status` (discovered→acquired→validated→published\|failed), `simulated` | unique (eventId, adapterId, externalId) |
| IngestionRun | `eventId`, `adapterId`, `idempotencyKey*`, `status` (queued→running→succeeded\|failed\|dead), `attempts`, `stageLogsJson`, `error?` | replay only on success |
| IngestionAttempt | `runId`, `attemptNo`, `ok`, `httpStatus?`, `latencyMs?`, `error?` | immutable log |
| ReviewTask | `eventId`, `targetType`, `targetId`, `reason`, `modelConfidence`, `priority`, `status` (open\|in_review\|decided), `version` | concurrency guard |
| ReviewDecision | `taskId`, `reviewerId`, `decision` (confirmed\|rejected\|reclassified), `newClass?`, **`reason` (required)**, `notes?` | append-only |
| ScoreConfig | `orgId`, `eventId?`, `name`, `weightsJson`, `normalization` (max\|p90robust), `exposureMethod`, `missingPenalty`, `version`, `approvedById?` | org default = null eventId |
| SitrepDraft | `eventId`, `version`, `status` (draft\|approved\|superseded), `markdown`, `claimsJson`, `claimsHash` | unique (eventId, version) |
| SitrepClaim | `draftId`, `seq`, `tool`, `paramsJson`, `valueJson`, `evidenceAssetIds`, `queryHash`, `qualityNote?` | tools: get_event_summary, top_zones, isolated_facilities, review_status, source_freshness, hazard_feed, imagery_coverage, data_quality, score_manifest |
| SitrepApproval | `draftId`, `approverId`, `claimsHash` (freeze check), `reason?` | approver ≠ generator |
| ExportArtifact | `eventId`, `kind`, `sizeBytes`, `sha256`, `approvalState`, `createdById` | sitrep.md requires approval |
| OfflineBundle | `eventId`, `manifestJson`, `sha256`, `expiresAt`, `revokedAt?` | v2 format |
| AuditEvent | `orgId`, `seq` (gap-free), `action`, `entityType/Id`, `payloadJson` (canonical), `prevHash`, `hash` | append-only chain |

## 2. API surface (`docs/openapi.yaml` for the full contract)

| Method & path | Capability | Purpose |
|---|---|---|
| GET /api/meta | public | mode, provider health, ethics statement |
| GET /api/health | public | never-throw health probe |
| POST /api/auth/login · logout | public · session | pilot credential → bearer; server-side revoke |
| GET /api/me | session | user + effective capabilities |
| GET/POST /api/events | read · createEvent | list (org-scoped) · create (+layer bootstrap) |
| GET/PATCH /api/events/{id} | read · createEvent | detail + counts · lifecycle transitions |
| POST /api/events/{id}/ingest | runIngestion | idempotent adapter run |
| GET /api/events/{id}/catalog · layer | read | catalog + run logs · computed decision layer |
| GET /api/events/{id}/review/tasks | read | queue with decision history |
| POST /api/review/tasks/{id}/decide | reviewDecide | immutable decision (reason + version required) |
| GET /api/events/{id}/sitrep · POST …/generate | read · generateSitrep | versions · new draft from durable state |
| POST /api/sitrep/{id}/approve | approveSitrep | freeze (two-person rule) |
| GET/POST /api/events/{id}/exports | read · createExport | artifacts · build (approval-gated for sitrep.md) |
| POST /api/events/{id}/bundle · /api/bundle/{id}/import · revoke | createExport · read · approveSitrep | bundle v2 lifecycle |
| GET /api/audit · POST /api/audit/verify | readAudit | chain listing · integrity verification |
| GET/POST /api/score-configs | read · publishScoreConfig | versioned score profiles |

## 3. Export payloads

All exports share the envelope: `format: "firstlight-export/2.0"`, event identity, the score manifest (`manifestForExport` — formulas, weights, calibration note), and the demo/synthetic label. Kinds: `damage.geojson`, `flood.geojson`, `zones.geojson`, `roads.geojson`, `routes.geojson`, `zones.csv`, `sitrep.md`, `audit.json`, `offline-bundle`.

Offline bundle v2: `{ manifest: { format: "firstlight-offline-bundle/2.0", schemaVersion: 2, expiresAt, ttlHours, scoreManifest, layerChecksums, licenseNotices[], demoLayer }, layers: { damage, flood, zones, roads } }`.

## 4. Zone record (decision layer / exports)

`h3_index`, `rank`, `tier` (warning\|watch\|informational\|insufficient_evidence), `need` + `needLower/needUpper`, `sensitivity`, `rankingUnstable`, `evidenceTier`, `D/Pexp/Iso/Crit`, building counts by class, `population`, `affectedPop` (labeled heuristic), `isolated`, `floodShareArea` (v2) + `floodShare` (legacy point sampler), `dataQuality`/`missingness`, `pre/postHospitalMin`, `exposureMethod`.
