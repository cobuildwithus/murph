---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:creatine-kinase"
slug: "biomarkers/creatine-kinase"
title: "Creatine Kinase"
summary: "Creatine kinase measures enzyme activity released mainly from muscle, which can add muscle-injury and exertion context but varies with exercise, muscle mass, sex, ancestry, medications, and assay."
status: "draft"
quality: "usable"
aliases:
  - "CK"
  - "CPK"
  - "creatine phosphokinase"
categories:
  - "lipids"
  - "lab-metric"
measurementContexts:
  - "clinical_laboratory"
unit: "U/L"
interpretationFrame:
  principle: "Compare like-with-like lab measurements across baseline and follow-up windows."
  caveat: "Lab method, fasting status, illness, medication changes, diet, weight change, and timing can affect interpretation."
biomarker:
  shortName: "Creatine Kinase"
  displayName: "Creatine kinase"
  unit: "U/L"
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
      body: "Creatine kinase is a lab marker used to interpret cholesterol and safety experiments."
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
  classification: source_range_only
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: reference_interval
      guidance: "Use the reporting laboratory’s reference interval for Creatine Kinase; Commons does not replace the source range because reference limits depend on assay, specimen, and reference population."
      applicability: "Applies with assay, exercise, muscle mass, symptoms, medications, hemolysis, and timing recorded; the reporting laboratory’s interval remains authoritative."
      source:
        title: "Defining, Establishing, and Verifying Reference Intervals in the Clinical Laboratory (EP28-A3c)"
        organization: "Clinical and Laboratory Standards Institute and IFCC"
        year: 2020
        sourceType: "consensus_statement"
        url: "https://clsi.org/shop/standards/ep28/"
---

Safety lab used when muscle symptoms or clinician guidance indicate monitoring.
