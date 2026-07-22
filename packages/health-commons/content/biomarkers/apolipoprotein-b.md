---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:apolipoprotein-b"
slug: "biomarkers/apolipoprotein-b"
title: "Apolipoprotein B"
summary: "ApoB measures the concentration of apolipoprotein B carried one per atherogenic particle, which can add particle-number context when standard cholesterol measures are discordant."
status: "field-testing"
hidden: true
quality: "usable"
aliases:
  - "ApoB"
  - "apolipoprotein B"
  - "apo B"
categories:
  - "lipids"
  - "cardiovascular"
  - "lab-metric"
measurementContexts:
  - "standard_lipid_panel"
  - "fasting_or_nonfasting_lab_draw"
unit: "mg/dL"
interpretationFrame:
  principle: "Use the same lab context and compare baseline versus follow-up windows rather than one isolated value."
  caveat: "Diet, weight change, lipid medications, illness, alcohol, fasting status, and laboratory method can all affect interpretation."
biomarker:
  shortName: "ApoB"
  displayName: "Apolipoprotein B"
  unit: "mg/dL"
  valuePrecision: 0
  direction:
    desired: "lower"
    label: "Lower is generally the target when ApoB is elevated."
    nuance: "ApoB is not always included in a standard lipid panel; use it as an optional secondary outcome when available."
  trendDefaults:
    latestWindowDays: 1
    comparisonWindowDays: 84
    minimumPoints: 1
    aggregation: "mean"
  explainerCards:

    -
      title: "Why people care"
      body: "Each atherogenic lipoprotein particle carries one ApoB molecule, so ApoB can add particle-number context when it and LDL-C do not tell the same story."
    -
      title: "How to measure it"
      body: "ApoB is measured in blood; any decision limit or treatment goal depends on the person’s cardiovascular-risk setting, treatment status, assay, and the guidance being applied."
    -
      title: "What moves it"
      body: "Diet, body composition, metabolic health, thyroid function, illness, and lipid-lowering medications can change ApoB, so comparisons should preserve that context."
  measurement:
    bestContext: "A blood lipid panel drawn before the intervention and repeated after the planned intervention window, ideally with similar lab and fasting conditions."
    howToMeasure:
      - "Record the lab date, fasting or non-fasting status, lipid medication status, and any major diet or weight changes."
      - "Compare the baseline result with the follow-up result after the intervention window rather than overinterpreting a single lab value."
    confounders:
      - "lipid medication changes"
      - "dietary saturated fat changes"
      - "weight loss or gain"
      - "fasting status"
      - "recent alcohol intake"
      - "illness"
      - "laboratory method changes"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:psyllium-husk/psyllium-husk-for-cholesterol"
  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
communityOutcomeSummary:
  state: "coming_soon"
  minimumCohortSize: 20
  placeholder: "Opted-in lipid experiment summaries will appear once enough comparable runs are available."
referenceGuidance:
  classification: conditional_numeric
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: decision_limit
      guidance: "The 2026 dyslipidemia guideline lists persistent ApoB at or above 120 mg/dL among selected cardiovascular risk-enhancing lipid findings, while treatment goals depend on overall risk and clinical context."
      applicability: "Use only in the cardiovascular risk context described by guideline-based assessment; assay, lipid treatment, diabetes, triglycerides, kidney disease, and discordance with LDL-C matter."
      numericValues:
        - label: "Risk-enhancing factor"
          unit: "mg/dL"
          lowerBound:
            value: 120
            inclusive: true
      source:
        title: "2026 ACC/AHA/Multisociety Guideline on the Management of Dyslipidemia"
        organization: "American College of Cardiology, American Heart Association, and collaborating societies; Circulation"
        year: 2026
        sourceType: "clinical_guideline"
        url: "https://www.ahajournals.org/doi/10.1161/CIR.0000000000001423"
        doi: "10.1161/CIR.0000000000001423"
---

Apolipoprotein B is used here as a lab-measured lipid marker. These cholesterol protocols treat LDL-C as the primary endpoint and use other lipid markers as supportive or contextual measures.
