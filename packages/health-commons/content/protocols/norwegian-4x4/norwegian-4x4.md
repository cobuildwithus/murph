---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:norwegian-4x4/norwegian-4x4
slug: protocols/norwegian-4x4/norwegian-4x4
title: Norwegian 4x4 Protocol
summary: "A 49-day Murph self-experiment using wearable-guided 4 x 4 minute aerobic intervals to test cardio-fitness signal, heart-rate recovery, resting heart rate, and recovery context without claiming disease treatment or long-term outcomes."
status: field-testing
quality: usable
aliases:
  - Norwegian 4x4
  - Norwegian 4x4 intervals
  - 4 by 4 HIIT
  - aerobic high-intensity intervals
categories:
  - cardiovascular
  - exercise
  - hiit
  - vo2max
  - murph-canonical
relations:
  -
    type: parent_family
    target: experiment_family:norwegian-4x4
  -
    type: primary_biomarker
    target: biomarker:estimated-vo2max
  -
    type: secondary_biomarker
    target: biomarker:resting-heart-rate
  -
    type: secondary_biomarker
    target: biomarker:hrv-rmssd
  -
    type: secondary_biomarker
    target: biomarker:sleep-efficiency
  -
    type: secondary_biomarker
    target: biomarker:morning-blood-pressure
  -
    type: cites
    target: source_artifact:norwegian-4x4-bibliography
  -
    type: cites
    target: source_artifact:pmid-17414804
  -
    type: cites
    target: source_artifact:ntnu-cerg-norwegian-4x4
  -
    type: cites
    target: source_artifact:pmid-30733142
  -
    type: cites
    target: source_artifact:pmid-24066036
  -
    type: cites
    target: source_artifact:doi-10.3390-ijerph17145103
  -
    type: cites
    target: source_artifact:pmid-23988787
  -
    type: cites
    target: source_artifact:pmid-25464446
  -
    type: cites
    target: source_artifact:pmid-28082387
  -
    type: cites
    target: source_artifact:pmid-33560320
  -
    type: cites
    target: source_artifact:pmid-22879367
  -
    type: cites
    target: source_artifact:pmid-30376749
  -
    type: cites
    target: source_artifact:pmid-29416382
  -
    type: cites
    target: source_artifact:pmid-32860412
  -
    type: cites
    target: source_artifact:pmid-32100573
  -
    type: cites
    target: source_artifact:pmid-30293954
  -
    type: cites
    target: source_artifact:pmid-28846513
  -
    type: cites
    target: source_artifact:pmid-39256000
  -
    type: cites
    target: source_artifact:pmid-36314990
  -
    type: cites
    target: source_artifact:pmid-37608507
lineage:
  relationship: root
  rationale: Murph canonical Norwegian 4x4 protocol for a bounded self-experiment, kept separate from sprint intervals, low-volume 1 x 4 HIIT, athlete variants, and disease-treatment cardiac rehabilitation.
attribution:
  ownerType: murph
protocol:
  doseSignature: 2x/week · 4 x 4 min intervals · 85-95% HRmax · 7-day baseline + 6-week intervention
  frequency:
    sessionsPerWeek: 2
  durationMinutes:
    min: 35
    max: 45
  interventionSessionsMinimum: 8
  interventionSessionsTarget: 12
  steps:
    - Keep your normal routine for a 7-day baseline before starting the intervention.
    - During the 6-week intervention, complete two Norwegian-style 4x4 sessions per week, separated by at least 48 hours when possible.
    - Use a bike, rower, elliptical, incline treadmill, hill walk, or run. Prefer low-impact modes if you are new to intervals or have joint concerns.
    - Warm up for about 10 minutes at easy-to-moderate effort, roughly 60-70% of estimated HRmax.
    - Complete four 4-minute hard intervals. Aim for 85-95% of estimated HRmax by the later part of each interval, not necessarily in the first minute.
    - Recover actively for 3 minutes between intervals at easy effort, roughly 60-70% of estimated HRmax.
    - Cool down for about 5 minutes.
    - Use heart rate plus perceived exertion and symptoms. Do not sprint from the start just to chase a heart-rate number.
    - Keep other training, caffeine timing, alcohol, new supplements, diet changes, and sleep schedule as stable as reasonably possible.
    - Treat a third weekly session, low-volume 1 x 4, sprint intervals, and disease-treatment cardiac rehab as separate variants.
  stopConditions:
    - Stop the session immediately if chest pain or pressure, faintness, severe dizziness, confusion, palpitations, unusual shortness of breath, neurologic symptoms, or unsafe pain occurs.
    - End the experiment and seek appropriate care if severe symptoms occur, symptoms repeat across sessions, or recovery feels unusually impaired for more than 24-48 hours.
