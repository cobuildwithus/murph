---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:hdl-c"
slug: "biomarkers/hdl-c"
title: "HDL-C"
summary: "HDL-C measures cholesterol carried within high-density lipoproteins, which adds lipid context but is not a stand-alone treatment target or direct measure of HDL function."
status: "draft"
quality: "usable"
aliases:
  - "HDL cholesterol"
  - "HDL-C"
  - "high-density lipoprotein cholesterol"
  - "good cholesterol"
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
  shortName: "HDL-C"
  displayName: "HDL Cholesterol"
  unit: "mg/dL"
  valuePrecision: 0
  direction:
    desired: "mixed_or_contextual"
    label: "Interpret in context rather than chasing a single direction."
    nuance: "Cholesterol protocol evidence is usually stronger for LDL-C and total cholesterol than for HDL-C changes."
  trendDefaults:
    latestWindowDays: 1
    comparisonWindowDays: 84
    minimumPoints: 1
    aggregation: "mean"
  explainerCards:

    -
      title: "What it is"
      body: "High-density lipoprotein cholesterol from a lipid panel; a watch metric for cholesterol protocols rather than a promised response."
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
      guidance: "No universal numeric range is encoded for HDL-C; use the named method, population, and source interpretation rather than a wellness “optimal” range."
      applicability: "Applies to the named lipid analyte and method with fasting status, treatment, overall cardiovascular risk, and the source laboratory report retained."
      source:
        title: "2026 ACC/AHA/Multisociety Guideline on the Management of Dyslipidemia"
        organization: "American College of Cardiology, American Heart Association, and collaborating societies; Circulation"
        year: 2026
        sourceType: "clinical_guideline"
        url: "https://www.ahajournals.org/doi/10.1161/CIR.0000000000001423"
        doi: "10.1161/CIR.0000000000001423"
---

HDL-C is used here as a lab-measured lipid marker. These cholesterol protocols treat LDL-C as the primary endpoint and use other lipid markers as supportive or contextual measures.
