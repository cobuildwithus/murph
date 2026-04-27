---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:serum-creatinine"
slug: "biomarkers/serum-creatinine"
title: "Serum Creatinine"
summary: "Kidney-function safety context for clinician-guided monitoring."
status: "draft"
quality: "usable"
aliases:
  - "creatinine"
categories:
  - "lipids"
  - "lab-metric"
measurementContexts:
  - "clinical_laboratory"
unit: "mg/dL"
interpretationFrame:
  principle: "Compare like-with-like lab measurements across baseline and follow-up windows."
  caveat: "Lab method, fasting status, illness, medication changes, diet, weight change, and timing can affect interpretation."
biomarker:
  shortName: "Serum Creatinine"
  displayName: "Serum creatinine"
  unit: "mg/dL"
  valuePrecision: 0
  direction:
    desired: "stable"
    label: "Interpret as a trend in context."
    nuance: "This biomarker is used for lab-measured protocol interpretation, not same-day feedback."
  trendDefaults:
    latestWindowDays: 1
    comparisonWindowDays: 90
    minimumPoints: 1
    aggregation: "mean"
  explainerCards:
    -
      title: "What it is"
      body: "Serum creatinine is a lab marker used to interpret cholesterol and safety experiments."
    -
      title: "How to measure it"
      body: "Use a clinical laboratory result and record fasting status, lab, method, and date."
  measurement:
    bestContext: "Clinical laboratory measurement with baseline and follow-up values interpreted together."
    howToMeasure:
      - "Use the same lab and fasting pattern when practical."
      - "Record medication, supplement, diet, weight, exercise, and illness changes."
    confounders:
      - "lab method"
      - "fasting status"
      - "medication changes"
      - "supplement changes"
      - "diet change"
      - "weight change"
      - "illness"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
communityOutcomeSummary:
  state: "coming_soon"
  minimumCohortSize: 20
  placeholder: "Community outcome summaries will appear once enough opted-in experiment runs are available."
---
Kidney-function safety context for clinician-guided monitoring.
