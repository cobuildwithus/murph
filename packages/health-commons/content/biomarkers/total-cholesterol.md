---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:total-cholesterol"
slug: "biomarkers/total-cholesterol"
title: "Total Cholesterol"
summary: "Total cholesterol measures cholesterol carried across the major lipoprotein classes, which can provide broad lipid context but does not distinguish particle type or overall risk by itself."
status: "draft"
quality: "usable"
aliases:
  - "TC"
  - "serum total cholesterol"
  - "cholesterol"
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
  shortName: "TC"
  displayName: "Total Cholesterol"
  unit: "mg/dL"
  valuePrecision: 0
  direction:
    desired: "lower_or_stable"
    label: "Lower can be useful when elevated, but interpretation is contextual."
    nuance: "Total cholesterol combines multiple lipoprotein fractions, so LDL-C, non-HDL-C, apoB, HDL-C, and triglycerides add important context."
  trendDefaults:
    latestWindowDays: 1
    comparisonWindowDays: 84
    minimumPoints: 1
    aggregation: "mean"
  explainerCards:

    -
      title: "What it is"
      body: "Total cholesterol from a blood lipid panel; a supportive endpoint for cholesterol protocols, not the most specific marker."
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
  classification: no_universal_range
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: evidence_limit
      guidance: "No universal numeric range is encoded for Total cholesterol; use the named method, population, and source interpretation rather than a wellness “optimal” range."
      applicability: "Applies to the named lipid analyte and method with fasting status, treatment, overall cardiovascular risk, and the source laboratory report retained."
      source:
        title: "2026 ACC/AHA/Multisociety Guideline on the Management of Dyslipidemia"
        organization: "American College of Cardiology, American Heart Association, and collaborating societies; Circulation"
        year: 2026
        sourceType: "clinical_guideline"
        url: "https://www.ahajournals.org/doi/10.1161/CIR.0000000000001423"
        doi: "10.1161/CIR.0000000000001423"
---

Total Cholesterol is used here as a lab-measured lipid marker. These cholesterol protocols treat LDL-C as the primary endpoint and use other lipid markers as supportive or contextual measures.
