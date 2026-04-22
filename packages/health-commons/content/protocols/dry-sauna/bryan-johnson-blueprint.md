---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:dry-sauna/bryan-johnson-blueprint
slug: protocols/dry-sauna/bryan-johnson-blueprint
title: Bryan Johnson Sauna
summary: "Use a very hot, low-humidity dry sauna after workouts, with careful hydration and symptom checks, to see whether your resting heart rate, HRV, and recovery tolerate this higher-burden routine."
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
  rationale: External named dry-sauna routine in the same dry-sauna family; keep it separate from the simpler Finnish dry-sauna experiment and treat April 2026 threshold work as an experimental update rather than a default dose.
attribution:
  ownerType: external
  sourcePersonKeys:
    - source_person:bryan-johnson
  sourceUrl: https://blueprint.bryanjohnson.com/blogs/news/sauna-protocol
  note: Source-attributed from Bryan Johnson / Blueprint public pages plus public X, LinkedIn, and Substack posts. This is an external named routine, not a default recommendation.
protocol:
  doseSignature: Daily dry sauna · 20 min · 93 °C / 200 °F · morning after workout · source-attributed external routine
  target: 93 °C / 200 °F low-humidity dry sauna
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
    - Use a low-humidity dry sauna at about 93 °C / 200 °F.
    - Do the sauna in the morning after your workout.
    - Set a 20-minute timer and leave early if heat distress or safety symptoms show up.
    - Rehydrate after the session with water or electrolytes.
    - Log the session, workout timing, cooling tactics, hydration, symptoms, and whether the dose felt sustainable.
  tips:
    - If you are not already heat-adapted, the Blueprint public beginner guidance points toward a more conservative 15–20 minutes, 3–5 times per week, and 80–100 °C.
    - Keep humidity low.
    - Treat the April 2026 core-temperature-threshold experiments as a higher-burden variant, not the default entry version.
  keepInMind:
    - This is a higher-burden daily routine layered after workouts, so exercise load and dehydration can easily confound the result.
    - Groin cooling, face or neck cooling, and post-sauna no-cold-exposure guidance are source-specific tactics rather than general sauna rules.
    - Bryan Johnson’s reported toxin, fertility, vascular, and resting-heart-rate changes are personal observations, not expected causal outcomes for users.
    - Broader sauna physiology and safety sources live on the Dry Sauna family and bibliography, not in this source-attributed protocol's own citation set.
  logFields:
    - duration
    - temperature
    - workout timing and load
    - hydration or electrolytes
    - cooling tactics used
    - symptoms
    - sleep or recovery disruption
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
      - This test plan is an observation wrapper around an external named routine, not proof that the source routine is broadly advisable.
      - Compare the intervention window against your own baseline and log heat burden, hydration, symptoms, illness, alcohol, and post-workout timing.
whyItWorks:
  - This routine uses the same dry-sauna engine as Finnish sauna, but with a stronger dose: 93 °C / 200 °F, daily exposure, and usually post-workout timing. Skin blood vessels open, sweating accelerates, heart rate rises, and the cardiovascular system has to support cooling while exercise residue may already be raising heat, catecholamines, and fluid loss.
  - Johnson’s newer core-temperature framing treats air temperature and minutes as rough proxies; the proposed biological dose is how high core temperature rises and how long it stays elevated. Face or neck cooling can make the session more tolerable and change thermal feedback, but it also changes the core-temperature curve you are trying to interpret.
  - With daily repetition, the plausible adaptation target is heat acclimation: earlier sweating, larger plasma volume, better tolerance of skin blood-flow shifts, and less heart-rate strain at the same heat exposure. The same dose can also become too much if workout load, dehydration, or poor sleep keeps the recovery side from catching up.
  - The groin-cooling tactic is a source-specific local-temperature guardrail. Bryan Johnson reports fertility-marker problems without groin cooling and describes groin ice as part of his routine, so this page treats the tactic as part of his external thermal-engineering setup rather than as a proven general sauna rule.
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
      - This is a source-attributed routine, not a general recommendation.
      - April 2026 core-temperature testing is a higher-burden update, not the default beginner-facing dose.
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
    text: Bryan Johnson reports large changes in toxins, microplastics, fertility markers, vascular measures, and resting heart rate around his sauna experiments, but those are personal observations rather than expected causal outcomes for other people.
    strength: low
    sourceKeys:
      - source_artifact:bryan-johnson-sauna-protocol-2026-01-28
      - source_artifact:bryan-johnson-saunamaxx-2026-04-14
      - source_artifact:linkedin-bryan-johnson-sauna-guide-2025-12-06
    caveats:
      - Single-person self-experiment data is useful context but not population-level causal evidence.
      - Treat these as Bryan Johnson's reported observations, not as expected user outcomes.
  -
    claimId: core-temperature-update-changes-duration-interpretation
    type: design_guardrail
    text: In April 2026, Bryan Johnson reported that his prior 20-minute daily 200 F dry-sauna sessions likely did not reach his 102.4 F / 39 C core-temperature threshold; in a pill-sensor experiment he crossed that threshold at about 31 minutes without face or neck cooling and about 40 minutes with face or neck cooling.
    strength: low
    sourceKeys:
      - source_artifact:bryan-johnson-saunamaxx-2026-04-14
      - source_artifact:linkedin-bryan-johnson-core-temp-2026-04-16
    caveats:
      - This is a higher-burden experimental variant, not an appropriate default beginner protocol.
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
      - Do not use this as a default protocol.
  -
    claimId: post-sauna-cooling-may-confound-threshold-goal
    type: design_guardrail
    text: For the specific goal of preserving above-threshold core-temperature time after sauna, Bryan Johnson's April 2026 saunamaxx post advises against showering or cold plunging immediately after sauna.
    strength: low
    sourceKeys:
      - source_artifact:bryan-johnson-saunamaxx-2026-04-14
    caveats:
      - This is specific to Bryan Johnson's heat-shock or core-temperature goal and should not be generalized to every sauna user or every sauna protocol.
