# SCORING_METHOD.md — FirstLight need-score v2

## 1. Formula (versioned: `need-score-v2`)

```
need(z) = [ w1·D(z) + w2·Pexp(z) + w3·Iso(z) + w4·Crit(z) ] / Σw  ×  (1 − missingPenalty · missingness(z))

D(z)    = (1.0·n_destroyed + 0.6·n_major + 0.2·n_minor) / n_total
Pexp(z) = zone_population / divisor(normalization)
Iso(z)  = 1 if travel-time delta to nearest hospital > 30 min, or newly unreachable
Crit(z) = impacted critical facilities / divisor(normalization)
```

Every weight, threshold, coefficient, and policy below is a machine-readable `ScoreManifest` (`src/lib/firstlight/scoring.ts`) that is embedded in exports and sitrep claims (`score_manifest` tool) and can be overridden per organization via versioned, admin-published `ScoreConfig` rows.

## 2. Defaults (documented, not fitted)

| Parameter | Value | Note |
|---|---|---|
| weights | damage .35 / population .25 / isolation .25 / critical .15 | retained from the blueprint; tunable live in demo UI, versioned server-side in operational mode |
| normalization | `max` (legacy) or `p90robust` | `max` is dominated by outliers — one dense zone caps everyone else; `p90robust` divides by the 90th percentile and clamps to [0,1] |
| exposure coefficients | damage ×1.5, flood ×0.75 | **UNCALIBRATED pilot heuristic** — see §5 |
| missingPenalty | 0.25 | sparse data lowers score AND raises the insufficient-evidence flag |
| tier thresholds | warning ≥ 0.58, watch ≥ 0.38 | |
| insufficient evidence | dataQuality < 0.5 | zone reported as `insufficient_evidence`, NOT forced into a tier |
| population uncertainty | ±15% | gridded population estimate assumption |

## 3. What changed vs. v1 (and why)

| v1 behavior | v2 behavior | Rationale |
|---|---|---|
| `floodShare` sampled boundary points + centroid | `floodShareArea` = true polygon∩hexagon **area ratio** (Sutherland–Hodgman clipping in a local km frame) | point sampling is biased; area-weighted intersection is the defensible metric. The legacy field remains for compat |
| global-max normalization only | + `p90robust` option, versioned | outlier resistance |
| point need value | `needLower`/`needUpper` bounds via confidence propagation | detection confidence and population uncertainty must be visible |
| no sensitivity | ±25% one-at-a-time weight perturbation → max rank shift per zone; `rankingUnstable` when shift ≥ 2 | fragile orderings must be flagged, not hidden |
| every zone got a tier | zones below dataQuality 0.5 → `insufficient_evidence` | "not enough evidence" must be an outcome; sparse mapping must not look like low impact |
| heuristic exposure, unlabeled | labeled `exposureMethod` stamped on every zone + claim | see §5 |
| H3 cells from AOI ring only | union of AOI cells + any cell holding data | edge-cell population was silently dropped (found by Phase 0 tests) |

## 4. dataQuality & missingness (documented formula)

```
dataQuality = 0.5 · detectionConfidence'  +  0.3 · populationAvailability'  +  0.2 · routability'
  detectionConfidence' = mean building-detection confidence in zone (0.4 if no buildings)
  populationAvailability' = 1.0 if zone population > 0, else 0.3
  routability' = 1.0 if post-event reachable, else 0.5
missingness = 1 − dataQuality
```

## 5. Exposure honesty (the labeled heuristic)

`affectedPop = round(population · clamp(1.5·D + 0.75·floodComponent))` where floodComponent is the area-weighted share in v2. This is an **uncalibrated pilot heuristic**: the coefficients are visible defaults, not fitted values. It is stamped `heuristic-weighted-overlay-v2-area` on every zone, export, and sitrep claim, with the quality note "UNCALIBRATED pilot heuristic". Replacing it with a dasymetric raster workflow (WorldPop ∩ hazard footprints, method recorded, ranges shown) is the deferred Phase 3 raster task — until then no affected-population figure is presented as a measurement.

## 6. Routing honesty

Routes are computed on the post-event passable graph; every blocked road carries a `RoadClosure` observation (`observedAt`, `source`, `confidence`, `kind ∈ {hard, probable, reduced_speed, unverified}`). Route results itemize `closuresCrossed`, set `requiresFieldVerification` when probable/unverified closures are traversed, and stamp the `graphVersion`. An unverified route is never presented as safe and never used to auto-dispatch.

## 7. Verification

Unit + golden tests (`tests/scoring.test.ts`, `tests/clip.test.ts`, `tests/decision.test.ts`) cover: manifest pinning; percentile math; normalization divergence; bound containment and widening with lower confidence; insufficient-evidence flagging; missingness penalty ordering; OAT sensitivity coverage; area-weighted vs. point-sampled divergence; known-answer clip areas (identical squares, half-offset squares, containment, disjoint, L-shaped subjects); tier boundaries.