testPlans:
  -
    planId: wearable-cardio-fitness-49d
    durationDays: 49
    baselineDays: 7
    interventionDays: 42
    primaryBiomarkerKey: biomarker:estimated-vo2max
    secondaryBiomarkerKeys:
      - biomarker:resting-heart-rate
      - biomarker:hrv-rmssd
      - biomarker:sleep-efficiency
      - biomarker:morning-blood-pressure
    minimumAdherenceSessions: 8
    targetAdherenceSessions: 12
    notes:
      - Use the wearable cardio-fitness or VO2max estimate as a noisy proxy, not as a laboratory VO2max measurement.
      - Session fidelity is part of the outcome; record whether each interval reached the intended heart-rate zone without unsafe symptoms.
      - Resting heart rate and heart-rate recovery may be useful secondary signals, but sleep, illness, stress, alcohol, heat, and training load can confound them.
      - HRV is exploratory. Sleep efficiency is recovery context and a confounder; neither is a promised outcome.
claims:
  -
    claimId: canonical-4x4-has-direct-human-intervention-support
    type: intervention_result
    text: Canonical 4 x 4 aerobic interval training has direct human intervention evidence for improving lab-measured VO2max in small healthy-adult trials, but the evidence does not prove that every consumer wearable cardio-fitness estimate will improve.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-17414804
      - source_artifact:pmid-30733142
    caveats:
      - Helgerud 2007 was small and controlled.
      - Meta-analyses combine many HIIT protocols, not only Norwegian 4x4.
      - Wearable VO2max estimates are proxies, not laboratory gas-exchange measurements.
  -
    claimId: public-dose-shape-is-warmup-4x4-active-recovery-cooldown
    type: design_guardrail
    text: The public Norwegian 4x4 recipe is best represented as a warm-up, four 4-minute hard intervals near 85-95% HRmax, 3-minute active recoveries, and a cooldown.
    strength: moderate
    sourceKeys:
      - source_artifact:ntnu-cerg-norwegian-4x4
      - source_artifact:doi-10.3390-ijerph17145103
    caveats:
      - Heart rate lags behind effort, so users should not sprint at the start just to hit the target immediately.
      - Estimated HRmax can be wrong, especially in older users or users on heart-rate-limiting medication.
  -
    claimId: heart-rate-guidance-matters-for-dose-fidelity
    type: design_guardrail
    text: Heart-rate monitoring should be preferred over perceived exertion alone when the goal is to test a 4x4 dose, because RPE-only guidance can miss the intended intensity.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-23988787
      - source_artifact:doi-10.3390-ijerph17145103
    caveats:
      - Wrist optical heart-rate sensors can be wrong during intense arm movement.
      - Murph should combine heart rate, RPE, and symptom checks rather than reducing the session to one number.
  -
    claimId: six-week-window-is-more-honest-than-two-weeks
    type: design_guardrail
    text: A 6-week intervention window is a better first Murph test than a 2-week window because the main evidence target is cardiorespiratory fitness, which often needs several weeks to show a measurable signal.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-17414804
      - source_artifact:pmid-30733142
    caveats:
      - Some users may notice session-level heart-rate recovery changes earlier.
      - A wearable cardio-fitness estimate may update slowly or not at all during the experiment.
  -
    claimId: superiority-over-moderate-continuous-training-is-not-settled
    type: mixed_evidence
    text: Murph should not claim that Norwegian 4x4 is always superior to moderate continuous training, because larger clinical trials in coronary artery disease and heart failure found similar or mixed results compared with moderate continuous training or guideline advice.
    strength: high
    sourceKeys:
      - source_artifact:pmid-25464446
      - source_artifact:pmid-28082387
      - source_artifact:pmid-33560320
    caveats:
      - These were clinical populations, not general wearable users.
      - They remain important because they prevent overclaiming from small early positive trials.
  -
    claimId: clinical-disease-trials-are-not-self-treatment-evidence
    type: safety
    text: Cardiac and heart-failure studies should be treated as safety and population-mismatch context, not as evidence that unscreened users should self-treat disease with 4x4 intervals.
    strength: high
    sourceKeys:
      - source_artifact:pmid-25464446
      - source_artifact:pmid-28082387
      - source_artifact:pmid-33560320
      - source_artifact:pmid-22879367
      - source_artifact:pmid-30376749
      - source_artifact:pmid-32860412
      - source_artifact:pmid-32100573
    caveats:
      - Supervised cardiac rehabilitation is not the same as a home self-experiment.
      - Users with known cardiovascular disease, exertional symptoms, or high-risk conditions need clinician guidance.
  -
    claimId: high-intensity-risk-is-low-but-not-zero-in-screened-settings
    type: safety
    text: Serious events during supervised HIIT and cardiac rehabilitation appear uncommon in the published safety literature, but that does not make unsupervised vigorous intervals risk-free.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-22879367
      - source_artifact:pmid-30376749
      - source_artifact:pmid-29416382
      - source_artifact:pmid-32100573
    caveats:
      - Safety studies often involve screened, supervised participants.
      - Murph should make stopping early normal, not a failure.
  -
    claimId: low-volume-1x4-and-sprint-intervals-should-be-split
    type: design_guardrail
    text: Low-volume 1 x 4 HIIT and sprint-interval training should be represented as adjacent variants, not merged into the canonical Norwegian 4x4 page.
    strength: high
    sourceKeys:
      - source_artifact:pmid-28846513
      - source_artifact:pmid-39256000
      - source_artifact:pmid-36314990
      - source_artifact:pmid-37608507
    caveats:
      - These variants may be useful, but they have different burden, intensity, injury risk, and interpretation.
  -
    claimId: hrv-and-recovery-context-are-exploratory-not-promised
    type: mixed_evidence
    text: HRV and recovery-context measures should stay exploratory endpoints because high-intensity intervals can improve fitness while also adding recovery stress, especially during the first weeks.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-30293954
      - source_artifact:pmid-30733142
    caveats:
      - HRV is highly sensitive to sleep, illness, alcohol, psychological stress, and training load.
      - Sleep should be tracked as recovery context and a confounder, not as a promised outcome.
      - A flat or worse HRV signal does not automatically mean the protocol failed.
