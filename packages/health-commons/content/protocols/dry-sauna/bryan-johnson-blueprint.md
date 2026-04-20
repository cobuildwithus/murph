---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:dry-sauna/bryan-johnson-blueprint
slug: protocols/dry-sauna/bryan-johnson-blueprint
title: Bryan Johnson Blueprint Sauna
summary: "Source-attributed dry-sauna routine from Bryan Johnson / Blueprint: daily dry sauna at 200 F for 20 minutes, morning after workout, with groin cooling for male fertility protection; April 2026 posts add a higher-burden core-temperature-threshold experiment."
status: draft
quality: usable
aliases:
  - Bryan Johnson sauna
  - Bryan Johnson sauna protocol
  - Blueprint sauna
  - Blueprint sauna protocol
  - Dont Die sauna
  - Saunamaxx
categories:
  - passive-heat
  - external-protocol
  - source-attributed
  - dry-sauna
relations:
  -
    type: parent_family
    target: experiment_family:dry-sauna
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
  -
    type: primary_biomarker
    target: biomarker:resting-heart-rate
  -
    type: secondary_biomarker
    target: biomarker:hrv-rmssd
  -
    type: source_person
    target: source_person:bryan-johnson
  -
    type: cites
    target: source_artifact:bryan-johnson-sauna-protocol-2026-01-28
  -
    type: cites
    target: source_artifact:bryan-johnson-morning-routine-2026-04-08
  -
    type: cites
    target: source_artifact:bryan-johnson-saunamaxx-2026-04-14
  -
    type: cites
    target: source_artifact:linkedin-bryan-johnson-core-temp-2026-04-16
  -
    type: cites
    target: source_artifact:linkedin-bryan-johnson-sauna-guide-2025-12-06
  -
    type: cites
    target: source_artifact:linkedin-bryan-johnson-core-temp-prototype-2026-04-03
  -
    type: cites
    target: source_artifact:x-bryan-johnson-core-temp-2026-04-16
  -
    type: cites
    target: source_artifact:x-bryan-johnson-ice-balls-2026-04-09
  -
    type: cites
    target: source_artifact:x-bryan-johnson-fired-review-2026-04-06
  -
    type: cites
    target: source_artifact:x-bryan-johnson-core-temp-update-2026-04-03
  -
    type: cites
    target: source_artifact:x-bryan-johnson-comprehensive-sauna-guide-2025-12-06
  -
    type: cites
    target: source_artifact:x-bryan-johnson-most-people-sauna-wrong-2025-11-12
lineage:
  relationship: external_named_protocol
  rationale: External named dry-sauna routine under the same modality as Murph's canonical protocol; keep it separate from Murph guidance and treat April 2026 threshold work as an experimental update rather than a default dose.
attribution:
  ownerType: external
  sourcePersonKeys:
    - source_person:bryan-johnson
  sourceUrl: https://blueprint.bryanjohnson.com/blogs/news/sauna-protocol
  note: Source-attributed from Bryan Johnson / Blueprint public pages plus public X, LinkedIn, and Substack posts. This remains an external protocol page, not Murph canonical guidance.
protocol:
  doseSignature: Daily dry sauna - 20 min - 93 C - morning after workout - groin cooling for male fertility protection
  frequency:
    sessionsPerWeek: 7
  durationMinutes:
    min: 20
    max: 20
  temperatureC:
    min: 93
    max: 93
  interventionSessionsMinimum: 7
  interventionSessionsTarget: 14
  steps:
    - Treat this as a source-attributed external routine, not a Murph default recommendation.
    - The public Blueprint routine is a dry sauna at 200 F / 93 C for 20 minutes, daily, usually in the morning after a workout.
    - Keep humidity low, use the exact source routine only if the setup is appropriate, and track session duration, approximate temperature, symptoms, hydration, and whether face or neck cooling was used.
    - The source routine uses groin cooling for male fertility protection; do not generalize that self-experiment finding into population-level safety.
    - Rehydrate after the session; Bryan Johnson's public routine mentions roughly 36 oz of mineral-supplemented water or electrolytes.
    - Treat the April 2026 core-temperature-threshold work as a higher-burden experimental variant, not as the default entry version of the protocol.
  stopConditions:
    - Stop the session if chest pain, faintness, severe dizziness, confusion, palpitations, shortness of breath, or intolerable heat distress occurs.
    - End the protocol and seek appropriate care if severe or repeated symptoms occur.
