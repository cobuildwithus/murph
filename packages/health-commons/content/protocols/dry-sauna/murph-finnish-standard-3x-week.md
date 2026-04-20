---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
slug: protocols/dry-sauna/murph-finnish-standard-3x-week
title: Murph Finnish Dry Sauna
summary: "Canonical Murph dry-sauna protocol: a 21-day self-experiment using a stable Finnish dry-sauna recipe, with resting heart rate primary and optional morning blood pressure plus exploratory HRV and sleep context."
status: field-testing
quality: usable
aliases:
  - Murph dry sauna protocol
  - Murph Finnish sauna protocol
  - Finnish dry sauna experiment
  - canonical Murph sauna protocol
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
    target: biomarker:morning-blood-pressure
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
    target: source_artifact:sauna-bibliography-2026-04-18
  -
    type: cites
    target: source_artifact:pmid-16871826
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
    target: source_artifact:pmid-31126559
  -
    type: cites
    target: source_artifact:pmid-38577299
  -
    type: cites
    target: source_artifact:pmid-36813265
  -
    type: cites
    target: source_artifact:pmid-25432420
  -
    type: cites
    target: source_artifact:pmid-29269746
  -
    type: cites
    target: source_artifact:pmid-31331560
  -
    type: cites
    target: source_artifact:pmid-34622026
  -
    type: cites
    target: source_artifact:pmid-35785965
  -
    type: cites
    target: source_artifact:pmid-31490429
  -
    type: cites
    target: source_artifact:pmid-34727008
  -
    type: cites
    target: source_artifact:pmid-41032138
  -
    type: cites
    target: source_artifact:pmid-25705824
  -
    type: cites
    target: source_artifact:pmid-28633297
  -
    type: cites
    target: source_artifact:pmid-27932366
  -
    type: cites
    target: source_artifact:pmid-29229091
  -
    type: cites
    target: source_artifact:pmid-28905164
  -
    type: cites
    target: source_artifact:pmid-30665914
  -
    type: cites
    target: source_artifact:pmid-35908583
  -
    type: cites
    target: source_artifact:pmid-36255556
  -
    type: cites
    target: source_artifact:pmid-37029766
  -
    type: cites
    target: source_artifact:pmid-38410962
  -
    type: cites
    target: source_artifact:pmid-37650138
  -
    type: cites
    target: source_artifact:pmid-35710395
  -
    type: cites
    target: source_artifact:pmid-40611569
  -
    type: cites
    target: source_artifact:pmid-41831305
  -
    type: cites
    target: source_artifact:doi-10.1152-ajpregu.00012.2025
lineage:
  relationship: root
  rationale: Murph canonical dry-sauna protocol for the first Health Commons field test.
attribution:
  ownerType: murph
protocol:
  doseSignature: 3x/week · 15–20 min · 80–100 °C · 21-day stand-alone dry-sauna experiment
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
    - During the intervention, complete three stand-alone Finnish dry-sauna sessions per week for two weeks.
    - Use a traditional dry sauna when possible, aiming for about 80–100 °C and 15–20 minutes per session.
    - Prefer a similar time of day and similar pre-sauna routine across sessions if you want cleaner comparison.
    - Treat cold plunges, new supplements, new training blocks, major diet changes, and intentional alcohol changes as separate interventions; do not add them during this experiment.
    - If you choose to sauna after exercise, log the workout timing and load explicitly; Murph should interpret that as a potentially different variant rather than silently folding it into the stand-alone protocol.
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
      - biomarker:morning-blood-pressure
      - biomarker:hrv-rmssd
      - biomarker:sleep-efficiency
      - biomarker:deep-sleep-minutes
    minimumAdherenceSessions: 4
    targetAdherenceSessions: 6
    notes:
      - Compare intervention-window averages against the user’s own 7-day baseline rather than highlighting single-session spikes.
      - Treat morning blood pressure as optional but valuable when a validated home cuff and consistent routine are available.
      - Keep HRV and sleep-stage markers exploratory unless the personal signal is strong, repeated, and not obviously confounded.
      - Murph should keep stand-alone sauna and post-exercise sauna interpretations separate whenever the workout context is materially different.