safety:
  cautionLevel: high
  avoidOrGetClinicianGuidance:
    - known_cardiovascular_disease
    - exertional_chest_pain_or_pressure
    - unexplained_shortness_of_breath
    - syncope_or_near_syncope
    - known_significant_arrhythmia
    - heart_failure
    - recent_myocardial_infarction_or_stroke
    - uncontrolled_hypertension
    - myocarditis_or_pericarditis_history_or_recent_concern
    - pregnancy_or_early_postpartum
    - diabetes_with_hypoglycemia_risk_or_insulin_secretagogue_use
    - beta_blocker_or_heart_rate_limiting_medication_use
    - severe_asthma_or_copd_symptoms
    - acute_illness_fever_or_recent_significant_infection
    - orthopedic_injury_or_pain_that_worsens_with_vigorous_exercise
    - long_covid_or_post_exertional_malaise_pattern
  stopIf:
    - chest_pain_or_pressure
    - faintness
    - severe_dizziness
    - confusion
    - palpitations
    - unusual_shortness_of_breath
    - neurologic_symptoms
    - severe_or_worsening_joint_or_muscle_pain
    - abnormal_recovery_for_more_than_24_to_48_hours
  notes:
    - This is a bounded wellness self-experiment, not a treatment plan.
    - Use a low-impact modality if injury risk or running load is a concern.
    - Keep the first session conservative; the target is repeatable hard aerobic work, not maximal sprinting.
    - Do not run this protocol while acutely ill, febrile, or recovering from a significant infection.
    - People on heart-rate-limiting medication may need clinician-guided intensity targets because HR zones can be misleading.
