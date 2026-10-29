# PROVENANCE_SPEC.md — FirstLight lineage model

## 1. Chain of custody

```
provider record  →  DiscoveredAsset (externalId, raw payload bounded)
                  →  AcquiredAsset  (mode reference|buffer, sha256, size)
                  →  ValidationReport (named checks; failures recorded, never promoted)
                  →  NormalizedProduct → AssetRecord (catalog row, unique per
                     event+adapter+externalId, license + attribution + quality JSON)
                  →  Claim (tool, canonical params/value, evidenceAssetIds,
                     queryHash, qualityNote)
                  →  SitrepDraft (claimsJson + claimsHash) — frozen by SitrepApproval
                  →  ExportArtifact (sha256, approvalState) / OfflineBundle
                     (per-layer checksums, expiry, revocation)
                  →  AuditEvent (every state change, SHA-256 chained)
```

## 2. Identity rules

- **Asset identity** is provider-native: `(eventId, adapterId, externalId)`. Re-ingestion upserts — never duplicates — and only SUCCEEDED runs replay.
- **Claim identity** is the query hash: `SHA-256(tool : canonicalJson(params) : canonicalJson(value))`.
- **Claim-set identity** is `claimsHash` = SHA-256 over the canonical array of claim identities — frozen at approval.
- **Audit identity** is the per-org monotonic `seq` + hash chain covering prevHash, seq, action, entity, canonical payload, timestamp.

## 3. Labeling rules (the "impossible to overlook" contract)

| Situation | Mandatory label |
|---|---|
| Data from the DemoScenarioProvider | `simulated: true` + provider id + seed on every layer/export/claim |
| Discharge forecast | productClass `forecast-risk` — never a flood polygon, never depth |
| Earthquake feed record | metadata only — magnitude never becomes damage |
| Imagery STAC item | status `discovered` (reference) — never a processed detection |
| OSM facility | operationalStatus `unknown` until field-confirmed |
| Exposure estimate | exposureMethod id + UNCALIBRATED note |
| Sparse zone | `insufficient_evidence` tier + missingness |
| Fragile ranking | `rankingUnstable` + sensitivity shift |

## 4. Conflict handling

When evidence conflicts (e.g. two sources disagree on a facility status), the claim layer reports the conflict in `qualityNote` rather than silently selecting one. Sitrep Appendix B lists every contributing source with its license; conflicting sources are both cited.

## 5. What a downstream user can verify

Given any exported artifact:
1. Its recorded SHA-256 matches the bytes (integrity).
2. Every claim's `queryHash` re-computes from its tool/params/value (no invented numbers).
3. Every evidence asset resolves in the catalog with license + age (traceability).
4. The audit chain verifies end-to-end (no retroactive edits).
5. For bundles: per-layer checksums + expiry + revocation state on import.