testPlans:
  -
    planId: source-attributed-rhr-hrv-21d
    durationDays: 21
    baselineDays: 7
    interventionDays: 14
    primaryBiomarkerKey: biomarker:resting-heart-rate
    secondaryBiomarkerKeys:
      - biomarker:hrv-rmssd
    minimumAdherenceSessions: 7
    targetAdherenceSessions: 14
    notes:
      - This test plan is a Murph observation wrapper around an external named routine, not proof that the source routine is broadly advisable.
      - If copied at all, compare the intervention window against the user's own baseline and log heat burden, hydration, symptoms, illness, alcohol, and post-workout timing.
claims:
  -
    claimId: source-routine-spec
    type: design_guardrail
    text: Bryan Johnson's public Blueprint sauna routine is a dry sauna at 200 F / 93 C for 20 minutes, daily, in the morning after a workout, with very low humidity and deliberate heat-protection practices.
    strength: high
    sourceKeys:
      - source_artifact:bryan-johnson-sauna-protocol-2026-01-28
      - source_artifact:bryan-johnson-morning-routine-2026-04-08
    caveats:
      - This is a source-attributed routine, not Murph canonical guidance.
      - April 2026 core-temperature testing should be treated as an experimental update rather than as the default beginner-facing dose.
  -
    claimId: source-beginner-adaptation
    type: design_guardrail
    text: Blueprint's own public guidance for people copying the sauna protocol suggests starting more conservatively with 15-20 minutes, 3-5 times per week, and 80-100 C while aiming for the lower end as a beginner.
    strength: high
    sourceKeys:
      - source_artifact:bryan-johnson-sauna-protocol-2026-01-28
    caveats:
      - The beginner adaptation is not Bryan Johnson's exact daily routine.
      - Medical clearance and individual heat tolerance still matter.
  -
    claimId: male-fertility-cooling-is-source-specific-guardrail
    type: safety
    text: Bryan Johnson reports that sauna without groin cooling worsened his semen and fertility markers and that he now uses an ice pack on the groin during sauna sessions to protect fertility markers.
    strength: low
    sourceKeys:
      - source_artifact:bryan-johnson-sauna-protocol-2026-01-28
      - source_artifact:linkedin-bryan-johnson-sauna-guide-2025-12-06
    caveats:
      - This is a self-experiment report, not clinical proof that groin icing makes sauna safe for fertility.
      - Anyone with fertility concerns or who is trying to conceive should treat heat exposure cautiously and seek medical guidance.
  -
    claimId: reported-personal-results-are-not-causal-evidence
    type: evidence_scope
    text: Bryan Johnson reports large changes in toxins, microplastics, fertility markers, vascular measures, and resting heart rate around his sauna experiments, but these are source-attributed personal results and should not be rendered as expected causal outcomes for Murph users.
    strength: low
    sourceKeys:
      - source_artifact:bryan-johnson-sauna-protocol-2026-01-28
      - source_artifact:bryan-johnson-saunamaxx-2026-04-14
      - source_artifact:linkedin-bryan-johnson-sauna-guide-2025-12-06
    caveats:
      - Single-person self-experiment data is useful context but not population-level causal evidence.
      - Murph should show these as Bryan Johnson's reported observations, not as expected user outcomes.
  -
    claimId: core-temperature-update-changes-duration-interpretation
    type: design_guardrail
    text: In April 2026, Bryan Johnson reported that his prior 20-minute daily 200 F dry-sauna sessions likely did not reach his 102.4 F / 39 C core-temperature threshold; in a pill-sensor experiment he crossed that threshold at about 31 minutes without face or neck cooling and about 40 minutes with face or neck cooling.
    strength: low
    sourceKeys:
      - source_artifact:bryan-johnson-saunamaxx-2026-04-14
      - source_artifact:linkedin-bryan-johnson-core-temp-2026-04-16
    caveats:
      - This is a higher-burden experimental variant, not an appropriate default Murph beginner protocol.
      - Individual heat tolerance, humidity, hydration, cardiovascular status, and sensor method can materially change the threshold timing.
      - The same source set says the earlier 20-minute routine still coincided with reported benefits.
  -
    claimId: apr-03-face-neck-cooling-prototype
    type: design_guardrail
    text: On April 3, 2026, Bryan Johnson reported a preliminary dry-sauna core-temperature experiment at 195 F where 102.2 F / 39 C was reached at 38 minutes with face and neck ice and 33 minutes without face and neck ice.
    strength: low
    sourceKeys:
      - source_artifact:linkedin-bryan-johnson-core-temp-prototype-2026-04-03
    caveats:
      - This was a preliminary social-post experiment later superseded by the April 14-16 saunamaxx writeups.
      - Do not use this as a Murph default protocol.
  -
    claimId: post-sauna-cooling-may-confound-threshold-goal
    type: design_guardrail
    text: For the specific goal of preserving above-threshold core-temperature time after sauna, Bryan Johnson's April 2026 saunamaxx post advises against showering or cold plunging immediately after sauna.
    strength: low
    sourceKeys:
      - source_artifact:bryan-johnson-saunamaxx-2026-04-14
    caveats:
      - This is specific to Bryan Johnson's heat-shock or core-temperature goal and should not be generalized to every sauna user or every sauna protocol.
