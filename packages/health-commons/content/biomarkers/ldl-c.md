---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:ldl-c"
slug: "biomarkers/ldl-c"
title: "LDL-C"
summary: "LDL-C measures cholesterol carried within low-density lipoproteins, which matters because treatment goals depend on overall cardiovascular risk rather than one universal cutoff."
status: "draft"
quality: "usable"
aliases:
  - "bad cholesterol"
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
  shortName: "LDL-C"
  displayName: "LDL Cholesterol"
  unit: "mg/dL"
  valuePrecision: 0
  direction:
    desired: "lower"
    label: "Lower is generally the target when LDL-C is elevated."
    nuance: "Interpret with overall cardiovascular-risk context, lipid medication changes, diet, weight change, fasting status, and clinician guidance."
  trendDefaults:
    latestWindowDays: 1
    comparisonWindowDays: 84
    minimumPoints: 1
    aggregation: "mean"
  explainerCards:

    -
      title: "What it is"
      body: "Low-density lipoprotein cholesterol from a blood lipid panel; the primary lab endpoint for cholesterol protocols."
    -
      title: "How it works"
      body: "A pre-intervention lipid panel is compared with a repeat panel after the protocol-specific intervention window."
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
      guidance: "The 2026 dyslipidemia guideline uses LDL-C goals below 100 mg/dL for borderline or intermediate primary-prevention risk, below 70 mg/dL for high risk, and below 55 mg/dL for very-high-risk secondary prevention."
      applicability: "These are risk- and treatment-specific goals, not a universal laboratory reference interval; the member’s clinical risk category and treatment plan determine which goal is relevant."
      numericValues:
        - label: "Borderline or intermediate primary-prevention goal"
          unit: "mg/dL"
          upperBound:
            value: 100
            inclusive: false
        - label: "High-risk goal"
          unit: "mg/dL"
          upperBound:
            value: 70
            inclusive: false
        - label: "Very-high-risk secondary-prevention goal"
          unit: "mg/dL"
          upperBound:
            value: 55
            inclusive: false
      source:
        title: "2026 ACC/AHA/Multisociety Guideline on the Management of Dyslipidemia"
        organization: "American College of Cardiology, American Heart Association, and collaborating societies; Circulation"
        year: 2026
        sourceType: "clinical_guideline"
        url: "https://www.ahajournals.org/doi/10.1161/CIR.0000000000001423"
        doi: "10.1161/CIR.0000000000001423"
---

LDL-C is used here as a lab-measured lipid marker. These cholesterol protocols treat LDL-C as the primary endpoint and use other lipid markers as supportive or contextual measures.