researchCoverage:
  bibliographyKey: source_artifact:norwegian-4x4-bibliography
  corpusStats:
    refinedPass2Records: 42
    landingCorpusRecords: 20
    canonicalProtocolSupportRecords: 5
    safetyAndContraindicationRecords: 9
    mixedOrNullClinicalRecords: 3
    adjacentVariantRecords: 4
    earliestYear: 2007
    latestYear: 2024
    auditCutoff: 2026-04-20
sessionLoggingFields:
  - session_date
  - modality
  - completed_intervals
  - interval_peak_hrs
  - time_in_85_to_95_percent_hrmax
  - active_recovery_hr_range
  - rpe_each_interval
  - one_minute_hr_recovery
  - two_minute_hr_recovery
  - symptoms_during_or_after
  - caffeine_last_6h
  - alcohol_last_24h
  - hard_training_last_24h
  - sleep_disruption_last_night
  - illness_or_fever
  - travel_or_timezone_shift
  - unusually_high_work_or_life_stress
confoundersToTrack:
  - illness_or_fever
  - acute_infection_recovery
  - alcohol_last_24h
  - hard_training_last_24h
  - unusual_heat_or_dehydration
  - major_bedtime_change
  - major_diet_change
  - new_supplement_or_medication_change
  - caffeine_timing_change
  - travel_or_timezone_shift
  - unusually_high_work_or_life_stress
  - other_new_exercise_protocol
expectedSignal:
  primary:
    biomarkerKey: biomarker:estimated-vo2max
    direction: increase_or_no_clear_change
    latency: 4-6 weeks, with wearable update lag possible
    confidence: low_to_moderate
    sourceKeys:
      - source_artifact:pmid-17414804
      - source_artifact:pmid-30733142
  secondary:
    -
      biomarkerKey: biomarker:resting-heart-rate
      direction: decrease_or_no_clear_change
      latency: 2-6 weeks
      confidence: low_to_moderate
    -
      biomarkerKey: biomarker:hrv-rmssd
      direction: mixed
      latency: 2-6 weeks
      confidence: low
    -
      biomarkerKey: biomarker:sleep-efficiency
      direction: mixed
      latency: 1-6 weeks
      confidence: low
---

## Canonical question

After a stable baseline, does a short block of **Norwegian-style 4x4 aerobic intervals** move your cardio-fitness signal or recovery context enough to be worth repeating?

## Canonical Murph recipe

Run a 49-day experiment:

- **7 baseline days**
- **42 intervention days**
- **2 interval sessions per week**
- **12 target sessions**, with **8 sessions** as the minimum for a useful first read
- each session: warm-up, **4 x 4 minutes hard**, 3-minute active recoveries, cooldown
- target: reach about **85-95% of estimated HRmax** by the later part of each hard interval

That heart-rate target is not a sprint-start instruction. The goal is repeatable hard aerobic work that rises into the zone by the later part of each interval, not an all-out first minute.

This is not a permanent lifestyle prescription. It is a bounded test of whether this interval dose fits your body and life.

## What to measure first

Primary: **wearable cardio-fitness / estimated VO2max**.

