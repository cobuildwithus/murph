---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
slug: protocols/dry-sauna/murph-finnish-standard-3x-week
title: Murph Finnish Dry Sauna
summary: "A 21-day Murph self-experiment: seven days of baseline, then two weeks of three Finnish dry-sauna sessions per week, using resting heart rate as the primary marker."
status: field-testing
quality: usable
aliases:
  - Murph dry sauna protocol
  - Murph Finnish sauna protocol
  - Finnish dry sauna experiment
categories:
  - passive-heat
  - recovery
  - cardiovascular
  - murph-canonical
relations:
  -
    type: parent_family
    target: experiment_family:dry-sauna
  -
    type: primary_biomarker
    target: biomarker:resting-heart-rate
  -
    type: secondary_biomarker
    target: biomarker:hrv-rmssd
  -
    type: secondary_biomarker
    target: biomarker:sleep-efficiency
  -
    type: secondary_biomarker
    target: biomarker:deep-sleep-minutes
  -
    type: cites
    target: source_artifact:pmid-29849692
  -
    type: cites
    target: source_artifact:mayo-2018-sauna-review
  -
    type: cites
    target: source_artifact:pmid-32814462
  -
    type: cites
    target: source_artifact:pmid-38577299
  -
    type: cites
    target: source_artifact:pmid-25705824
  -
    type: cites
    target: source_artifact:pmid-28633297
  -
    type: cites
    target: source_artifact:pmid-35785965
  -
    type: cites
    target: source_artifact:pmid-40611569
lineage:
  relationship: root
  rationale: Murph canonical dry-sauna protocol for the first Health Commons field test.
attribution:
  ownerType: murph
protocol:
  doseSignature: 3x/week - 15-20 min - 80-100 C - 21-day experiment
  frequency:
    sessionsPerWeek: 3
  durationMinutes:
    min: 15
    max: 20
  temperatureC:
    min: 80
    max: 100
  interventionSessionsMinimum: 4
  interventionSessionsTarget: 6
  steps:
    - Keep your normal routine for a 7-day baseline before starting the intervention.
    - Complete three Finnish dry-sauna sessions per week for two weeks.
    - Use a traditional dry sauna when possible, aiming for 80-100 C and 15-20 minutes per session.
    - Treat cold plunges, new supplements, new training blocks, major diet changes, and alcohol changes as separate interventions; do not add them during this experiment.
    - Hydrate normally, cool down gently, and log duration, approximate temperature, time of day, whether the session followed exercise, symptoms, illness, alcohol, travel, and unusually hard training.
  stopConditions:
    - Stop the session if chest pain, faintness, severe dizziness, confusion, palpitations, or unusual shortness of breath occurs.
    - End the experiment and seek appropriate care if severe or repeated symptoms occur.
testPlans:
  -
    planId: rhr-21d
    durationDays: 21
    baselineDays: 7
    interventionDays: 14
    primaryBiomarkerKey: biomarker:resting-heart-rate
    secondaryBiomarkerKeys:
      - biomarker:hrv-rmssd
      - biomarker:sleep-efficiency
      - biomarker:deep-sleep-minutes
    minimumAdherenceSessions: 4
    targetAdherenceSessions: 6
    notes:
      - Compare intervention-window RHR against the user's own 7-day baseline.
      - Label HRV and sleep-stage markers as exploratory unless the personal signal is strong and repeatable.
claims:
  -
    claimId: repeated-dry-sauna-evidence-backbone
    type: evidence_scope
    text: Regular dry-sauna bathing has a usable but heterogeneous evidence base; Murph should present this as a bounded self-experiment rather than as a guaranteed outcome.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-29849692
      - source_artifact:mayo-2018-sauna-review
      - source_artifact:pmid-38577299
    caveats:
      - Sauna studies differ in temperature, duration, frequency, population, and endpoints.
      - Evidence for long-term outcomes should not be converted into a short-term personal guarantee.
  -
    claimId: short-term-cardiovascular-markers
    type: intervention_result
    text: Acute and short-term sauna studies support tracking near-term cardiovascular markers, but Murph should phrase expected movement as possible rather than certain.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-32814462
      - source_artifact:pmid-35785965
    caveats:
      - Wearable resting heart rate is a proxy outcome, not a clinical cardiovascular assessment.
      - Blood pressure and vascular markers require appropriate measurement devices and context.
  -
    claimId: long-term-associations-are-context
    type: association_not_causation
    text: Finnish cohort findings on sauna frequency and long-term outcomes are evidence context for protocol rationale, not endpoints a 21-day Murph experiment can test.
    strength: high
    sourceKeys:
      - source_artifact:pmid-25705824
      - source_artifact:pmid-28633297
    caveats:
      - Observational cohort evidence cannot prove an individual causal benefit.
      - A 21-day self-experiment cannot test mortality, dementia, pneumonia, or long-term disease-incidence outcomes.
  -
    claimId: hrv-response-uncertain
    type: mixed_evidence
    text: HRV should be treated as an exploratory secondary marker for this protocol because dry-sauna interventions may not reliably improve HRV.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-40611569
    caveats:
      - HRV is noisy and sensitive to sleep, illness, alcohol, psychological stress, and training load.
      - A null HRV signal does not automatically mean the protocol was useless.
  -
    claimId: dry-sauna-not-infrared
    type: design_guardrail
    text: Finnish dry sauna, infrared sauna, and steam-room protocols should stay separate in Murph because modality-specific dose and evidence can differ.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-29849692
      - source_artifact:pmid-38577299
    caveats:
      - Protocols can be related, but should not silently inherit one another's dose, safety, or claims.
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - unstable_angina
    - recent_myocardial_infarction_or_stroke
    - uncontrolled_hypertension
    - symptomatic_arrhythmia
    - decompensated_heart_failure
    - severe_aortic_stenosis
    - pregnancy
    - acute_illness_or_fever
    - dehydration_or_recent_fainting
    - heat_intolerance_or_another_condition_where_heat_exposure_is_risky
  stopIf:
    - chest_pain
    - faintness
    - severe_dizziness
    - confusion
    - palpitations
    - unusual_shortness_of_breath
  notes:
    - Avoid alcohol before sauna sessions.
    - This is a wellness self-experiment, not a treatment plan for cardiovascular disease.
    - People with known cardiovascular disease or major medical conditions should use clinician guidance before starting.
---

## Purpose

This protocol asks a narrow question: after a stable baseline, does a short Finnish dry-sauna block move a user's near-term recovery or cardiovascular signals enough to be worth noticing?

## Default recipe

Run a 21-day experiment: seven baseline days, then fourteen intervention days. During the intervention, complete three dry-sauna sessions per week, ideally 15-20 minutes at about 80-100 C. The target is six sessions, and four completed sessions is the minimum for a useful first read.

## What this can and cannot tell you

This experiment can look for near-term changes in resting heart rate, HRV, and sleep context. It cannot test long-term outcomes such as mortality, dementia, incident hypertension, or pneumonia. Those findings belong in the evidence-context section, not in the user's result claim.

## Confounders to keep stable

Do not add cold plunges, new supplements, new training blocks, major diet changes, intentional alcohol changes, or major bedtime changes during the experiment. Log illness, travel, unusually hard training, alcohol, and missed sessions so the result can be interpreted honestly.
