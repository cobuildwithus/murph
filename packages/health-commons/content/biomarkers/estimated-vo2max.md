---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:estimated-vo2max
slug: biomarkers/estimated-vo2max
title: VO₂ Max
summary: Maximum oxygen the body can deliver and use during all-out effort, where a higher ceiling means heart, lungs, and muscles work together to pull more oxygen from each breath and burn it faster.
status: field-testing
quality: reviewed
aliases:
  - VO2 max
  - VO₂ max
  - V̇O2max
  - maximal oxygen uptake
  - cardiorespiratory fitness
  - CRF
  - cardio fitness
  - cardio fitness estimate
  - estimated VO2max
  - wearable VO2max
  - wearable cardio fitness
  - estimated cardio fitness
categories:
  - cardiovascular
  - fitness
  - exercise
  - wearable-metric
  - clinical-context
relations:

  -
    type: related_protocol
    target: protocol_variant:norwegian-4x4/norwegian-4x4
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
  -
    type: cites
    target: source_artifact:pmid-27881567
  -
    type: cites
    target: source_artifact:pmid-26455884
  -
    type: cites
    target: source_artifact:pmid-28153947
  -
    type: cites
    target: source_artifact:pmid-35072942
  -
    type: cites
    target: source_artifact:pmid-38599681
  -
    type: cites
    target: source_artifact:pmid-41477023
  -
    type: cites
    target: source_artifact:pmid-17414804
  -
    type: cites
    target: source_artifact:pmid-30733142
  -
    type: cites
    target: source_artifact:pmid-24066036
measurementContexts:
  - lab_cpet
  - graded_exercise_test
  - wearable_cardio_fitness
  - field_test_proxy
unit: ml/kg/min
interpretationFrame:
  principle: Compare like with like. A lab CPET value is the strongest single measurement, but for self-experiments the most useful signal is usually a repeated same-device trend against your own baseline.
  caveat: Wearable VO₂ max is an algorithmic estimate, not a direct gas-exchange measurement. Device changes, algorithm updates, heart-rate accuracy, GPS quality, altitude, heat, illness, medications, training load, and body-weight changes can all move the estimate.
biomarker:
  shortName: VO₂ max
  displayName: VO₂ Max
  unit: ml/kg/min
  valuePrecision: 1
  direction:
    desired: higher
    label: Higher usually means better cardiorespiratory fitness.
    nuance: The number is only interpretable in context. A lower value after illness, detraining, device changes, weight change, or poor sensor data may not mean your cardiovascular system truly worsened.
  privateMetricBindings:
    -
      source: metric
      metricKey: estimated-vo2-max
      role: primary
  trendDefaults:
    latestWindowDays: 14
    comparisonWindowDays: 90
    minimumPoints: 2
    aggregation: median
  explainerCards:

    -
      title: What it is
      body: VO₂ max is the maximal rate your body can take in, transport, and use oxygen during intense large-muscle exercise. It is usually expressed relative to body mass as ml/kg/min.
    -
      title: Why people care
      body: "Signals cardiorespiratory fitness; higher population-level fitness tracks with lower mortality and chronic-disease risk."
    -
      title: Lab vs wearable
      body: A lab cardiopulmonary exercise test with gas exchange is the reference context. Consumer wearables estimate VO₂ max from signals such as heart rate, pace, power, GPS, demographics, and device-specific algorithms.
    -
      title: How to read it
      body: "Use age/sex context; rising 6-12 week trends matter most with better pace, power, or easier efforts."
    -
      title: What moves it
      body: "Intervals, endurance training, detraining, illness, heat, altitude, sensors, GPS, body weight, heart-rate medications, and test protocol."
  measurement:
    bestContext: Lab CPET with respiratory gas analysis is best when a precise clinical or performance value matters. For self-experiments, same-device wearable cardio-fitness estimates are acceptable as a private trend signal when interpreted cautiously.
    howToMeasure:
      - Prefer a lab cardiopulmonary exercise test when you need a true VO₂ max value, clinical-grade interpretation, or age/sex reference-standard comparison.
      - For wearable estimates, keep the same device, app, and measurement mode across baseline and intervention windows.
      - Give the device enough valid outdoor walking, running, cycling, or other supported aerobic data with reliable heart-rate and movement signals.
      - Compare 2-to-12-week trends rather than single readings; many consumer algorithms smooth or update slowly.
      - Keep illness, detraining, travel, heat, altitude, hard training blocks, body-weight changes, medication changes, and device/firmware changes visible in the experiment notes.
    confounders:
      - device algorithm changes
      - heart-rate sensor fit
      - GPS or pace accuracy
      - unsupported exercise mode
      - altitude
      - heat
      - recent illness
      - detraining
      - beta blockers or heart-rate medication
      - body-weight changes
      - inadequate aerobic data
      - lab protocol differences
