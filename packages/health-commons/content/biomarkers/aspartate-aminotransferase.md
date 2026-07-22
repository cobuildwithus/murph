---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:aspartate-aminotransferase"
slug: "biomarkers/aspartate-aminotransferase"
title: "AST"
summary: "AST measures aspartate aminotransferase activity from liver, muscle, and other tissues, which can add tissue-injury context when interpreted with related markers and circumstances."
status: "draft"
quality: "usable"
aliases:
  - "AST"
  - "aspartate transaminase"
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
  shortName: "AST"
  displayName: "Aspartate aminotransferase"
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
      body: "Aspartate aminotransferase is a lab marker used to interpret cholesterol and safety experiments."
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
      guidance: "Use the reporting laboratory’s reference interval for AST; Commons does not replace the source range because reference limits depend on assay, specimen, and reference population."
      applicability: "Applies with the reporting assay, age, sex, symptoms, medications, alcohol, exercise, and related liver or blood-count results considered."
      source:
        title: "ACG Clinical Guideline: Evaluation of Abnormal Liver Chemistries"
        organization: "American College of Gastroenterology; American Journal of Gastroenterology"
        year: 2017
        sourceType: "clinical_guideline"
        url: "https://pubmed.ncbi.nlm.nih.gov/27995906/"
        doi: "10.1038/ajg.2016.517"
        pmid: "27995906"
---

Safety lab for liver-enzyme monitoring when clinician guidance indicates it.
