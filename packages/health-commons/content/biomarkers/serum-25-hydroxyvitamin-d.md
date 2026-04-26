---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:serum-25-hydroxyvitamin-d
slug: biomarkers/serum-25-hydroxyvitamin-d
title: Serum 25-Hydroxyvitamin D
summary: The primary lab marker for vitamin D status and the clearest measurable endpoint for daily vitamin D3 supplementation experiments, with thresholds and assay interpretation requiring context.
status: draft
quality: usable
aliases:
  - 25(OH)D
  - 25-hydroxyvitamin D
  - serum 25OHD
  - plasma 25-hydroxyvitamin D
  - vitamin D status
categories:
  - nutrition
  - clinical-lab
  - vitamin-d
  - supplements
relations:
  -
    type: related_protocol
    target: protocol_variant:vitamin-d-supplementation/daily-vitamin-d3-supplementation
  -
    type: cites
    target: source_artifact:pmid-38828931
  -
    type: cites
    target: source_artifact:pmid-37764770
  -
    type: cites
    target: source_artifact:pmid-12499343
measurementContexts:
  - fasted_or_routine_clinical_lab
  - baseline_and_8_to_12_week_retest
unit: nmol/L or ng/mL
interpretationFrame:
  principle: Compare the same assay/unit when possible, and interpret the change alongside baseline level, dose, adherence, season, sun exposure, BMI/body size, diet, and supplement stacking.
  caveat: A rise in 25(OH)D indicates changed vitamin D status, not guaranteed improvement in fractures, symptoms, mood, infections, or other clinical outcomes.
biomarker:
  shortName: 25(OH)D
  displayName: Serum 25-Hydroxyvitamin D
  unit: nmol/L or ng/mL
  valuePrecision: 1
  direction:
    desired: mixed_or_contextual
    label: Contextual range, not simply higher.
    nuance: Very low values can support repletion decisions, but higher is not automatically better and safety concerns rise with excessive intake or calcium abnormalities.
  trendDefaults:
    latestWindowDays: 90
    comparisonWindowDays: 90
    minimumPoints: 2
    aggregation: mean
  measurement:
    bestContext: Baseline lab before starting or changing dose, then a follow-up lab after roughly 8–12 weeks of stable daily dosing.
    howToMeasure:
      - Use the same lab and unit where possible.
      - Record whether the result is ng/mL or nmol/L; do not compare units without conversion.
      - Retest after a stable dosing window rather than after a few days.
      - Log dose, missed doses, other supplements, sun/UV exposure, travel, season, and major diet changes.
    confounders:
      - assay/unit differences
      - season and latitude
      - sun or UVB exposure
      - diet and fortified foods
      - BMI/body size
      - adherence
      - supplement stacking
      - kidney disease or calcium disorders
---

Serum 25-hydroxyvitamin D is the main outcome for Daily Vitamin D3 Supplementation because direct daily-D3 trials repeatedly measure a change in this biomarker over weeks to months (`source_artifact:pmid-12499343`, `source_artifact:pmid-19064513`, `source_artifact:pmid-26037521`, `source_artifact:pmid-32365732`, `source_artifact:pmid-37764770`).

Use it as a **status and response marker**, not as proof that symptoms or disease risks changed. Thresholds and target ranges differ across sources, and assay/unit differences can make comparisons noisy (`source_artifact:pmid-38828931`).
