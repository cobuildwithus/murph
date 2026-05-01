---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:blood-glucose
slug: biomarkers/blood-glucose
title: Blood Glucose
summary: Sugar circulating in the blood, where insulin signals cells to pull it in for energy and how fast it clears after eating reflects how well that signaling works.
status: field-testing
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
  caveat: Blood/finger-stick, laboratory plasma, and CGM interstitial sensor glucose are related but not interchangeable. Diagnosis and medication decisions require clinician-guided lab testing or approved diabetes-monitoring workflows, not Murph trend cards.
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
      source: browser_vault_metric
      domain: body_state
      metric: glucose
      unit: mg_dL
      preferred: true
  trendDefaults:
    latestWindowDays: 14
    comparisonWindowDays: 30
    minimumPoints: 7
    aggregation: median
  explainerCards:

    -
      title: What it is
      body: Blood glucose is the amount of glucose in blood at a moment in time. Murph treats imported glucose values as a private trend signal, not as a diagnostic label.
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
    bestContext: "Use explicit context labels: fasting lab FPG, waking home meter, pre-meal, one-to-two-hour post-meal, overnight CGM, exercise window, sick day, or medication window. Murph should compare like-context windows rather than mixing every glucose number into one generic average."
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
    text: Fasting plasma glucose and oral glucose tolerance thresholds are diagnostic anchors only when measured in the right clinical context, usually with confirmation; Murph should surface them as reference context, not diagnose users.
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
    text: Home meters, CGMs, and unauthorized noninvasive wearables should not be treated as interchangeable. Murph should label method, device, and confidence and should not promote smartwatch or ring-only glucose claims.
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
  placeholder: Early Murph glucose outcome summaries will appear once enough opted-in experiment runs include glucose samples with timing context.
---

Blood glucose is one of the most useful and most easily misread biomarkers in a personal health vault. It is useful because it changes quickly enough to reveal meal, activity, sleep, stress, alcohol, illness, and medication effects. It is easily misread because the same number can mean different things depending on whether it came from a fasting laboratory draw, a waking finger-stick, a post-meal check, a CGM trace, an exercise window, or an illness day.

## Diagnosis and self-tracking are different jobs

Murph should keep a strict boundary between clinical diagnosis and personal trend interpretation. Fasting plasma glucose, A1C, oral glucose tolerance testing, and random plasma glucose are clinical tests with specific diagnostic rules. A home glucose meter or CGM trace can be useful for day-to-day management and experiments, but it is not a diagnosis engine.

Useful reference anchors:

- **Fasting plasma glucose:** under 100 mg/dL is commonly described as normal, 100 to 125 mg/dL as impaired fasting glucose or prediabetes range, and 126 mg/dL or higher as a diabetes-range result when confirmed in the right clinical context.
- **Oral glucose tolerance testing:** two-hour values below 140 mg/dL are commonly described as normal, 140 to 199 mg/dL as prediabetes range, and 200 mg/dL or higher as diabetes range when interpreted clinically.
- **Diabetes-management targets:** many diabetes education materials use 80 to 130 mg/dL before meals and less than 180 mg/dL two hours after a meal as typical targets, but those targets are individualized.
- **Low glucose:** below 70 mg/dL is a common action threshold in diabetes education and is a safety issue, not a score to optimize downward.

Those anchors should be visible as context, but Murph should not label a person as normal, prediabetic, diabetic, controlled, or uncontrolled from a private trend card.

## Context buckets Murph should avoid mixing

The safest product behavior is to segment glucose into explicit buckets before summarizing it:

- **Fasting laboratory plasma glucose** for clinical reference.
- **Waking home meter glucose** for a consistent self-tracking window.
- **Pre-meal finger-stick glucose** for meal and medication context.
- **One-to-two-hour post-meal glucose** for postprandial excursions.
- **CGM overnight summaries** for nocturnal stability and possible lows.
- **Exercise-window readings** for activity response and hypoglycemia risk.
- **Sick-day readings** for illness, ketone, and clinician-plan context.

A single combined glucose average is often less informative than a small number of labeled, same-context trend lines.

## What can move blood glucose

Food and activity are only the obvious movers. Glucose can also move with sleep restriction, circadian disruption, late meals, acute stress, infection, injury, dehydration, alcohol, menstrual cycle phase, pregnancy, insulin or sulfonylurea dosing, steroid medication, sensor lag, compression lows, strip storage, device changes, and whether the user washed their hands before a finger-stick.

That is why the page treats glucose as **mixed_or_contextual** rather than simply “lower is better.” Lower post-meal spikes may be a reasonable experiment goal for many users, but hypoglycemia is dangerous and should never be rewarded.

## How Murph should display it

For the first Murph implementation, imported `glucose` samples are projected into the private browser vault as a daily `body_state:glucose` metric. The biomarker card can show a private trend when enough values exist, but product copy should still remind users that:

- the trend is private,
- the trend is not diagnostic,
- the unit and method matter,
- same-context comparisons are preferable,
- symptoms and clinical plans override app interpretation.

Future versions should add richer glucose-specific summaries: fasting median, post-meal peak or area-under-curve, time above range, time below range, overnight lows, coefficient of variation, and method labels for CGM versus finger-stick versus lab.

## Protocol interpretation

The strongest protocol relationship in the current Commons set is regular physical activity, represented here by Norwegian 4x4 as a secondary glucose candidate rather than as a glucose-first protocol. Post-meal walking evidence is particularly useful for designing future meal-timed micro-experiments, but that protocol is not yet a first-class Murph variant in this snapshot.

Red-light glasses before bed remain a low-confidence indirect candidate because circadian and sleep context matter for glucose, not because the glasses themselves have been proven as a glucose treatment. Sauna is listed as a cautious manual candidate only because heat exposure can change recovery and hydration context; it should not be presented as a glucose-lowering protocol from this evidence set.

## Safety boundary

People using insulin, sulfonylureas, or other glucose-lowering medications need to follow their clinician's instructions for glucose monitoring, hypoglycemia treatment, sick-day rules, exercise, and dose changes. Murph should never suggest medication changes, insulin dosing, or ignoring unexpected lows or symptoms.
