# MODEL_CARD_TEMPLATE.md — required disclosure for any FirstLight detection model

No detection model ships with this repository. The procedural generator is a **labeled synthetic-data provider** (demo only) and its outputs are never reported as model predictions. Before ANY inference model enters the platform, this card must be completed, reviewed, and versioned alongside the model registry entry. A model without a completed, approved card must not run in operational mode.

---

## 1. Identification

- Model name / registry id:
- Version (immutable):
- Code commit:
- Environment lock (deps hash):
- Weights checksum (SHA-256):
- Owner / reviewer:

## 2. Intended use & prohibitions

- Task (e.g., building-damage classification from pre/post imagery; SAR water segmentation):
- Input modalities & expected preprocessing:
- **Prohibited uses** (acknowledge explicitly): targeting; individual surveillance; autonomous dispatch decisions; presenting scores as ground truth; inferring flood depth from binary water masks without a validated hydraulic model.
- Operational routing: which outputs go to human review (low confidence, OOD, cloud/occlusion, SAR ambiguity, model disagreement)?

## 3. Training data manifest

- Sources & licenses (verified date, reviewer):
- Geography & time coverage:
- Label schema & annotation protocol:
- Split strategy — **geographic AND temporal separation** between train/val/test (describe leakage checks performed):
- Class balance & known label noise:

## 4. Evaluation

- Metrics: class-wise precision/recall, IoU/F1, calibration curve (ECE), abstention rate; per-geography and per-season breakdowns, not just global averages.
- Test regions/dates (disjoint from training):
- Failure modes characterized (with examples): urban double-bounce, wind-roughened water, rubble/shadow occlusion, domain shift.
- **Calibrated probability**: method + post-calibration reliability.
- **Uncertainty**: method (e.g., ensembles, conformal), coverage guarantees, how bounds propagate into need-score bounds.

## 5. Operational constraints

- Compute profile, batch size, cost per 100 km²:
- Input compatibility checks (resolution, bands, CRS) enforced before inference:
- Resumability of batch jobs; output validation schema:

## 6. Drift monitoring plan

- Monitored dimensions: geography, sensor, season, cloud cover, resolution, class distribution, review outcomes (accept/reject rates by region).
- Alert thresholds & review-routing triggers:
- Retraining policy & re-registration procedure:

## 7. Honest limitations statement

Explicit list of what this model cannot do and where its outputs must NOT be trusted. This section is mandatory and cannot be empty. Synthetic-label "accuracy" figures (e.g. anything derived from demo `truthCorrect` flags) are **forbidden** in this card.
