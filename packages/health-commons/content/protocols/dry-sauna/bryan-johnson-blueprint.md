---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:dry-sauna/bryan-johnson-blueprint
slug: protocols/dry-sauna/bryan-johnson-blueprint
title: Bryan Johnson Sauna
summary: "Source-attributed Blueprint dry-sauna routine: 20 minutes at about 93 C / 200 F after workouts, with hydration and source-specific cooling tactics; read the research as heat-load and safety context, not proof of Bryan Johnson's personal outcomes."
status: field-testing
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
  -
    type: cites
    target: source_artifact:mayo-2018-sauna-review
  -
    type: cites
    target: source_artifact:pmid-25705824
  -
    type: cites
    target: source_artifact:pmid-28633297
  -
    type: cites
    target: source_artifact:pmid-29269746
  -
    type: cites
    target: source_artifact:pmid-31126559
  -
    type: cites
    target: source_artifact:doi-10.1155-2014-106049
  -
    type: cites
    target: source_artifact:pmid-35785965
  -
    type: cites
    target: source_artifact:pmid-40611569
  -
    type: cites
    target: source_artifact:pmid-31869820
  -
    type: cites
    target: source_artifact:pmid-16877041
  -
    type: cites
    target: source_artifact:pmid-23411620
  -
    type: cites
    target: source_artifact:pmid-9972494
  -
    type: cites
    target: source_artifact:pmid-11165553
  -
    type: cites
    target: source_artifact:pmid-16871826
lineage:
  relationship: external_named_protocol
  rationale: External named dry-sauna routine in the same dry-sauna family; keep it separate from the simpler Finnish dry-sauna experiment and treat April 2026 threshold work as an experimental update rather than a default dose.
attribution:
  ownerType: external
  sourcePersonKeys:
    - source_person:bryan-johnson
  sourceUrl: https://blueprint.bryanjohnson.com/blogs/news/sauna-protocol
  note: Source-attributed from Bryan Johnson / Blueprint public pages plus public X, LinkedIn, and Substack posts, with independent sauna studies added only to explain mechanism, safety boundaries, and adjacent post-exercise evidence. This is an external named routine, not a default recommendation.
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
    - Keep humidity low if you are trying to mirror the source routine.
    - Treat the April 2026 core-temperature-threshold experiments as a higher-burden variant, not the default entry version.
    - Consider adding a simple next-workout note, because post-exercise sauna studies disagree on whether the extra heat load helps performance or hurts recovery.
  keepInMind:
    - This is a higher-burden daily routine layered after workouts, so exercise load and dehydration can easily confound the result.
    - Groin cooling, face or neck cooling, and post-sauna no-cold-exposure guidance are source-specific tactics rather than general sauna rules.
    - Bryan Johnson’s reported toxin, fertility, vascular, and resting-heart-rate changes are personal observations, not expected causal outcomes for users.
    - Independent sauna studies support the idea that dry sauna is a real cardiovascular and heat-load stimulus, but they do not test this exact daily 93 C / 200 F post-workout routine.
    - Long-term cohort findings are useful background, but they cannot tell you whether a 21-day self-test changed your resting heart rate, HRV, or recovery.
  logFields:
    - duration
    - temperature
    - workout timing and load
    - hydration or electrolytes
    - cooling tactics used
    - symptoms
    - sleep or recovery disruption
    - next-workout performance or soreness
    - optional pre/post session heart rate or blood pressure
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
expectedSignalDescriptions:
  -
    biomarkerKey: biomarker:resting-heart-rate
    description: Daily high-heat sauna after workouts raises heat load and heart rate during the session. With heat adaptation, resting strain may fall; if the dose is too much, resting pulse can rise instead.
  -
    biomarkerKey: biomarker:hrv-rmssd
    description: Heat plus workout residue can push the body toward stress or recovery. HRV may steady or rise if recovery catches up, or fall if daily heat is too much.