claims:
  -
    claimId: research-base-is-broad-but-mixed
    type: evidence_scope
    text: The dry-sauna research base is now broad enough for a canonical Murph page, but it remains heterogeneous in modality, temperature, duration, session context, population, and endpoints.
    strength: moderate
    sourceKeys:
      - source_artifact:sauna-bibliography-2026-04-18
      - source_artifact:pmid-16871826
      - source_artifact:pmid-29849692
      - source_artifact:mayo-2018-sauna-review
      - source_artifact:pmid-38577299
    caveats:
      - A large literature does not automatically mean that one exact wearable endpoint will move in every user.
      - Murph should surface study-design and modality caveats instead of collapsing everything into one confidence score.
  -
    claimId: near-term-cardiovascular-markers-are-the-right-v1-target
    type: intervention_result
    text: Acute and short-term sauna papers justify tracking near-term cardiovascular markers such as resting heart rate and optional morning blood pressure in a first Murph self-experiment.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-32814462
      - source_artifact:pmid-29269746
      - source_artifact:pmid-31126559
      - source_artifact:pmid-31331560
    caveats:
      - Wearable resting heart rate is a proxy marker, not a clinical cardiovascular assessment.
      - Blood-pressure interpretation requires consistent home measurement technique rather than opportunistic readings.
  -
    claimId: repeated-exposure-matters-more-than-a-single-session
    type: intervention_result
    text: Repeated sauna exposure over weeks is a better Murph recipe than a one-off session because several physiology and training-adaptation papers suggest meaningful responses accrue across repeated exposures.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-36813265
      - source_artifact:pmid-25432420
      - source_artifact:pmid-41032138
      - source_artifact:pmid-41831305
    caveats:
      - The evidence includes both standalone sauna and post-exercise sauna designs.
      - A repeated-exposure rationale does not determine the exact best dose for every user.
  -
    claimId: standalone-and-postexercise-variants-should-be-separated
    type: design_guardrail
    text: Standalone dry sauna and post-exercise dry sauna should be represented as separate Murph variants because the workout context changes physiology, hydration, and likely outcome interpretation.
    strength: high
    sourceKeys:
      - source_artifact:pmid-34622026
      - source_artifact:pmid-35785965
      - source_artifact:pmid-41032138
      - source_artifact:pmid-31490429
    caveats:
      - The same user may benefit from both designs, but Murph should not pretend they are the same experiment.
  -
    claimId: hydration-and-session-context-matter
    type: design_guardrail
    text: Hydration status, recent exercise load, and session context can materially change sauna responses, so Murph should require those to be logged rather than hand-waving them away as noise.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-34727008
      - source_artifact:pmid-31490429
      - source_artifact:pmid-31126559
    caveats:
      - A user can still run the protocol without perfect control, but the interpretation should become more cautious.
  -
    claimId: long-term-cohort-findings-are-context-not-endpoints
    type: association_not_causation
    text: Long-term Finnish cohort findings on mortality, hypertension, dementia, pneumonia, stroke, kidney outcomes, and other disease endpoints are rationale and personalization context, not outcomes a 21-day Murph experiment can test.
    strength: high
    sourceKeys:
      - source_artifact:pmid-25705824
      - source_artifact:pmid-28633297
      - source_artifact:pmid-27932366
      - source_artifact:pmid-29229091
      - source_artifact:pmid-28905164
      - source_artifact:pmid-30665914
      - source_artifact:pmid-35908583
      - source_artifact:pmid-36255556
      - source_artifact:pmid-37029766
      - source_artifact:pmid-38410962
    caveats:
      - Observational cohort evidence cannot prove an individual causal benefit.
      - Murph should not convert these into guaranteed result-card language.
  -
    claimId: null-evidence-belongs-on-the-page
    type: mixed_evidence
    text: The dry-sauna page should visibly include null or mixed intervention findings so Murph does not imply that every vascular, inflammatory, gut, or HRV marker reliably improves.
    strength: high
    sourceKeys:
      - source_artifact:pmid-35710395
      - source_artifact:pmid-37650138
      - source_artifact:pmid-40611569
    caveats:
      - A null result in one endpoint does not mean the protocol is useless for every user.
      - Murph still needs to distinguish between disease populations, athletes, and general-wellness users.
  -
    claimId: dry-sauna-is-not-infrared
    type: design_guardrail
    text: Finnish dry sauna, infrared sauna, and other passive-heat modalities should stay separate in Murph because heat source, temperature profile, humidity, and evidence base differ enough to change dose and interpretation.
    strength: high
    sourceKeys:
      - source_artifact:pmid-38577299
      - source_artifact:doi-10.1152-ajpregu.00012.2025
      - source_artifact:mayo-2018-sauna-review
    caveats:
      - Related modalities can still inform each other, but Murph should not silently merge their protocol claims.
  -
    claimId: hrv-is-exploratory-not-promised
    type: mixed_evidence
    text: HRV should stay exploratory in Murph’s first dry-sauna protocol because the literature contains both promising autonomic signals and a modern randomized null result.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-31331560
      - source_artifact:pmid-25432420
      - source_artifact:pmid-40611569
    caveats:
      - HRV is noisy and highly confounded by sleep, illness, alcohol, psychological stress, and training load.
      - A null HRV signal does not automatically mean the protocol was not personally useful.
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
    - This is a bounded wellness self-experiment, not a treatment plan for cardiovascular disease.
    - People with known cardiovascular disease or major medical conditions should use clinician guidance before starting.
    - Murph should encourage users to exit early rather than “push through” heat discomfort.
