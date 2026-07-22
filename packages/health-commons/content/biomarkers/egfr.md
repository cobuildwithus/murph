---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:egfr"
slug: "biomarkers/egfr"
title: "eGFR"
summary: "eGFR estimates kidney filtration normalized to body surface area, which can support kidney-function assessment when equation, age, chronicity, and urine findings are considered."
status: "draft"
quality: "usable"
aliases:
  - "estimated GFR"
  - "eGFR"
categories:
  - "lipids"
  - "lab-metric"
measurementContexts:
  - "clinical_laboratory"
unit: "mL/min/1.73m²"
interpretationFrame:
  principle: "Compare like-with-like lab measurements across baseline and follow-up windows."
  caveat: "Lab method, fasting status, illness, medication changes, diet, weight change, and timing can affect interpretation."
biomarker:
  shortName: "eGFR"
  displayName: "Estimated glomerular filtration rate"
  unit: "mL/min/1.73m²"
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
      body: "Estimated glomerular filtration rate is a lab marker used to interpret cholesterol and safety experiments."
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
referenceGuidance:
  classification: conditional_numeric
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: decision_limit
      guidance: "KDIGO uses eGFR below 60 mL/min/1.73 m² as one chronic-kidney-disease criterion only when present for at least three months or accompanied by other markers of kidney damage."
      applicability: "Applies to an adult eGFR from a validated named equation; acute kidney changes, extremes of muscle mass or diet, pregnancy, medications, and absent chronicity limit interpretation."
      numericValues:
        - label: "CKD filtration criterion when chronic or accompanied by kidney-damage markers"
          unit: "mL/min/1.73 m²"
          upperBound:
            value: 60
            inclusive: false
      source:
        title: "KDIGO 2024 Clinical Practice Guideline for the Evaluation and Management of Chronic Kidney Disease"
        organization: "Kidney Disease: Improving Global Outcomes; Kidney International"
        year: 2024
        sourceType: "clinical_guideline"
        url: "https://kdigo.org/guidelines/ckd-evaluation-and-management/"
---

Kidney-function safety context for clinician-guided monitoring.
