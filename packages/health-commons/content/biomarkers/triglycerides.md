---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:triglycerides"
slug: "biomarkers/triglycerides"
title: "Triglycerides"
summary: "Blood triglycerides from a lipid panel; a context-sensitive watch metric for cholesterol protocols."
status: "draft"
quality: "usable"
aliases:
  - "triacylglycerols"
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
  shortName: "TG"
  displayName: "Triglycerides"
  unit: "mg/dL"
  valuePrecision: 0
  direction:
    desired: "lower_or_stable"
    label: "Lower or stable is often preferred when elevated, but interpretation is contextual."
    nuance: "Triglycerides are affected by fasting status, recent diet, alcohol, weight change, diabetes control, illness, and medications."
  trendDefaults:
    latestWindowDays: 1
    comparisonWindowDays: 84
    minimumPoints: 1
    aggregation: "mean"
  explainerCards:
    -
      title: "What it is"
      body: "Blood triglycerides from a lipid panel; a context-sensitive watch metric for cholesterol protocols."
    -
      title: "How Murph uses it"
      body: "Murph compares a pre-intervention lipid panel with a repeat panel after the protocol-specific intervention window."
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
  placeholder: "Opted-in Murph lipid experiment summaries will appear once enough comparable runs are available."
---
Triglycerides is used here as a lab-measured lipid marker. These cholesterol protocols treat LDL-C as the primary endpoint and use other lipid markers as supportive or contextual measures.
