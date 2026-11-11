# Evidence ledger — public claims vs. verified reality

> Every claim FirstLight makes anywhere (site, README, reports, exports), with its mode, implementation status, verification evidence, and unresolved owner action. Verified in-repo on **2026-11-11** at commit of this file; baseline command outputs at the bottom. Documentation is treated as unverified until the implementation is inspected and the relevant test is run — nothing below is hand-waved.

**Modes:** `demo` = public static site (GitHub Pages) · `pilot` = locally-runnable server mode · — = does not exist.

## A. What the public demo claims (and what it actually does)

| # | Claim (current, post-v2.3) | Mode | Status | Evidence | Verified | Unresolved owner action |
|---|---|---|---|---|---|---|
| 1 | "SIMULATED EXERCISE — generated scenario data; not current conditions" banner persists across all viewports | demo | **true** | `src/components/firstlight/simulated-banner.tsx`; pinned by `tests/honesty.test.ts` ("persistent banner… never dismissible") | 2026-11-11 | none |
| 2 | First-use dialog explains what is real / what is generated / what you can safely learn | demo | **true** | `src/components/firstlight/first-use.tsx` (localStorage-gated, `role=dialog`, Escape closable) | 2026-11-11 | none |
| 3 | Event names cannot be mistaken for historical records | demo | **true** | `src/lib/firstlight/events.ts` — "Synthetic Scenario A/B/C" nomenclature; banned-name test pins (no "Hurricane Odette"/"Cedar River Flood"/"Aegean Earthquake") | 2026-11-11 | none |
| 4 | Swipe compares basemap vs. basemap+generated overlays (NOT a two-date image comparison) | demo | **true** | `src/components/firstlight/map/map-view.tsx` — "BASEMAP — no scenario overlays" / "BASEMAP + GENERATED OVERLAYS" labels; both maps consume the same `baseStyle()`; PRE/POST-EVENT strings pinned absent | 2026-11-11 | Real two-date comparison requires authorized, date-specific raster acquisition — see owner action in §C |
| 5 | Sensor metadata is illustrative — nothing acquired | demo | **true** | every `ImagerySource` carries `simulated: true`, dates "n/a — not acquired"; Data panel renders "NOT ACQUIRED" badges; sitrep prints "ILLUSTRATIVE (not acquired)" | 2026-11-11 | none |
| 6 | Pipeline stages list only compute that actually runs (no STAC ingest / no ML inference theater) | demo | **true** | `src/lib/firstlight/generate.ts` — 4 honest stages; stage-text test bans "stac/rtc/speckle/unet/resnet/inference/otsu" | 2026-11-11 | none |
| 7 | Facility names are generic + synthetic; statuses are generator draws | demo | **true** | generator emits "Synthetic Hospital A1…" etc.; test pins `name.startsWith('Synthetic')` | 2026-11-11 | none |
| 8 | Synthetic "confidence" is presented as a generated scenario score, not a model probability | demo | **true** | UI copy ("Mean scenario score — generated values — NOT probabilities"); exports use `scenario_score`, never `confidence`; test pins both | 2026-11-11 | none |
| 9 | Review queue is ephemeral; no model trains on decisions | demo | **true (verified)** | demo review state is zustand in-memory (`src/store/firstlight.ts`), lost on reload; no training path exists anywhere; copy + tests state this explicitly. The old "active-learning loop / moat" claim was **removed** (was unverifiable) | 2026-11-11 | The pilot's persisted review decisions remain human workflow records only |
| 10 | Sitrep is a synthetic-exercise report: tabletop-only recommendations, no dispatch imperatives | demo | **true** | `src/lib/firstlight/sitrep.ts` — "Hypothetical Tabletop Discussion (NOT dispatch instructions)", "If this were a real event…"; tests ban imperative phrasings | 2026-11-11 | none |
| 11 | FNV-1a hashes are demo checksums, not signatures, and never verify truth | demo | **true** | sitrep checksum-honesty note + `hash_algorithm` field in `auditTrail`; tests pin "not digital signatures", ban "tamper-proof"/"authenticated evidence" | 2026-11-11 | none |
| 12 | Every export artifact is unmistakably synthetic | demo | **true** | all five GeoJSON builders + CSV + audit + offline bundle carry `simulated: true`, `scenario_id`, `seed`, `provider`, `warning`; CSV has `simulated,scenario_id` columns; pinned by `tests/exports.test.ts` | 2026-11-11 | none |
| 13 | Routes are toy-graph exercise paths, never safe routes; closures listed; field verification demanded | demo | **true** | `RouteResult.requiresFieldVerification`/`closuresCrossed`; access-panel copy "not dispatch instructions, not safe-route"; "all segments verified" string pinned **absent** | 2026-11-11 | none |
| 14 | Population is an illustrative synthetic grid, not WorldPop | demo | **true** | events.ts pop sensor "not WorldPop data"; data panel "NOT WorldPop"; sitrep "NOT WorldPop or any census product" | 2026-11-11 | none |
| 15 | Roads/facilities are procedurally generated, not OSM | demo | **true** | data panel "NOT an OSM network"; sitrep "NOT OpenStreetMap data"; basemap-only attribution line | 2026-11-11 | none |
| 16 | Keyboard/screen-reader support (divider slider, tab names, landmarks, reduced motion) | demo | **partial** | divider `role=slider` + arrow keys + aria-valuenow (pinned); sr-only tab labels on mobile; `:focus-visible` ring + `prefers-reduced-motion` in `globals.css`; Radix primitives underlying tabs/selects | 2026-11-11 | Full screen-reader + high-contrast-mode audit with real AT is not automated in CI; manual audit remains open |
| 17 | Map data has text/table equivalents | demo | **true** | Zones/Overview/Access panels present all key values as tables/text; map is not the sole source | 2026-11-11 | none |