experimentOnboarding:
  schemaVersion: murph.commons.experiment-onboarding.v1
  startIntent:
    displayPrompt: "Hey Murph, I want to explore doing the Bryan Johnson sauna protocol."
    intentSummary: "Explore Bryan Johnson Sauna"
  contextReview:
    vaultChecks:
      -
        id: active_experiments
        label: Active experiments
        reason: Avoid stacking a daily post-workout heat protocol on top of another meaningful experiment unless the user knowingly accepts weaker attribution.
        readHints:
          - experiment list --status active
      -
        id: wearable_recovery_baseline
        label: Wearable recovery baseline
        reason: Check whether resting heart rate, HRV, sleep, and recovery data are available for the 7-day baseline and 14-day intervention windows.
        freshnessDays: 14
        readHints:
          - wearables sources list
          - wearables day <YYYY-MM-DD>
      -
        id: recent_training_load
        label: Recent training load
        reason: The source routine is usually layered after workouts, so heavy training, soreness, and recovery debt can confound both safety and results.
        freshnessDays: 14
        readHints:
          - timeline --since 14d
          - search query "recent workout training load soreness recovery injury sauna heat"
      -
        id: sauna_heat_history
        label: Sauna and heat-tolerance history
        reason: Distinguish a heat-adapted user from someone who should choose the conservative Blueprint adaptation or the simpler Finnish dry-sauna protocol.
        freshnessDays: 90
        readHints:
          - memory show
          - search query "sauna heat exposure heat intolerance dizziness fainting dehydration"
      -
        id: cardiovascular_heat_safety_context
        label: Cardiovascular, medication, and heat-safety context
        reason: Screen for cardiovascular disease, uncontrolled blood pressure, heat intolerance, medications that alter heat or blood-pressure response, and other reasons high heat should not be framed as a simple self-experiment.
        freshnessDays: 90
        readHints:
          - memory show
          - search query "cardiovascular disease blood pressure fainting palpitations diuretic beta blocker diabetes medication seizure asthma COPD kidney heat intolerance alcohol drug illness fever"
      -
        id: fertility_pregnancy_or_skin_context
        label: Fertility, pregnancy, and skin context
        reason: The Blueprint routine includes source-specific groin cooling and independent sauna literature makes fertility, pregnancy, and skin conditions safety boundaries rather than routine setup details.
        freshnessDays: 90
        readHints:
          - memory show
          - search query "pregnancy postpartum fertility trying to conceive semen sperm skin condition eczema rash sauna heat"
    notes:
      - Treat this as a source-attributed external routine first and a user experiment second. Murph should not imply that Bryan Johnson's reported outcomes are expected user outcomes.
      - Prefer the user's recent wearable and training context when it exists, but keep the safety screen explicit because missing vault context is not a clearance signal.
  safetyScreen:
    cautionLevel: high
    mode: ask_compact_then_expand_if_positive
    dispositionIfAnyPositive: clinician_guidance_before_unsupervised_start
    mustAsk:
      -
        id: cardiovascular_or_bp_red_flags
        prompt: known serious cardiovascular disease, exertional chest pain or pressure, fainting or near-fainting, significant palpitations, uncontrolled blood pressure, recent heart attack or stroke, heart failure, or unusual shortness of breath with heat or exercise
      -
        id: heat_or_hydration_risk
        prompt: recent illness or fever, dehydration, prior heat illness or heat intolerance, alcohol or recreational drug use today, or any situation where you cannot leave the sauna and cool down quickly
      -
        id: medication_or_condition_risk
        prompt: diuretics, beta blockers, recent blood-pressure medication changes, diabetes medication that can cause lows, seizure disorder, severe asthma or COPD, kidney disease, or another condition where high heat may be risky
      -
        id: pregnancy_fertility_or_skin_context
        prompt: pregnancy or early postpartum if relevant, fertility concerns or trying to conceive, irritated or inflamed skin conditions, or clinician guidance to avoid sauna or high heat
    stopIf:
      inheritFromProtocolSafety: true
      additionalConditions:
        - Stop immediately for chest pain, faintness, severe dizziness, confusion, palpitations, shortness of breath, new neurologic symptoms, or intolerable heat distress.
        - End the experiment and seek appropriate care if severe or repeated symptoms occur.
    notes:
      - A positive or uncertain high-caution screen means Murph should not create an unsupervised active Blueprint sauna run. Offer clinician guidance, postponing, or a lower-burden sauna protocol instead.
  setupSlots:
    -
      id: sauna_available
      label: Dry sauna available
      purpose: logistics
      valueType: boolean
      askPolicy: ask_if_unknown
      required: true
      question: Do you have access to a low-humidity dry sauna for this test?
      target:
        object: onboardingCapture
        field: answers.saunaAvailable
    -
      id: run_variant
      label: Run variant
      purpose: personalization
      valueType: enum
      askPolicy: ask_if_unknown
      required: true
      question: Do you want to mirror the 7x/week source routine, start with the more conservative Blueprint beginner adaptation, or switch to the simpler Finnish dry-sauna experiment?
      options:
        - source_routine_7x_weekly
        - conservative_adaptation_3_to_5x_weekly
        - simpler_finnish_dry_sauna
      constraints:
        sourceRoutineSessionsPerWeek: 7
        conservativeSessionsPerWeekMin: 3
        conservativeSessionsPerWeekMax: 5
      target:
        object: experimentRun
        field: variant
    -
      id: sauna_temperature_range
      label: Sauna temperature range
      purpose: measurement_fidelity
      valueType: enum
      askPolicy: ask_if_unknown
      required: true
      question: "What temperature can you realistically use: around 93 C / 200 F, 80-100 C, or lower/unsure?"
      options:
        - around_93c_200f
        - between_80c_and_100c
        - below_80c_or_unsure
      constraints:
        sourceTargetTemperatureC: 93
        sourceTargetTemperatureF: 200
      target:
        object: experimentRun
        field: temperatureRange
    -
      id: heat_adaptation
      label: Heat adaptation
      purpose: safety
      valueType: enum
      askPolicy: ask_if_unknown
      required: true
      question: Are you already regularly doing sauna or similar heat exposure, occasional only, or basically new or heat-sensitive?
      options:
        - already_regular_sauna
        - occasional_sauna
        - new_to_sauna_or_heat_sensitive
      target:
        object: onboardingCapture
        field: answers.heatAdaptation
    -
      id: workout_pairing
      label: Workout pairing
      purpose: confounder_control
      valueType: enum
      askPolicy: ask_if_unknown
      required: true
      question: Will the sauna usually happen after a workout like the source routine, at another time, or without workout pairing?
      options:
        - morning_after_workout
        - different_time_after_workout
        - no_workout_pairing
      target:
        object: experimentRun
        field: workoutPairing
    -
      id: weekly_schedule
      label: Weekly schedule
      purpose: logistics
      valueType: weekly_time_windows
      askPolicy: ask_if_unknown_or_stale
      required: true
      question: Which days and time window are realistic for sauna sessions during the 14-day intervention?
      constraints:
        sourceRoutineSessionsPerWeek: 7
        minimumUsefulSessions: 7
        targetSessions: 14
      target:
        object: experimentRun
        field: schedule
    -
      id: hydration_plan
      label: Hydration plan
      purpose: safety
      valueType: enum
      askPolicy: ask_if_unknown
      required: true
      question: "What will you use for rehydration after each session: water plus electrolytes or minerals, water only, or no plan yet?"
      options:
        - water_plus_electrolytes_or_minerals
        - water_only
        - no_plan_yet
      target:
        object: experimentRun
        field: hydrationPlan
    -
      id: cooling_tactic_policy
      label: Cooling tactics
      purpose: measurement_fidelity
      valueType: enum
      askPolicy: ask_if_unknown
      required: false
      question: Do you plan to use source-specific cooling tactics such as groin cooling, face or neck cooling, or no cooling tactics?
      options:
        - no_cooling_tactics
        - groin_cooling_if_relevant
        - face_or_neck_cooling
        - source_specific_cooling_tactics
      constraints:
        note: Face or neck cooling may change the thermal-dose curve; groin cooling is a source-specific fertility guardrail, not proven protection.
      target:
        object: experimentRun
        field: coolingTactics
    -
      id: measurement_support
      label: Measurement support
      purpose: measurement_fidelity
      valueType: enum
      askPolicy: ask_if_unknown
      required: false
      question: Can you track wearable resting heart rate and HRV, and optionally pre/post sauna heart rate or blood pressure?
      options:
        - wearable_plus_optional_bp_or_hr
        - wearable_only
        - manual_or_subjective_only
      target:
        object: experimentRun
        field: measurementSupport
    -
      id: reminder_policy
      label: Reminder policy
      purpose: assistant_support
      valueType: reminder_policy
      askPolicy: ask_at_confirmation
      required: true
      question: Do you want a reminder before planned sauna sessions, and if nothing is logged later that day should Murph ask once or leave it alone?
      options:
        - none
        - pre_session
        - pre_session_plus_same_day_missing_log_check
      target:
        object: assistantSupport
        field: reminderPolicy
  planDefaults:
    testPlanId: source-attributed-rhr-hrv-21d
    baselineDays: 7
    interventionDays: 14
    sessionsPerWeek: 7
    targetSessions: 14
    minimumUsefulSessions: 7
    firstSessionGuidance: Treat the first saved run plan as a safety-gated source-attributed comparison. If the user is not already heat-adapted, propose the conservative Blueprint adaptation or the simpler Finnish dry-sauna protocol rather than silently starting the daily 93 C / 200 F routine.
  logging:
    sessionFields:
      - duration_minutes
      - temperature_c_or_f
      - humidity_if_known
      - workout_before_sauna
      - workout_intensity_or_load
      - hydration_or_electrolytes
      - cooling_tactics_used
      - symptoms_during_or_after
      - post_sauna_cold_exposure_or_shower
      - sleep_or_recovery_disruption
      - next_workout_soreness_or_performance
      - optional_pre_post_heart_rate_or_bp
    confounders:
      - illness_or_fever
      - alcohol_last_24h
      - dehydration_or_low_fluid_intake
      - hard_training_last_24h
      - travel_or_timezone_shift
      - unusual_stress
      - hot_weather_or_other_heat_exposure
      - new_medication_or_supplement_change
    notes:
      - The core result question is whether the heat routine changes resting heart rate, HRV, recovery, or perceived training tolerance enough to be worth the burden, not whether Bryan Johnson's personal claims reproduce.
  assistantPolicy:
    maxSetupQuestionsPerTurn: 2
    askBeforeCreatingAutomations: true
    missedLogFollowup: opt_in_only
    reminderOptions:
      - none
      - pre_session
      - pre_session_plus_same_day_missing_log_check
    weeklyDigestDefault: true
    missedLogFollowupCopy: "Did you end up doing today's sauna session? Totally fine either way, I just want the experiment record to be accurate."
    confirmationPrompt: Show the source-attributed nature of the protocol, safety-screen outcome, chosen run variant, sauna access and temperature, schedule, hydration plan, logging fields, stop conditions, baseline/intervention dates, selected testPlanId, and reminder policy before creating the active experiment or automations.
