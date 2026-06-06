---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:blood-glucose
slug: biomarkers/blood-glucose
title: Blood Glucose
summary: Sugar circulating in the blood, where insulin signals cells to pull it in for energy and how fast it clears after eating reflects how well that signaling works.
status: field-testing
hidden: true
quality: usable
aliases:
  - glucose
  - blood sugar
  - fasting glucose
  - fasting blood glucose
  - finger-stick glucose
  - CGM glucose
  - sensor glucose
categories:
  - metabolic
  - glycemic-control
  - body-state
  - sample-metric
  - clinical-lab
  - cgm
measurementContexts:
  - fasting_lab_plasma_glucose
  - waking_home_meter
  - pre_meal_fingerstick
  - postprandial_glucose
  - continuous_glucose_monitoring
  - overnight_cgm
unit: mg/dL
interpretationFrame:
  principle: Segment by context before interpreting. Fasting lab values, waking finger-stick checks, pre-meal values, post-meal values, overnight CGM summaries, exercise windows, illness windows, and medication windows answer different questions.
  caveat: Blood/finger-stick, laboratory plasma, and CGM interstitial sensor glucose are related but not interchangeable. Diagnosis and medication decisions require clinician-guided lab testing or approved diabetes-monitoring workflows, not trend cards.
biomarker:
  shortName: Glucose
  displayName: Blood Glucose
  unit: mg/dL
  valuePrecision: 0
  direction:
    desired: mixed_or_contextual
    label: Lower spikes and safer time-in-range are usually better, but lows are dangerous.
    nuance: The right interpretation depends on diabetes status, pregnancy, medications, fasting state, meal timing, exercise timing, illness, and clinician-set targets. A lower value is not automatically better.
  privateMetricBindings:
    -
      source: metric
      metricKey: glucose
      role: primary
  trendDefaults:
    latestWindowDays: 14
    comparisonWindowDays: 30
    minimumPoints: 7
    aggregation: median
  explainerCards:

    -
      title: What it is
      body: Blood glucose is the amount of glucose in blood at a moment in time. Imported glucose values serve as a trend signal, not a diagnostic label.
    -
      title: Why people care
      body: "Shows fasting control, post-meal spikes, overnight stability, hypoglycemia risk, and how lifestyle, illness, or medications affect metabolism."
    -
      title: How to read it
      body: "Fasting lab reference: <100 mg/dL; post-meal readings need separate timing. Treat lows as safety signals."
    -
      title: What moves it
      body: "Carbohydrates, meal timing, activity, medications, illness, stress, sleep loss, alcohol, dehydration, sensor placement, and calibration changes."
    -
      title: Safety first
      body: Hypoglycemia is an immediate safety issue. If readings are unexpectedly low, symptoms do not match the device, or insulin or sulfonylurea dosing is involved, follow the clinical plan and confirm with an approved meter or clinician-guided workflow.
  measurement:
    bestContext: "Best read with explicit context: fasting lab FPG, waking home meter, pre-meal, one-to-two-hour post-meal, overnight CGM, exercise window, sick day, or medication window. Like-context comparisons are more useful than mixing every glucose number into one generic average."
    howToMeasure:
      - For diagnosis, use clinician-ordered laboratory tests such as fasting plasma glucose, A1C, oral glucose tolerance testing, or random plasma glucose in the appropriate clinical context.
      - For home finger-stick checks, use an FDA-cleared meter and strips, wash and dry hands, use unexpired strips stored as directed, and record the timing relative to meals, activity, symptoms, and medications.
      - For CGM, treat the sensor as a glucose-trend system; confirm with a blood glucose meter when symptoms and sensor readings do not match, when readings are changing rapidly, or when the device instructions require confirmation.
      - "Capture context fields whenever possible: fasting duration, meal time, carbohydrate-heavy meals, activity or exercise, sleep disruption, alcohol, illness, stress, insulin or sulfonylurea use, and sensor or meter changes."
      - Prefer medians, time-in-range style summaries, and same-context before/after windows over isolated readings.
    confounders:
      - meal carbohydrate and meal timing
      - fasting duration
      - exercise timing and intensity
      - insulin and glucose-lowering medications
      - illness, infection, or acute stress
      - sleep loss and circadian disruption
      - alcohol
      - dehydration
      - pregnancy
      - CGM lag or compression lows
      - meter strip storage or expiration
      - device, sensor, or calibration changes
