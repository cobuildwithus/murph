---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:omega-3-index"
slug: "biomarkers/omega-3-index"
title: "Omega-3 Index"
summary: "Percentage of EPA+DHA in red-blood-cell fatty acids; best used here as an exposure/status endpoint for oral EPA/DHA rather than a direct clinical-benefit guarantee."
status: "draft"
quality: "usable"
aliases:
  - "omega-3 index"
  - "RBC EPA+DHA"
  - "erythrocyte EPA+DHA"
  - "omega-3 status"
  - "O3I"
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
    target: "source_artifact:pmid-31396625"
  -
    type: "cites"
    target: "source_artifact:pmid-36742439"
  -
    type: "cites"
    target: "source_artifact:pmid-19733159"
  -
    type: "cites"
    target: "source_artifact:pmid-24079284"
  -
    type: "cites"
    target: "source_artifact:pmid-17053155"
unit: "%"
measurementContexts:
  - "venipuncture_rbc"
  - "dried_blood_spot_rbc_equivalent"
  - "same_lab_follow_up"
biomarker:
  shortName: "O3I"
  displayName: "Omega-3 Index"
  unit: "%"
  valuePrecision: 1
  direction:
    desired: "mixed_or_contextual"
    label: "Higher exposure/status can be expected with supplementation, but higher is not automatically better for every person."
    nuance: "Use as a before/after exposure marker, not a standalone diagnosis or clinical-outcome score."
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
      expectedDirection: "up"
      relationship: "primary_biomarker"
      mechanism: "Oral EPA/DHA can change this lab marker or its lipid-context interpretation when product, dose, duration, adherence, and baseline context are tracked."
      scoring:
        evidenceWeight: 5
        biomarkerRelevance: 5
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
    claimId: "omega3-index-exposure-endpoint"
    type: "intervention_result"
    text: "Omega-3 index/RBC EPA+DHA is the preferred lab-enabled exposure/status endpoint for the Murph oral EPA/DHA protocol."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-31396625"
      - "source_artifact:pmid-36742439"
      - "source_artifact:pmid-24252845"
      - "source_artifact:pmid-32276315"
  -
    claimId: "omega3-index-method-consistency"
    type: "design_guardrail"
    text: "Before/after interpretation should use the same sample matrix and lab method after a multi-week intervention window."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-36742439"
      - "source_artifact:pmid-19733159"
      - "source_artifact:pmid-24079284"
      - "source_artifact:pmid-17053155"
---

## Role in this protocol

Omega-3 Index is used as a primary endpoint for `protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation`.

## Interpretation

Use this biomarker as protocol context, not as a standalone diagnosis. Before/after comparisons are most useful when the same lab, method, diet context, medication context, and intervention window are preserved.