Secondary: resting heart rate, heart-rate recovery, and session fidelity. Exploratory: HRV/RMSSD, sleep efficiency, morning blood pressure if already measured consistently, subjective energy, soreness, symptoms, and whether the protocol is too annoying for real life.

## What to log every session

At minimum log modality, completed intervals, interval peak HRs, rough time in the target HR zone, RPE for each interval, 1- and 2-minute HR recovery, symptoms, sleep disruption, alcohol, illness, travel, unusually hard training, and major stress.

## Stop conditions

Stop the session if chest pain or pressure, faintness, severe dizziness, confusion, palpitations, unusual shortness of breath, neurologic symptoms, or unsafe pain occurs.

End the experiment and seek appropriate care if severe symptoms occur, symptoms repeat across sessions, or recovery feels unusually impaired for more than 24-48 hours.

## Ask a clinician first

Ask a clinician before trying this if you have known cardiovascular disease, exertional chest symptoms, unexplained shortness of breath, fainting or near-fainting, known significant arrhythmia, heart failure, recent myocardial infarction or stroke, uncontrolled hypertension, possible myocarditis or pericarditis, pregnancy or early postpartum status, diabetes medication with hypoglycemia risk, severe asthma/COPD symptoms, long-COVID-like post-exertional malaise, or an injury that vigorous exercise could worsen.

People taking beta blockers or other heart-rate-limiting medicines should not rely on generic HRmax zones.

## What this protocol deliberately does not test

This page does not test mortality, longevity, heart-failure treatment, coronary disease treatment, diabetes treatment, hypertension treatment, or superiority over every form of moderate continuous training.

This page also does not promise HRV improvement, sleep improvement, fat loss, or a wearable VO2max increase. A useful signal, if it appears, is a practical pattern: sessions become more repeatable, heart-rate recovery or resting heart rate moves in a useful direction, and the wearable cardio-fitness estimate trends favorably. SourceKeys: `source_artifact:pmid-17414804`, `source_artifact:pmid-30733142`, `source_artifact:doi-10.3390-ijerph17145103`, `source_artifact:pmid-30293954`.

## Evidence shape

### Causal intervention evidence

Use direct 4x4 trials and VO2max meta-analyses for the core fitness rationale. Keep the claim bounded because many trials are small, clinical, or heterogeneous. SourceKeys: `source_artifact:pmid-17414804`, `source_artifact:pmid-30733142`.

### Protocol dose and design

Use the NTNU/CERG public recipe, HR-response implementation work, and RPE-vs-HR-monitor evidence to define the practical session shape. SourceKeys: `source_artifact:ntnu-cerg-norwegian-4x4`, `source_artifact:doi-10.3390-ijerph17145103`, `source_artifact:pmid-23988787`.

### Safety and contraindications

Use cardiac-rehabilitation safety reviews, the Rognmo safety registry, ESC sports-cardiology guidance, and the AHA acute cardiovascular events statement for guardrails. Do not use supervised cardiac-rehab safety evidence to imply that unscreened home HIIT is risk-free. SourceKeys: `source_artifact:pmid-22879367`, `source_artifact:pmid-30376749`, `source_artifact:pmid-29416382`, `source_artifact:pmid-32860412`, `source_artifact:pmid-32100573`.

### Mixed and null evidence

Keep SAINTEX-CAD, SMARTEX-HF, and OptimEx-Clin visible. They prevent the page from turning early small positive trials into a universal claim. SourceKeys: `source_artifact:pmid-25464446`, `source_artifact:pmid-28082387`, `source_artifact:pmid-33560320`.

### Adjacent variants

Low-volume 1 x 4 HIIT, sprint-interval training, athlete-performance 4x4, disease-treatment cardiac rehab, and metabolic-syndrome/diabetes HIIT should become separate Murph pages or context pages. SourceKeys: `source_artifact:pmid-28846513`, `source_artifact:pmid-39256000`, `source_artifact:pmid-36314990`, `source_artifact:pmid-37608507`.