claims:

  -
    claimId: vo2max_definition_reference_standard
    type: evidence_scope
    text: VO₂ max is best treated as maximal oxygen uptake during intense large-muscle exercise; direct measurement uses cardiopulmonary exercise testing with respiratory gas exchange, while VO₂peak or algorithmic estimates are not identical to a confirmed maximal test.
    strength: high
    sourceKeys:
      - source_artifact:pmid-28153947
    caveats:
      - Lab test validity depends on protocol quality, participant effort, equipment calibration, and test termination criteria.
  -
    claimId: crf_clinical_vital_sign
    type: association_not_causation
    text: Cardiorespiratory fitness has strong clinical prognostic value, and the American Heart Association argues it should be assessed in routine clinical practice when it can improve patient management.
    strength: high
    sourceKeys:
      - source_artifact:pmid-27881567
      - source_artifact:pmid-38599681
    caveats:
      - These are population-level associations and guideline-level recommendations, not proof that a single person's wearable estimate predicts their future health.
  -
    claimId: friend_reference_standards
    type: evidence_scope
    text: CPET-derived reference standards, including FRIEND Registry work, help interpret measured cardiorespiratory fitness by age, sex, and testing context.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-26455884
    caveats:
      - Reference standards depend on the tested population, exercise modality, and whether the value is measured or estimated.
  -
    claimId: wearable_vo2max_proxy
    type: evidence_scope
    text: Consumer wearables can estimate VO₂ max, and exercise-based algorithms tend to perform better than resting-only estimates, but individual-level error remains large enough that wearable VO₂ max is best treated as a trend proxy.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-35072942
      - source_artifact:pmid-41477023
    caveats:
      - Accuracy varies by device, population, activity mode, heart-rate sensor quality, GPS/power data, and proprietary algorithm changes.
  -
    claimId: norwegian_4x4_primary_outcome
    type: intervention_result
    text: Norwegian 4x4-style aerobic interval training is one of the clearest protocol candidates for improving VO₂ max because direct interval-training trials and later syntheses commonly use VO₂ max or cardiorespiratory fitness as a primary endpoint.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-17414804
      - source_artifact:pmid-30733142
      - source_artifact:pmid-24066036
    caveats:
      - Protocol adherence, safety screening, baseline fitness, intensity fidelity, and recovery determine whether a home experiment resembles supervised study conditions.
communityOutcomeSummary:
  state: coming_soon
  minimumCohortSize: 30
  placeholder: VO₂ max outcome summaries will appear once enough opted-in runs have same-device baseline and intervention windows with visible training adherence and confounder notes.
---

VO₂ max is the highest rate at which the body can use oxygen during intense, sustained, large-muscle exercise. It is one of the clearest single markers of cardiorespiratory fitness, but the measurement context matters a lot.

## Bottom line

Use VO₂ max as a **fitness trend marker**, not a body-ranking score. The most useful question is not “is my number good enough?” It is: “did this specific protocol, run with enough fidelity and recovery, move my own cardiorespiratory-fitness signal in a plausible direction?”

For a Norwegian 4x4 experiment, VO₂ max belongs near the top of the outcome stack because the protocol is explicitly designed to stress aerobic capacity. For a sauna or recovery protocol, VO₂ max is a secondary or contextual signal; it may be interesting, but it is not the main reason to run the experiment.

## Measurement hierarchy

1. **Lab CPET with gas exchange** is the reference context when a precise value matters. It directly measures oxygen uptake during a graded exercise test and can be interpreted against reference standards.
2. **Structured field tests** can be useful when lab testing is unavailable, but they estimate fitness from performance and assumptions.
3. **Wearable cardio-fitness estimates** are the most scalable self-tracking signal. They are convenient and private, but they are algorithmic estimates and should be read as repeated trends.

## What counts as a useful self-experiment signal

A useful VO₂ max experiment read usually has:

- a stable baseline window from the same device or lab method,
- enough supported aerobic sessions for the wearable estimate to update,
- clear session-fidelity evidence such as interval intensity, pace, power, or heart-rate zones,
- visible context for illness, travel, altitude, heat, medication changes, and body-weight changes,
- a follow-up window long enough for adaptation rather than a one-day bounce.

For wearable estimates, a small shift can be noise. A more trustworthy pattern is a sustained same-device increase over several weeks that lines up with better session capacity, easier submaximal efforts, or improved heart-rate recovery.

## Common traps

Do not compare a watch estimate to a lab result as though they are interchangeable. Do not compare two devices unless you are explicitly studying device disagreement. Do not treat a sudden device-side jump as biological proof if firmware, GPS, sensor fit, route, or training mode changed.

VO₂ max is also not a complete health story. It can improve while sleep, joint pain, mood, or life-fit gets worse. Keep the protocol bounded, keep safety visible, and interpret the number as one clue among several.
