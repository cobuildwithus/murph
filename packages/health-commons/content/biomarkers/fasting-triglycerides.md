---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:fasting-triglycerides"
slug: "biomarkers/fasting-triglycerides"
title: "Fasting Triglycerides"
summary: "Fasting blood triglycerides; useful lipid-context endpoint for EPA/DHA supplementation, especially when baseline triglycerides are elevated, but clinician care is needed for persistent or very high values."
status: "draft"
quality: "usable"
aliases:
  - "triglycerides"
  - "fasting TG"
  - "serum triglycerides"
  - "TG"
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
    target: "source_artifact:pmid-18774613"
  -
    type: "cites"
    target: "source_artifact:pmid-38317191"
  -
    type: "cites"
    target: "source_artifact:pmid-22113870"
  -
    type: "cites"
    target: "source_artifact:pmid-22962670"
unit: "mg/dL"
measurementContexts:
  - "fasting_lipid_panel"
  - "same_lab_follow_up"
biomarker:
  shortName: "TG"
  displayName: "Fasting Triglycerides"
  unit: "mg/dL"
  valuePrecision: 0
  direction:
    desired: "lower_or_stable"
    label: "Lower is generally favorable in lipid context, but abnormal values need clinical interpretation."
    nuance: "Use fasting before/after panels and track diet, alcohol, weight, illness, and medication changes."
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
protocolRanking:
  version: "omega-3-supplementation-v1"
  scoreFormula: "Higher evidenceWeight and biomarkerRelevance favor lab endpoints that directly reflect oral EPA/DHA exposure or lipid context; safety caution and measurement burden lower suitability for unsupervised runs."
  candidates:

    -
      protocolKey: "protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation"
      expectedDirection: "down"
      relationship: "secondary_biomarker"
      mechanism: "Oral EPA/DHA can change this lab marker or its lipid-context interpretation when product, dose, duration, adherence, and baseline context are tracked."
      scoring:
        evidenceWeight: 5
        biomarkerRelevance: 4
        wearableMeasurability: 0
        burdenPenalty: 3
        safetyCautionPenalty: 2
      display:
        confidence: "high"
        burdenLabel: "Requires lab test"
        cautionLabel: "Interpret with safety and clinical context"
communityOutcomeSummary:
  state: "coming_soon"
  placeholder: "Community outcome summaries will require enough completed Murph experiments using the same lab context."
claims:

  -
    claimId: "triglycerides-epa-dha-lipid-signal"
    type: "intervention_result"
    text: "Fasting triglycerides are the most consistent lipid-panel signal for oral EPA/DHA-style supplementation."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-37264945"
      - "source_artifact:pmid-18774613"
      - "source_artifact:pmid-38317191"
      - "source_artifact:pmid-22113870"
  -
    claimId: "very-high-triglycerides-clinical-boundary"
    type: "safety"
    text: "Persistent or very high triglycerides are a clinician-managed lipid condition, not a self-experiment target."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-22962670"
      - "source_artifact:pmid-34332805"
      - "source_artifact:nice-ng238-omega-3-fatty-acid-compounds-2023-12-14"
---

## Role in this protocol

Fasting Triglycerides is used as a secondary endpoint for `protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation`.

## Interpretation

Use this biomarker as protocol context, not as a standalone diagnosis. Before/after comparisons are most useful when the same lab, method, diet context, medication context, and intervention window are preserved.