researchCoverage:
  bibliographyKey: source_artifact:sauna-bibliography-2026-04-18
  corpusStats:
    masterRecords: 180
    finnishDrySaunaSubsetRecords: 81
    reviewMetaRecords: 32
    curatedShortlistRecords: 40
    highPriorityRecords: 24
    mediumPriorityRecords: 65
    lowerPriorityRecords: 91
    finnishDrySaunaYesRecords: 36
    finnishDrySaunaYesOrLikelyRecords: 81
    earliestYear: 1978
    latestYear: 2026
    auditCutoff: 2026-04-18
  shortlistBucketCounts:
    long-term-finnish-cohort-evidence: 14
    intervention-design-reality-checks: 13
    acute-and-mechanistic: 8
    evidence-backbone: 5
  backboneSourceKeys:
    - source_artifact:pmid-16871826
    - source_artifact:pmid-29849692
    - source_artifact:mayo-2018-sauna-review
    - source_artifact:pmid-32814462
    - source_artifact:pmid-38577299
    - source_artifact:pmid-41032138
sessionLoggingFields:
  - session_date
  - session_start_time
  - session_duration_minutes
  - approximate_temperature_c
  - standalone_or_postexercise
  - exercise_type_and_load_if_applicable
  - hydration_notes
  - alcohol_last_24h
  - illness_or_fever
  - travel_or_timezone_shift
  - hard_training_last_24h
  - symptoms_during_or_after
confoundersToTrack:
  - illness_or_fever
  - alcohol_last_24h
  - hard_training_last_24h
  - travel_or_timezone_shift
  - major_bedtime_change
  - major_diet_change
  - new_supplement_or_medication_change
  - cold_plunge_or_other_new_heat_or_cold_intervention
---

## Canonical question

After a stable baseline, does a short block of **stand-alone Finnish dry sauna** move a user's near-term recovery or cardiovascular signals enough to be worth repeating?

## Canonical Murph recipe

Run a 21-day experiment:

- **7 baseline days**
- **14 intervention days**
- **3 sessions per week**
- **15–20 minutes per session**
- roughly **80–100 °C**
- **6 target sessions**, with **4 sessions** as the minimum for a useful first read

This is intentionally a practical consumer protocol, not an extreme heat-adaptation block and not a disease-treatment protocol.

## Why this exact version comes first

Murph starts with a stand-alone dry-sauna recipe because the research base says several things at once:

1. the overall literature is broad enough to justify a canonical page,
2. long-term cohort evidence is useful for context but not for short-term result cards,
3. acute and mechanistic papers support near-term cardiovascular tracking,
4. intervention-design papers show that **exercise context, hydration, and repeated exposure** matter enough that Murph should keep variants separate.

That is why this page is **not** “all sauna research in one protocol.”

## What to measure first

### Primary

- **Resting heart rate**

### Valuable optional secondary

- **Morning blood pressure**, if the user has a validated home cuff and can measure the same way each time

### Exploratory secondary

- **HRV / RMSSD**
- **Sleep efficiency**
- **Deep sleep minutes**

Murph should make it obvious that exploratory does not mean useless; it means “interesting, but not a promised signal.”

## What to log every session

At minimum log:

- session duration
- approximate temperature
- time of day
- whether the session was stand-alone or followed exercise
- illness, alcohol, travel, and unusually hard training
- any symptoms during or after the session

If these are not tracked, the experiment is still allowed, but interpretation should become more conservative.

## What this protocol deliberately does not test

This page **does not** test mortality, dementia, stroke, kidney outcomes, pneumonia, or long-term disease incidence. Those findings belong to the evidence-context layer.

This page also does **not** automatically claim HRV improvement, gut benefits, or vascular improvements. The research base contains mixed and null results, and Murph should keep those visible.

## How to read a useful result

A useful v1 result is modest and honest:

- intervention-window averages move relative to baseline,
- the user hit at least four sessions,
- no major confounder obviously explains everything,
- the burden felt acceptable,
- the user would plausibly repeat the protocol.

Murph should reward honest interpretation more than dramatic charts.

## Research base behind this page

This canonical protocol is backed by Murph's structured sauna bibliography:

- 180 master records
- 81 Finnish dry-sauna yes/likely records
- 32 review/meta records
- 40 curated shortlist papers
- 24 high-priority Murph v1 records

The shortlist itself breaks into four buckets:

- **Evidence backbone** papers for overall framing
- **Long-term Finnish cohort** papers for rationale and personalization context
- **Acute and mechanistic** papers for near-term measurable endpoints
- **Intervention design / reality check** papers for dose, context, and expectation-setting

That is the shape Murph should keep as the protocol library grows.