researchLandscape:
  bottomLine: "This page is best read as source-attribution for Bryan Johnson's high-burden Blueprint sauna routine, not as direct clinical evidence that the routine's reported outcomes will generalize."
  confidenceLabel: limited
  primaryClaim: "The source record strongly establishes what the public Blueprint routine says to do: dry sauna, about 93 C / 200 F, 20 minutes, daily, usually after a workout, with hydration and heat-protection tactics."
  mainCaveat: "All protocol-specific cited sources are Bryan Johnson or Blueprint self-reports; they support provenance, dose interpretation, and safety boundaries, but not population-level efficacy."
  groups:
    -
      id: source-routine-spec
      label: "Source routine and beginner boundary"
      stance: supports
      summary: "The clearest evidence here is protocol provenance: Blueprint describes the daily 20-minute 200 F dry-sauna routine and also gives a more conservative beginner adaptation. This supports representing Johnson's routine accurately while separating it from a safer starter dose."
      sourceKeys:
        - source_artifact:bryan-johnson-sauna-protocol-2026-01-28
        - source_artifact:bryan-johnson-morning-routine-2026-04-08
      defaultOpen: true
    -
      id: personal-outcomes-not-causal
      label: "Personal outcomes, not causal proof"
      stance: does_not_confirm
      summary: "Johnson reports toxin, microplastic, fertility, vascular, blood, and resting-heart-rate observations around his sauna practice. Those sources explain the protocol's motivation, but they are one-person reports with many confounders and should not be rendered as expected user outcomes."
      sourceKeys:
        - source_artifact:x-bryan-johnson-comprehensive-sauna-guide-2025-12-06
        - source_artifact:linkedin-bryan-johnson-sauna-guide-2025-12-06
        - source_artifact:x-bryan-johnson-most-people-sauna-wrong-2025-11-12
    -
      id: core-temperature-dose-variant
      label: "Core-temperature dose variant"
      stance: mixed
      summary: "The April 2026 core-temperature posts change the interpretation of the original 20-minute routine: Johnson reports that reaching roughly 102.4 F / 39 C took closer to 31 minutes, and longer with face or neck cooling. This makes the threshold-targeted saunamaxx version a higher-burden variant rather than a silent replacement for the default page protocol."
      sourceKeys:
        - source_artifact:bryan-johnson-saunamaxx-2026-04-14
        - source_artifact:linkedin-bryan-johnson-core-temp-2026-04-16
        - source_artifact:x-bryan-johnson-core-temp-2026-04-16
        - source_artifact:x-bryan-johnson-fired-review-2026-04-06
        - source_artifact:linkedin-bryan-johnson-core-temp-prototype-2026-04-03
        - source_artifact:x-bryan-johnson-core-temp-update-2026-04-03
      defaultOpen: true
    -
      id: safety-fertility-cooling-boundary
      label: "Fertility and cooling boundary"
      stance: safety_boundary
      summary: "The groin-cooling source explains why this page treats fertility concerns and local cooling as source-specific safety boundaries. It does not prove that groin icing prevents sauna-related fertility risk, so users with fertility goals should treat heat exposure cautiously."
      sourceKeys:
        - source_artifact:x-bryan-johnson-ice-balls-2026-04-09
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
    - This is source-attributed and higher-burden, so interpret it more cautiously than the simpler dry-sauna experiment.
    - Groin cooling, face and neck cooling, and post-sauna no-cold-exposure guidance are source-specific tactics, not general rules.
---

This is a higher-burden sauna routine publicly described by Bryan Johnson / Blueprint. It is included as an external comparison, not as the easiest place to start.

## Source-attributed routine

The public Blueprint sauna routine describes:

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

The April 2026 source set adds an important caveat. Bryan Johnson reported using ingestible core-temperature monitoring and finding that the older 20-minute 200 F routine likely did not cross his 102.4 F / 39 C core-temperature threshold. His reported threshold-crossing sessions were about 31 minutes at 200 F without face or neck cooling and about 40 minutes with face or neck cooling, both with groin cooling.

That makes this a higher-burden experimental variant, not a beginner-friendly default.

## How to read this page

Use this as a source-attributed example of a more aggressive dry-sauna routine. The reported personal results are interesting context, but they should not be treated as expected outcomes for other users.

This page intentionally keeps the protocol-specific source graph limited to Bryan Johnson / Blueprint posts and mirrors. Independent sauna physiology, safety, fertility, sweat, and passive-heat syntheses are attached to the broader Dry Sauna and Sauna family pages instead.

For most people, a simpler Finnish dry-sauna experiment is the cleaner first test. This one is best reserved for people who specifically want to compare against Bryan Johnson's public routine and are comfortable with the extra burden and safety caveats.
