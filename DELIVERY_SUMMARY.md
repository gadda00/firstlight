# Delivery summary — factual notes

> This file previously contained inflated self-assessment ("world-class, production-ready transformation"). That language is **removed** — see `docs/EVIDENCE_LEDGER.md` for the claim-by-claim audit and `docs/CAPABILITY_MATRIX.md` for what actually runs where. This repository delivers a **simulated-exercise public demo** and a **locally-runnable pilot with a real-data catalog and labeled-synthetic analysis**; it does not process imagery, ship models, or operate any deployment.

## What exists and is verified (2026-11-11)

- Public static demo (GitHub Pages) — simulated exercise, honesty-contract tests (`tests/honesty.test.ts`).
- Local pilot: server API, persistence, RBAC, SHA-256 audit chain, live open-data catalog adapters, grounded sitreps with two-person approval, provenance-stamped exports.
- Verification gates: lint / typecheck / 210 tests / both builds, enforced in CI with a frozen lockfile.

## What does not exist (stated plainly)

- Imagery asset download, raster processing, any ML model, any validated output, any operational deployment.

## Recent change (v2.3)

Truthfulness overhaul of the public demo per the design review: synthetic nomenclature, honest basemap/overlay labels, honest pipeline stages, scenario-score renaming, tabletop sitrep language, machine-readable synthetic flags on every artifact, provider registry as single machine-readable source, first-use intro + Guide tab, accessibility pass. See the git history for the full diff.
