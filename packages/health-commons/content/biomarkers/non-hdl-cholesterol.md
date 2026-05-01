---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:non-hdl-cholesterol"
slug: "biomarkers/non-hdl-cholesterol"
title: "Non-HDL Cholesterol"
summary: "Total cholesterol minus HDL-C; secondary lipid-context endpoint for EPA/DHA experiments when a fasting lipid panel is used."
status: "draft"
quality: "usable"
aliases:
  - "non-HDL-C"
  - "non-HDL cholesterol"
  - "atherogenic cholesterol"
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
    target: "source_artifact:pmid-37264945"
  -
    type: "cites"
    target: "source_artifact:pmid-26073395"
  -
    type: "cites"
    target: "source_artifact:pmid-26073397"
  -
    type: "cites"
    target: "source_artifact:pmid-36313109"
unit: "mg/dL"
measurementContexts:
  - "fasting_lipid_panel"
  - "same_lab_follow_up"
biomarker:
  shortName: "Non-HDL-C"
  displayName: "Non-HDL Cholesterol"
  unit: "mg/dL"
  valuePrecision: 0
  direction:
    desired: "lower_or_stable"
    label: "Lower or stable is generally preferable in lipid context."
    nuance: "Interpret alongside triglycerides, LDL-C, ApoB if available, medications, diet, and clinician guidance."
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
  placeholder: "Community outcome summaries will require enough completed Murph experiments using the same lab context."
claims:

  -
    claimId: "nonhdl-context-endpoint"
    type: "mixed_evidence"
    text: "Non-HDL-C can provide useful lipid-panel context, but it is not the primary success endpoint for the oral EPA/DHA starter protocol."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-37264945"
      - "source_artifact:pmid-26073395"
      - "source_artifact:pmid-26073397"
      - "source_artifact:pmid-36313109"
---

## Role in this protocol

Non-HDL Cholesterol is used as a secondary endpoint for `protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation`.

## Interpretation

Use this biomarker as protocol context, not as a standalone diagnosis. Before/after comparisons are most useful when the same lab, method, diet context, medication context, and intervention window are preserved.