relations:

  -
    type: related_protocol
    target: protocol_variant:norwegian-4x4/norwegian-4x4
  -
    type: related_protocol
    target: protocol_variant:evening-light-reduction/red-light-glasses-before-bed
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
  -
    type: cites
    target: source_artifact:ada-standards-2026-diagnosis
  -
    type: cites
    target: source_artifact:ada-standards-2026-glycemic-goals
  -
    type: cites
    target: source_artifact:ada-diabetes-diagnosis
  -
    type: cites
    target: source_artifact:niddk-diabetes-prediabetes-tests
  -
    type: cites
    target: source_artifact:cdc-manage-blood-sugar-2024
  -
    type: cites
    target: source_artifact:cdc-low-blood-sugar-2024
  -
    type: cites
    target: source_artifact:ada-blood-glucose-meters
  -
    type: cites
    target: source_artifact:fda-noninvasive-glucose-wearable-warning-2024
  -
    type: cites
    target: source_artifact:pmid-11832527
  -
    type: cites
    target: source_artifact:pmid-35029593
  -
    type: cites
    target: source_artifact:pmid-36715875
  -
    type: cites
    target: source_artifact:pmid-31915891
claims:

  -
    claimId: blood-glucose-diagnostic-lab-thresholds
    type: evidence_scope
    text: Fasting plasma glucose and oral glucose tolerance thresholds are diagnostic anchors only when measured in the right clinical context, usually with confirmation. They provide reference context, not a diagnosis.
    strength: high
    sourceKeys:
      - source_artifact:ada-standards-2026-diagnosis
      - source_artifact:ada-diabetes-diagnosis
      - source_artifact:niddk-diabetes-prediabetes-tests
    caveats:
      - Laboratory plasma glucose, A1C, OGTT, random plasma glucose, home blood meters, and CGM sensor glucose each have different uses and error models.
  -
    claimId: blood-glucose-monitoring-targets-contextual
    type: evidence_scope
    text: Common diabetes-management targets such as pre-meal 80 to 130 mg/dL and less than 180 mg/dL two hours after a meal are personalized treatment targets, not universal wellness goals.
    strength: moderate
    sourceKeys:
      - source_artifact:cdc-manage-blood-sugar-2024
      - source_artifact:ada-standards-2026-glycemic-goals
    caveats:
      - Targets vary by age, pregnancy, comorbidities, medications, hypoglycemia risk, and clinician plan.
  -
    claimId: blood-glucose-low-is-safety-critical
    type: safety
    text: Glucose below 70 mg/dL is generally treated as low blood sugar in diabetes education, and lower or symptomatic readings deserve immediate action according to the user's clinical plan.
    strength: high
    sourceKeys:
      - source_artifact:cdc-low-blood-sugar-2024
      - source_artifact:ada-standards-2026-glycemic-goals
    caveats:
      - Symptoms, insulin use, sulfonylureas, alcohol, exercise, and impaired hypoglycemia awareness can change urgency.
  -
    claimId: blood-glucose-device-method-caveat
    type: design_guardrail
    text: Home meters, CGMs, and unauthorized noninvasive wearables are not interchangeable. Method, device, and confidence all matter; smartwatch or ring-only glucose claims remain unproven.
    strength: high
    sourceKeys:
      - source_artifact:ada-blood-glucose-meters
      - source_artifact:cdc-manage-blood-sugar-2024
      - source_artifact:fda-noninvasive-glucose-wearable-warning-2024
    caveats:
      - Approved CGM workflows can be appropriate for people with diabetes, but device instructions and confirmatory meter checks still matter.
  -
    claimId: blood-glucose-lifestyle-moves-glucose
    type: intervention_result
    text: Lifestyle change and regular physical activity can improve glucose control or diabetes-risk outcomes, while post-meal walking is a plausible short-window experiment for reducing postprandial excursions.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-11832527
      - source_artifact:pmid-35029593
      - source_artifact:pmid-36715875
    caveats:
      - Effects differ by diabetes status, medication use, meal composition, intensity, timing, and baseline fitness.
  -
    claimId: blood-glucose-sleep-circadian-context
    type: mechanistic
    text: Sleep and circadian disruption can affect glucose metabolism, so glucose trend interpretation should keep sleep timing, shift work, travel, and late meals visible.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-31915891
    caveats:
      - Circadian evidence supports context and hypothesis generation more than it proves any single consumer sleep protocol will improve glucose.