whyItWorks:
  - This routine uses the same dry-sauna engine as Finnish sauna, but with a stronger dose: 93 °C / 200 °F, daily exposure, and usually post-workout timing. Skin blood vessels open, sweating accelerates, heart rate rises, and the cardiovascular system has to support cooling while exercise residue may already be raising heat, catecholamines, and fluid loss.
  - Johnson’s newer core-temperature framing treats air temperature and minutes as rough proxies; the proposed biological dose is how high core temperature rises and how long it stays elevated. Face or neck cooling can make the session more tolerable and change thermal feedback, but it also changes the core-temperature curve you are trying to interpret.
  - With daily repetition, the plausible adaptation target is heat acclimation: earlier sweating, larger plasma volume, better tolerance of skin blood-flow shifts, and less heart-rate strain at the same heat exposure. The same dose can also become too much if workout load, dehydration, or poor sleep keeps the recovery side from catching up.
  - The groin-cooling tactic is a source-specific local-temperature guardrail. Independent human sauna studies show that repeated sauna heat can temporarily affect semen and sperm markers, while Bryan Johnson reports fertility-marker problems without groin cooling and describes groin ice as part of his routine. That combination supports a fertility safety boundary, not a claim that groin ice makes the protocol fertility-safe.
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
  -
    claimId: independent-sauna-context-not-blueprint-validation
    type: evidence_scope
    text: Independent dry-sauna reviews, cohorts, acute physiology studies, and exercise-plus-sauna trials make the general heat-load and cardiovascular rationale plausible, but they do not test Bryan Johnson's exact daily 93 C / 200 F post-workout routine with cooling tactics.
    strength: moderate
    sourceKeys:
      - source_artifact:mayo-2018-sauna-review
      - source_artifact:pmid-29269746
      - source_artifact:pmid-31126559
      - source_artifact:doi-10.1155-2014-106049
      - source_artifact:pmid-35785965
      - source_artifact:pmid-40611569
    caveats:
      - Treat these sources as mechanism, endpoint, and expectation-setting evidence rather than direct validation of the Blueprint routine.
      - Temperature, humidity, session length, population, and exercise pairing differ across the independent studies.
  -
    claimId: post-workout-sauna-needs-training-context
    type: mixed_evidence
    text: "Post-exercise sauna evidence is mixed: some repeated post-exercise sauna interventions report cardiovascular or endurance-performance benefits, while other recovery and HRV studies find no clear advantage or worse next-day performance."
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-35785965
      - source_artifact:pmid-40611569
      - source_artifact:pmid-31869820
      - source_artifact:pmid-16877041
    caveats:
      - Users should log training load, soreness, next-session performance, sleep, illness, alcohol, and hydration before attributing a wearable change to sauna.
      - Athlete recovery studies and sedentary adult cardiovascular-risk trials answer different questions.
  -
    claimId: fertility-heat-risk-independent-context
    type: safety
    text: Independent human sauna studies suggest repeated sauna heat can temporarily alter sperm and semen markers, so fertility concerns or trying to conceive should stay in the safety screen even when Bryan Johnson reports using groin ice.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-23411620
      - source_artifact:pmid-9972494
      - source_artifact:x-bryan-johnson-ice-balls-2026-04-09
    caveats:
      - The independent studies did not test Johnson's groin-cooling setup.
      - This page should not imply that an ice pack neutralizes fertility risk.
  -
    claimId: high-burden-sauna-safety-screening
    type: safety
    text: General sauna safety reviews support screening for cardiovascular disease, uncontrolled blood pressure, dehydration, alcohol or drug use, heat intolerance, pregnancy, medication issues, and concerning symptoms before attempting a high-burden sauna routine.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-11165553
      - source_artifact:pmid-16871826
    caveats:
      - These reviews are general safety context, not evidence that the Blueprint routine is safe for every user.
      - A hot post-workout session can stack exercise stress, dehydration, and heat strain.
