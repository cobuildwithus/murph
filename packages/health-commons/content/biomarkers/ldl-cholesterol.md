---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:ldl-cholesterol"
slug: "biomarkers/ldl-cholesterol"
title: "LDL Cholesterol"
summary: "Low-density lipoprotein cholesterol; watch endpoint because EPA/DHA lipid effects are mixed and DHA-heavy or high-dose contexts can raise LDL-C in some evidence."
status: "draft"
quality: "usable"
aliases:
  - "LDL-C"
  - "LDL cholesterol"
  - "low-density lipoprotein cholesterol"
categories:
  - "nutrition"
  - "supplementation"
  - "omega-3"
  - "lab-marker"
  - "lipids"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation"
  -
    type: "cites"
    target: "source_artifact:pmid-18774613"
  -
    type: "cites"
    target: "source_artifact:pmid-22113870"
  -
    type: "cites"
    target: "source_artifact:pmid-21975919"
  -
    type: "cites"
    target: "source_artifact:pmid-38317191"
  -
    type: "cites"
    target: "source_artifact:dailymed-lovaza-label-2026-04-25"
unit: "mg/dL"
measurementContexts:
  - "fasting_lipid_panel"
  - "same_lab_follow_up"
biomarker:
  shortName: "LDL-C"
  displayName: "LDL Cholesterol"
  unit: "mg/dL"
  valuePrecision: 0
  direction:
    desired: "lower_or_stable"
    label: "Lower or stable is generally preferable in lipid context."
    nuance: "Do not assume EPA/DHA improves LDL-C; interpret with the rest of the lipid panel and clinical context."
  trendDefaults:
    latestWindowDays: 84
    comparisonWindowDays: 84
    minimumPoints: 1
    aggregation: "mean"
  measurement:
    bestContext: "Use the same lab and same measurement context before and after the EPA/DHA intervention window."
    howToMeasure:
      - "Collect a baseline value before starting the supplement."
      - "Repeat after the planned 12-week intervention window using the same lab/method when possible."
    confounders:
      - "diet changes"
      - "seafood intake changes"
      - "new medications or supplements"
      - "illness or inflammation"
      - "weight change"
      - "alcohol change"
communityOutcomeSummary:
  state: "coming_soon"
  placeholder: "Community outcome summaries will require enough completed experiments using the same lab context."
claims:

  -
    claimId: "ldl-watch-endpoint"
    type: "mixed_evidence"
    text: "LDL-C should be monitored rather than treated as a guaranteed-improvement endpoint for oral EPA/DHA supplementation."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-18774613"
      - "source_artifact:pmid-22113870"
      - "source_artifact:pmid-21975919"
      - "source_artifact:pmid-38317191"
---

## Role in this protocol

LDL Cholesterol is used as a secondary endpoint for `protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation`.

## Interpretation

Use this biomarker as protocol context, not as a standalone diagnosis. Before/after comparisons are most useful when the same lab, method, diet context, medication context, and intervention window are preserved.