safety:
  cautionLevel: high
  avoidOrGetClinicianGuidance:
    - serious_cardiovascular_disease
    - uncontrolled_blood_pressure
    - pregnancy
    - acute_illness_or_fever
    - seizure_disorder
    - asthma_copd_or_other_respiratory_condition
    - recent_alcohol_or_recreational_drug_use
    - beta_blocker_or_diuretic_use
    - irritated_or_inflamed_skin_conditions
    - fertility_concerns_or_trying_to_conceive
    - heat_intolerance_or_another_condition_where_heat_exposure_is_risky
  stopIf:
    - chest_pain
    - faintness
    - severe_dizziness
    - confusion
    - intolerable_heat_distress
    - shortness_of_breath
    - palpitations
    - new_neurologic_symptoms
  notes:
    - This page is source-attributed and should be handled more cautiously than Murph's canonical dry-sauna protocol.
    - Groin cooling, face and neck cooling, and post-sauna no-cold-exposure guidance are source-specific tactics, not general Murph rules.
---

This is a source-attributed external protocol page, not a Murph canonical recommendation.

## Source-attributed default routine

Bryan Johnson's public Blueprint sauna routine is:

- dry sauna
- 200 F / 93 C
- very low humidity, reported as 5-20 percent on the Blueprint sauna page
- 20 minutes
- daily
- morning after workout
- groin ice pack for male fertility protection
- head protection by hat, towel, or ice pack depending on source and date
- roughly 36 oz of mineral-supplemented water after the session

## What changed in April 2026

The April 2026 source set materially changes how this page should be interpreted. Bryan Johnson reports using ingestible core-temperature monitoring and finding that the older 20-minute 200 F routine likely did not cross his 102.4 F / 39 C core-temperature threshold. His reported threshold-crossing sessions were about 31 minutes at 200 F without face or neck cooling and about 40 minutes with face or neck cooling, both with groin cooling.

Murph should show this as a higher-burden experimental variant. It should not replace the beginner adaptation or Murph's canonical dry-sauna protocol.

## How Murph should render it

Render this page as an external named protocol in the same dry-sauna modality as Murph's Finnish dry-sauna protocol, but with clearly source-attributed self-experiment claims, a higher burden profile, and a more conservative recommendation posture.