researchLandscape:
  bottomLine: "The exact Blueprint routine is documented by Bryan Johnson / Blueprint sources, while the stronger independent literature is indirect: it supports sauna as a real heat-load and cardiovascular stimulus, adds fertility and safety boundaries, and gives mixed post-workout expectations. No trial validates the exact daily 93 C / 200 F post-workout routine or Bryan Johnson's personal outcome claims."
  confidenceLabel: "limited"
  primaryClaim: "Use this as a source-attributed, higher-burden sauna comparison and track tolerability, resting heart rate, HRV, symptoms, hydration, and training context rather than expecting Bryan Johnson's reported outcomes."
  mainCaveat: "The independent studies use different temperatures, session lengths, populations, and exercise pairings; the long-term Finnish cohort studies are observational; and the Blueprint outcome claims are one-person self-reports."
  groups:
    -
      id: "source-routine-spec"
      label: "What the Blueprint routine says"
      stance: "supports"
      summary: "These sources establish the external routine itself: about 20 minutes in a 200 F / 93 C dry sauna, daily, usually after a workout, with low humidity, hydration, and source-specific cooling tactics. They are the right sources for provenance and dose wording, not broad clinical proof."
      sourceKeys:
        - "source_artifact:bryan-johnson-morning-routine-2026-04-08"
        - "source_artifact:bryan-johnson-sauna-protocol-2026-01-28"
      defaultOpen: true
    -
      id: "personal-outcomes-not-causal"
      label: "Personal outcomes, not causal proof"
      stance: "does_not_confirm"
      summary: "Johnson reports toxin, microplastic, fertility, vascular, blood, and resting-heart-rate observations around his sauna practice. Those sources explain the protocol's motivation, but they are one-person reports with many confounders and should not be rendered as expected user outcomes."
      sourceKeys:
        - "source_artifact:linkedin-bryan-johnson-sauna-guide-2025-12-06"
        - "source_artifact:x-bryan-johnson-comprehensive-sauna-guide-2025-12-06"
        - "source_artifact:x-bryan-johnson-most-people-sauna-wrong-2025-11-12"
    -
      id: "independent-sauna-physiology-context"
      label: "Independent heat-load context"
      stance: "context_only"
      summary: "Independent reviews and acute physiology studies make the basic mechanism easier to trust: sauna raises heat strain, heart rate, sweating, vascular demand, and recovery burden. This supports tracking pulse, blood pressure, symptoms, and cooldown context, but it does not validate the exact daily Blueprint dose."
      sourceKeys:
        - "source_artifact:doi-10.1155-2014-106049"
        - "source_artifact:mayo-2018-sauna-review"
        - "source_artifact:pmid-29269746"
        - "source_artifact:pmid-31126559"
      defaultOpen: true
    -
      id: "long-term-cohort-context"
      label: "Long-term cohort context"
      stance: "context_only"
      summary: "Large Finnish cohort studies link more frequent sauna bathing with lower long-term cardiovascular and hypertension risk, which helps explain why sauna is interesting. These are not randomized tests and cannot prove a 21-day Blueprint-style self-experiment caused a wearable change."
      sourceKeys:
        - "source_artifact:pmid-25705824"
        - "source_artifact:pmid-28633297"
    -
      id: "post-workout-training-context"
      label: "Post-workout and recovery evidence"
      stance: "mixed"
      summary: "The post-exercise literature is not one-note: a modern exercise-plus-sauna RCT found cardiovascular add-on benefits, a newer HRV RCT found no extra HRV benefit, a swim-recovery crossover found worse next-day sprint performance, and a tiny runner crossover found endurance benefit. That is why this page asks users to log training load and next-workout performance."
      sourceKeys:
        - "source_artifact:pmid-16877041"
        - "source_artifact:pmid-31869820"
        - "source_artifact:pmid-35785965"
        - "source_artifact:pmid-40611569"
      defaultOpen: true
    -
      id: "core-temperature-dose-variant"
      label: "Core-temperature dose variant"
      stance: "mixed"
      summary: "The April 2026 core-temperature posts change the interpretation of the original 20-minute routine: Johnson reports that reaching roughly 102.4 F / 39 C took closer to 31 minutes, and longer with face or neck cooling. This makes the threshold-targeted saunamaxx version a higher-burden variant rather than a silent replacement for the default page protocol."
      sourceKeys:
        - "source_artifact:bryan-johnson-saunamaxx-2026-04-14"
        - "source_artifact:linkedin-bryan-johnson-core-temp-2026-04-16"
        - "source_artifact:linkedin-bryan-johnson-core-temp-prototype-2026-04-03"
        - "source_artifact:x-bryan-johnson-core-temp-2026-04-16"
        - "source_artifact:x-bryan-johnson-core-temp-update-2026-04-03"
        - "source_artifact:x-bryan-johnson-fired-review-2026-04-06"
    -
      id: "safety-fertility-cooling-boundary"
      label: "Fertility and groin-cooling boundary"
      stance: "safety_boundary"
      summary: "The independent fertility studies make the heat-risk caveat real, while Johnson's groin-cooling posts explain why his named routine includes an ice-pack tactic. Together they support a warning, not a promise that groin cooling prevents sauna-related fertility effects."
      sourceKeys:
        - "source_artifact:pmid-23411620"
        - "source_artifact:pmid-9972494"
        - "source_artifact:x-bryan-johnson-ice-balls-2026-04-09"
      defaultOpen: true
    -
      id: "general-sauna-safety-screening"
      label: "General sauna safety screen"
      stance: "safety_boundary"
      summary: "General safety reviews support a conservative screen for cardiovascular disease, uncontrolled blood pressure, dehydration, alcohol or drug use, heat intolerance, pregnancy, medication issues, and red-flag symptoms. This matters more for a daily 200 F post-workout routine than for a gentler starter protocol."
      sourceKeys:
        - "source_artifact:pmid-11165553"
        - "source_artifact:pmid-16871826"
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

