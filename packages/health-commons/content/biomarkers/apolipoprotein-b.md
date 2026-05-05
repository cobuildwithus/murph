---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:apolipoprotein-b"
slug: "biomarkers/apolipoprotein-b"
title: "Apolipoprotein B"
summary: "A blood marker reflecting the number of apoB-containing atherogenic lipoprotein particles; an optional higher-resolution secondary endpoint."
status: "field-testing"
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
      body: "Each atherogenic lipoprotein carries exactly one ApoB molecule, making it a direct particle count and a stronger predictor of cardiovascular risk than LDL-C alone; in 20-30% of people LDL-C looks normal while ApoB is elevated."
    -
      title: "How to measure it"
      body: "A standard blood draw (fasting not required); desirable is below 100 mg/dL, optimal for higher-risk individuals is below 80 mg/dL, and above 130 mg/dL is elevated. Track over 3-6 month intervals."
    -
      title: "What moves it"
      body: "Saturated fat, excess body fat, refined sugar, inactivity, and poor sleep raise it; Mediterranean-style diet, fiber, weight loss, and exercise can lower it 5-15% over 12 weeks. Hypothyroidism, insulin resistance, and certain medications can confound readings."
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
---
Apolipoprotein B is used here as a lab-measured lipid marker. These cholesterol protocols treat LDL-C as the primary endpoint and use other lipid markers as supportive or contextual measures.
