---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:postprandial-glucose-excursion
slug: biomarkers/postprandial-glucose-excursion
title: Postprandial Glucose Excursion
summary: A meal-window glucose marker describing how much glucose rises after eating, interpreted with meal, medication, sensor, and activity context.
status: draft
quality: usable
aliases:
- post-meal glucose excursion
- post-meal glucose spike
- postprandial glucose peak
- post-meal glucose iAUC
- meal-window glucose response
categories:
- glucose
- metabolism
- cgm
- self-experiment
relations:
-
  type: related_protocol
  target: protocol_variant:post-meal-walking/walking-after-every-meal
-
  type: cites
  target: source_artifact:pmid-27747394
-
  type: cites
  target: source_artifact:pmid-23761134
-
  type: cites
  target: source_artifact:pmid-33088646
-
  type: cites
  target: source_artifact:pmid-32173259
-
  type: cites
  target: source_artifact:pmid-24038928
measurementContexts:
- continuous_glucose_monitor
- structured_fingerstick_meal_test
- laboratory_meal_test
unit: mg/dL or mmol/L, depending on glucose source
interpretationFrame:
  principle: Compare matched meal windows within the same person, not isolated spikes without context.
  caveat: Meal carbohydrate load, mixed-meal composition, medication timing, sensor lag, alcohol, sleep, illness, stress, and other activity can dominate the signal.
biomarker:
  shortName: post-meal glucose
  displayName: Postprandial Glucose Excursion
  unit: mg/dL or mmol/L
  valuePrecision: 0
  direction:
    desired: lower_or_stable
    label: Lower meal-window excursions may be favorable when achieved safely
    nuance: Lower is not automatically better for users at risk of hypoglycemia; safety symptoms and low-glucose events override curve-flattening goals.
  trendDefaults:
    latestWindowDays: 14
    comparisonWindowDays: 7
    minimumPoints: 6
    aggregation: median
  explainerCards:

    -
      title: Use meal windows
      body: For post-meal walking, the useful comparison is usually the glucose curve after comparable meals, not a single all-day average.
    -
      title: Peaks and iAUC differ
      body: Some evidence is stronger for post-meal peaks or dinner-window response than for every AUC, insulin, lipid, or long-term marker.
    -
      title: Safety first
      body: A lower curve is not a win if it creates low-glucose symptoms, medication problems, falls, or unsafe walking behavior.
  measurement:
    bestContext: CGM with meal timestamps, walk timestamps, and adherence logs across baseline and intervention windows.
    howToMeasure:
    - Mark meal start and walk start in the CGM or experiment log.
    - Compare 2–3 hour windows after similar meals across baseline and intervention.
    - When using fingerstick, use a pre-specified standardized sampling schedule such as pre-meal and fixed post-meal times; do not mix inconsistent sampling into a single trend.
    confounders:
    - meal carbohydrate and fat/protein content
    - medication or insulin timing
    - sensor lag or compression lows
    - alcohol
    - sleep debt
    - illness or stress
    - unusual exercise
    - missed or partial walks
communityOutcomeSummary:
  state: coming_soon
  minimumCohortSize: 20
  placeholder: Community outcome summaries should separate CGM users, fingerstick fallback users, diabetes-medication users, and manual-adherence-only runs.
---
Postprandial glucose excursion is the primary outcome candidate for Walking After Every Meal.

For Murph experiments, treat this as a **meal-window** biomarker. The most useful comparisons pair meal timing, meal content, walking start delay, walking duration, and glucose data. Do not interpret a single spike, a single low, or a commercial CGM score as proof that the protocol worked.