## B. What the local pilot claims

| # | Claim | Mode | Status | Evidence | Unresolved owner action |
|---|---|---|---|---|---|
| 18 | Server API + persistence + RBAC + SHA-256 audit chain | pilot | **true** | `src/lib/server/*`, `prisma/`; `tests/integration.test.ts` (auth, RBAC, audit chain, two-person approval) | None known; run `bun test` to re-verify |
| 19 | Real open-data ingestion (USGS/NWS/Open-Meteo/Copernicus-STAC/OSM live; FIRMS blocked; WorldPop fixtures) | pilot | **true (catalog only)** | adapters under `src/lib/server/adapters/`, contract tests in `tests/adapters.test.ts`; statuses mirrored in `src/lib/firstlight/provider-status.json` | Asset **download + processing** for any provider remains unimplemented (worker `blocked_scaffold`) |
| 20 | Analysis layer in pilot is still labeled-synthetic | pilot | **true** | `PROVENANCE_SPEC.md`, layer provenance block, `⚠ SYNTHETIC ANALYSIS` badge in UI | Real raster pipeline is the next milestone |
| 21 | 59-check browser suite (login→ingest→review→sitrep→approve→export→bundle→audit) | pilot | **true (as of 2026-11-01 run)** | `scripts/browser-smoke.py`; last recorded result in `docs/verification-summary.json` | Re-run in this environment was **not** executed (needs the full operational build + seeded DB; sandbox time budget) — re-run before next release |
| 22 | Score manifest, uncertainty, sensitivity, missingness | both | **true** | `src/lib/firstlight/scoring.ts` + `tests/scoring.test.ts`; weights explicitly **uncalibrated heuristics** | Calibration against real outcomes: none exists (no validated output anywhere) |

## C. Explicitly NOT claimed / does not exist

| # | Non-claim | Status | Evidence |
|---|---|---|---|
| 23 | Processing of real satellite imagery anywhere in the project | **does not exist** | worker raster/ML tasks report `blocked_scaffold`; demo generator fetches nothing; honesty tests ban ingestion/inference stage names |
| 24 | Any ML detection model shipped or benchmarked | **does not exist** | `MODEL_CARD_TEMPLATE.md` empty template; no model code |
| 25 | Public operational deployment / emergency-agency affiliation | **does not exist** | README + `provider-status.json` `deployedServiceStatus` state it; CI deploys only static Pages |
| 26 | Real-time data in the public demo | **does not exist** | static export; demo provider is the only data source in demo mode (`DemoModeError` otherwise) |
| 27 | "Active learning" / "customer label moat" / "model improves from feedback" | **claim removed** | old copy deleted from review + data panels; honesty tests pin the phrases absent |

## D. Legacy-document status (claims audit outcome)

| Doc | Verdict | Action taken |
|---|---|---|
| `README.md` | was honest in substance; counts refreshed (186→210 tests), mode separation strengthened, provider table now generated | rewritten 2026-11-11 |
| `DELIVERY_SUMMARY.md` | **was inflated** ("world-class, production-ready transformation") | replaced with a short factual delivery note |
| `TRANSFORMATION_ROADMAP.md` | **was aspirational written as fact** ("already world-class", enterprise-grade targets) | header added: planning assumptions only, not implemented capabilities; title reframed |
| `docs/verification-summary.json` | machine-generated; stale after v2.3 | regenerate via `bun run verify:full` at release (owner action) |

## E. Baseline commands and results (this session, 2026-11-11)

```
bun install --frozen-lockfile   → 479 packages, OK (no fallback)
bun run lint                    → 0 errors (1 pre-existing warning: anonymous default export in map-layers)
bun run typecheck               → clean
bun test                        → 210 pass / 0 fail (59,255→65,118 expect calls) — includes 24 new truthfulness pins
bun run tests/make-golden.ts    → golden digests regenerated for renamed synthetic scenarios
```

Not run this session (blockers stated honestly): `python3 scripts/browser-smoke.py` (requires operational build + seeded DB + real network egress to USGS/NWS — time budget); full `bun run verify:full` (superset of the above plus clean-state build). Both are re-run gates, not new claims.