That source record is clear enough to represent the routine. It is not the same as proof that the routine is safe, necessary, or likely to reproduce Bryan Johnson's reported results.

## What the independent research adds

The independent sauna literature makes the page less dependent on a personality-driven source story:

- **Mechanism:** dry sauna can raise heat strain, heart rate, sweating, and vascular demand. That is why symptoms, hydration, cooldown, resting heart rate, HRV, and optional blood pressure are sensible signals to watch.
- **Long-term context:** Finnish cohort studies link frequent sauna use with lower long-term cardiovascular and hypertension risk, but those studies are observational and cannot prove a short self-test caused a change.
- **Post-workout context:** exercise-plus-sauna studies are mixed. Some show add-on cardiovascular or endurance-performance signals, while others show no HRV advantage or worse next-day sport performance. Log the workout, soreness, sleep, and next-session performance.
- **Fertility and safety:** human sauna studies make male fertility heat exposure a real safety caveat. Johnson's groin-cooling tactic is part of his routine, but it should not be presented as proven protection.

## What changed in April 2026

The April 2026 source set adds an important caveat. Bryan Johnson reported using ingestible core-temperature monitoring and finding that the older 20-minute 200 F routine likely did not cross his 102.4 F / 39 C core-temperature threshold. His reported threshold-crossing sessions were about 31 minutes at 200 F without face or neck cooling and about 40 minutes with face or neck cooling, both with groin cooling.

That makes the threshold-targeted version a higher-burden experimental variant, not a beginner-friendly default.

## How to read the study cards

Read the research section as a map, not a scorecard:

- Blueprint and social sources answer, "What exactly did Bryan Johnson say he does?"
- Independent physiology studies answer, "Is sauna a real heat and cardiovascular load?"
- Exercise-plus-sauna studies answer, "What could happen when heat is stacked after training?"
- Fertility and safety sources answer, "Where are the guardrails?"

None of those cards prove that a daily 200 F post-workout sauna will detox you, improve fertility, lower resting heart rate, or improve HRV. For most people, a simpler Finnish dry-sauna experiment is the cleaner first test. This one is best reserved for people who specifically want to compare against Bryan Johnson's public routine and are comfortable with the extra burden and safety caveats.