communityOutcomeSummary:
  state: coming_soon
  minimumCohortSize: 30
  placeholder: Early glucose outcome summaries will appear once enough opted-in experiment runs include glucose samples with timing context.
---

Blood glucose is one of the most useful and most easily misread biomarkers. It changes quickly enough to reveal meal, activity, sleep, stress, alcohol, illness, and medication effects. But the same number can mean different things depending on whether it came from a fasting laboratory draw, a waking finger-stick, a post-meal check, a CGM trace, an exercise window, or an illness day.

## Diagnosis and self-tracking are different jobs

Clinical diagnosis and personal trend tracking answer different questions. Fasting plasma glucose, A1C, oral glucose tolerance testing, and random plasma glucose are clinical tests with specific diagnostic rules. A home glucose meter or CGM trace can be useful for day-to-day management and experiments, but it is not a diagnosis tool.

Reference anchors:

- **Fasting plasma glucose:** under 100 mg/dL is commonly described as normal, 100 to 125 mg/dL as impaired fasting glucose or prediabetes range, and 126 mg/dL or higher as a diabetes-range result when confirmed in the right clinical context.
- **Oral glucose tolerance testing:** two-hour values below 140 mg/dL are commonly described as normal, 140 to 199 mg/dL as prediabetes range, and 200 mg/dL or higher as diabetes range when interpreted clinically.
- **Diabetes-management targets:** many diabetes education materials use 80 to 130 mg/dL before meals and less than 180 mg/dL two hours after a meal as typical targets, but those targets are individualized.
- **Low glucose:** below 70 mg/dL is a common action threshold in diabetes education and is a safety issue, not a score to optimize downward.

These anchors provide context, not a diagnosis. A trend card does not tell you whether you are normal, prediabetic, or diabetic.

## Context matters more than any single number

Glucose readings are most useful when compared within the same context:

- **Fasting laboratory plasma glucose** for clinical reference.
- **Waking home meter glucose** for a consistent self-tracking window.
- **Pre-meal finger-stick glucose** for meal and medication context.
- **One-to-two-hour post-meal glucose** for postprandial excursions.
- **CGM overnight summaries** for nocturnal stability and possible lows.
- **Exercise-window readings** for activity response and hypoglycemia risk.
- **Sick-day readings** for illness, ketone, and clinician-plan context.

A single combined glucose average is often less informative than same-context trend lines compared over time.

## What can move blood glucose

Food and activity are only the obvious movers. Glucose can also move with sleep restriction, circadian disruption, late meals, acute stress, infection, injury, dehydration, alcohol, menstrual cycle phase, pregnancy, insulin or sulfonylurea dosing, steroid medication, sensor lag, compression lows, strip storage, device changes, and whether the user washed their hands before a finger-stick.

That is why glucose is **mixed_or_contextual** rather than simply “lower is better.” Lower post-meal spikes may be a reasonable experiment goal, but hypoglycemia is dangerous and should never be treated as a good result.

## Safety boundary

People using insulin, sulfonylureas, or other glucose-lowering medications should follow their clinician's instructions for glucose monitoring, hypoglycemia treatment, sick-day rules, exercise, and dose changes. Nothing on this page replaces that guidance.
