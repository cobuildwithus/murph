---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:dry-sauna/bryan-johnson-blueprint
slug: protocols/dry-sauna/bryan-johnson-blueprint
title: Bryan Johnson Sauna
summary: High-heat dry sauna daily after a workout with groin ice, where stacking intense heat on exercise doubles the demand on heart and blood vessels to move heat out.
status: field-testing
quality: usable
sortRank: 40
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
media:

  -
    kind: image
    relativePath: design-assets/hero-bryan-johnson-sauna.jpg
    mediaType: image/jpeg
    caption: Bryan Johnson Sauna
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
    target: biomarker:morning-blood-pressure
  -
    type: secondary_biomarker
    target: biomarker:hrv-rmssd
  -
    type: secondary_biomarker
    target: biomarker:estimated-vo2max
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
    target: source_artifact:bryanjohns0n-saunamaxx-2026-04-14
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
    target: source_artifact:pmid-41603269
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
  sessionShape:
    label: Per day
    segments:
      - label: workout
        kind: context
        durationMinutes: 30
      - label: sauna 93 °C
        kind: stimulus
        durationMinutes: 20
      - label: rehydrate
        kind: cooldown
        durationMinutes: 10
    ticks:
      - start
      - after workout
      - end
  temperatureC:
    min: 93
    max: 93
  interventionSessionsMinimum: 7
  interventionSessionsTarget: 14
  steps:
    - Do the sauna in the morning after your workout.
    - Use a low-humidity dry sauna at about 93 °C / 200 °F.
    - Put ice on the groin during the session.
    - Set a 20-minute timer and leave early if heat distress or safety symptoms show up.
    - Rehydrate after the session with water or electrolytes.
    - Log the session, workout timing, cooling tactics, hydration, symptoms, and whether the dose felt sustainable.
  tips:
    - "Choose the run first: exact daily 93 °C source routine, 3–5x/week beginner version, or Finnish sauna."
    - "Use low humidity and log actual temperature; 80–100 °C adaptation is not the 93 °C source dose."
    - "Pair only with planned workouts; do not add extra hard training to justify daily post-workout heat."
    - "Set exactly 20 minutes; keep groin, face, or neck cooling consistent between sessions."
    - "Rehydrate after every session with water or electrolytes; avoid alcohol and cold-plunge stacking that day."
    - "Log next-workout soreness, sleep, HRV, and resting pulse; do not chase Bryan’s personal outcomes."
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
  sessionFieldIds:
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
      - biomarker:morning-blood-pressure
      - biomarker:hrv-rmssd
      - biomarker:estimated-vo2max
    minimumAdherenceSessions: 7
    targetAdherenceSessions: 14
    notes:
      - This test plan is an observation wrapper around an external named routine, not proof that the source routine is broadly advisable.
      - Compare the intervention window against your own baseline and log heat burden, hydration, symptoms, illness, alcohol, and post-workout timing.
      - Treat home-cuff blood pressure as optional but valuable when the routine is consistent; treat wearable VO2max or cardio-fitness estimates as longer-horizon context.
expectedSignalDescriptions:

  -
    biomarkerKey: biomarker:resting-heart-rate
    expected: Possible change
    expectedDirection: mixed_or_contextual
    protocolProminence: focus
    estimatedChange:
      kind: absolute
      low: -3
      high: 2
      unit: bpm
      window: 2-8 weeks
      confidence: low
      basis: Adjacent repeated passive-heat evidence suggests roughly a 3 bpm resting-HR drop, while this exact daily 93 C post-workout routine could also raise RHR if recovery debt accumulates.
    description: "Daily 93 C post-workout heat keeps cardiac output high; adaptation lowers resting pulse, while unrecovered heat and training push it up."
  -
    biomarkerKey: biomarker:morning-blood-pressure
    expected: Could trend lower
    expectedDirection: down_or_stable
    protocolProminence: focus
    estimatedChange:
      kind: absolute
      low: -8
      high: 0
      unit: mmHg systolic
      window: 4-8 weeks
      confidence: low
      basis: Adjacent post-exercise sauna RCT evidence showed about -8 mmHg systolic versus exercise alone at 8 weeks; acute sauna and passive-heat studies support vascular plausibility but not this exact dose.
    description: "Post-workout heat opens peripheral vessels and lowers vascular resistance, relaxing morning vessel tone after repeated tolerable sessions."
  -
    biomarkerKey: biomarker:hrv-rmssd
    expected: Worth watching
    expectedDirection: mixed_or_contextual
    protocolProminence: focus
    estimatedChange:
      kind: mixed_or_contextual
      window: 2-8 weeks
      confidence: low
      basis: Near-adjacent post-exercise sauna RCT evidence did not show a clear HRV advantage over exercise alone; consumer RMSSD is useful mainly as a recovery/tolerability trend.
    description: "Workout stress, heat stress, fluid loss, and cooldown shift autonomic load; RMSSD drops when recovery cannot keep up."
  -
    biomarkerKey: biomarker:estimated-vo2max
    expected: Could improve
    expectedDirection: up_or_stable
    protocolProminence: context
    estimatedChange:
      kind: absolute
      low: 0
      high: 3
      unit: mL/kg/min
      window: 6-8 weeks
      confidence: low
      basis: Adjacent 8-week exercise-plus-sauna RCT evidence showed +2.7 mL/kg/min cardiorespiratory-fitness change versus exercise alone; the Bryan routine is hotter, daily, and source-attributed.
    description: "Post-workout sauna extends circulatory strain after exercise, adding conditioning only when it preserves training quality and recovery."
experimentOnboarding:
  schemaVersion: "murph.commons.experiment-onboarding.v2"
  startIntent:
    displayPrompt: "Hey Murph, I want to explore doing the Bryan Johnson sauna protocol."
    intentSummary: "Explore Bryan Johnson Sauna"
  safetyScreen:
    dispositionIfAnyPositive: "clinician_guidance_before_unsupervised_start"
    mustAsk:
      - id: "cardiovascular_or_bp_red_flags"
        prompt: "known serious cardiovascular disease, exertional chest pain or pressure, fainting or near-fainting, significant palpitations, uncontrolled blood pressure, recent heart attack or stroke, heart failure, or unusual shortness of breath with heat or exercise"
      - id: "heat_or_hydration_risk"
        prompt: "recent illness or fever, dehydration, prior heat illness or heat intolerance, alcohol or recreational drug use today, or any situation where you cannot leave the sauna and cool down quickly"
      - id: "medication_or_condition_risk"
        prompt: "diuretics, beta blockers, recent blood-pressure medication changes, diabetes medication that can cause lows, seizure disorder, severe asthma or COPD, kidney disease, or another condition where high heat may be risky"
      - id: "pregnancy_fertility_or_skin_context"
        prompt: "pregnancy or early postpartum if relevant, fertility concerns or trying to conceive, irritated or inflamed skin conditions, or clinician guidance to avoid sauna or high heat"
    stopIf:
      additionalConditions:
        - "Stop immediately for chest pain, faintness, severe dizziness, confusion, palpitations, shortness of breath, new neurologic symptoms, or intolerable heat distress."
        - "End the experiment and seek appropriate care if severe or repeated symptoms occur."
  setupSlots:
    - id: "sauna_available"
      label: "Dry sauna available"
      question: "Do you have access to a low-humidity dry sauna for this test?"
      target:
        object: "onboardingCapture"
        field: "answers.saunaAvailable"
    - id: "run_variant"
      label: "Run variant"
      question: "Do you want to mirror the 7x/week source routine, start with the more conservative Blueprint beginner adaptation, or switch to the simpler Finnish dry-sauna experiment?"
      options:
        - "source_routine_7x_weekly"
        - "conservative_adaptation_3_to_5x_weekly"
        - "simpler_finnish_dry_sauna"
      constraints:
        sourceRoutineSessionsPerWeek: 7
        conservativeSessionsPerWeekMin: 3
        conservativeSessionsPerWeekMax: 5
      target:
        object: "experimentRun"
        field: "variant"
    - id: "sauna_temperature_range"
      label: "Sauna temperature range"
      question: "What temperature can you realistically use: around 93 C / 200 F, 80-100 C, or lower/unsure?"
      options:
        - "around_93c_200f"
        - "between_80c_and_100c"
        - "below_80c_or_unsure"
      constraints:
        sourceTargetTemperatureC: 93
        sourceTargetTemperatureF: 200
      target:
        object: "experimentRun"
        field: "temperatureRange"
    - id: "heat_adaptation"
      label: "Heat adaptation"
      question: "Are you already regularly doing sauna or similar heat exposure, occasional only, or basically new or heat-sensitive?"
      options:
        - "already_regular_sauna"
        - "occasional_sauna"
        - "new_to_sauna_or_heat_sensitive"
      target:
        object: "onboardingCapture"
        field: "answers.heatAdaptation"
    - id: "workout_pairing"
      label: "Workout pairing"
      question: "Will the sauna usually happen after a workout like the source routine, at another time, or without workout pairing?"
      options:
        - "morning_after_workout"
        - "different_time_after_workout"
        - "no_workout_pairing"
      target:
        object: "experimentRun"
        field: "workoutPairing"
    - id: "weekly_schedule"
      label: "Weekly schedule"
      question: "Which days and time window are realistic for sauna sessions during the 14-day intervention?"
      constraints:
        askWhen: "if_unknown_or_stale"
        sourceRoutineSessionsPerWeek: 7
        minimumUsefulSessions: 7
        targetSessions: 14
        defaultRunPlanSchedule:
          kind: "dailyLocal"
          localTime: "07:30"
          timeZone: "UTC"
        runPlanScheduleTimeZonePolicy: "replace_with_user_vault_timezone"
      target:
        object: "onboardingCapture"
        field: "answers.weeklySchedule"
    - id: "hydration_plan"
      label: "Hydration plan"
      question: "What will you use for rehydration after each session: water plus electrolytes or minerals, water only, or no plan yet?"
      options:
        - "water_plus_electrolytes_or_minerals"
        - "water_only"
        - "no_plan_yet"
      target:
        object: "experimentRun"
        field: "hydrationPlan"
    - id: "cooling_tactic_policy"
      label: "Cooling tactics"
      question: "Do you plan to use source-specific cooling tactics such as groin cooling, face or neck cooling, or no cooling tactics?"
      options:
        - "no_cooling_tactics"
        - "groin_cooling_if_relevant"
        - "face_or_neck_cooling"
        - "source_specific_cooling_tactics"
      constraints:
        optional: true
        note: "Face or neck cooling may change the thermal-dose curve; groin cooling is a source-specific fertility guardrail, not proven protection."
      target:
        object: "experimentRun"
        field: "coolingTactics"
    - id: "measurement_support"
      label: "Measurement support"
      question: "Can you track wearable resting heart rate and HRV, and optionally pre/post sauna heart rate or blood pressure?"
      options:
        - "wearable_plus_optional_bp_or_hr"
        - "wearable_only"
        - "manual_or_subjective_only"
      constraints:
        optional: true
      target:
        object: "experimentRun"
        field: "measurementSupport"
    - id: "reminder_policy"
      label: "Reminder policy"
      question: "Do you want a reminder before planned sauna sessions, and if nothing is logged later that day should Murph ask once or leave it alone?"
      options:
        - "none"
        - "pre_session"
        - "pre_session_plus_same_day_missing_log_check"
      constraints:
        askWhen: "at_confirmation"
      target:
        object: "assistantSupport"
        field: "reminderPolicy"
  planDefaults:
    testPlanId: "source-attributed-rhr-hrv-21d"
    firstSessionGuidance: "Treat the first saved run plan as a safety-gated source-attributed comparison. If the user is not already heat-adapted, propose the conservative Blueprint adaptation or the simpler Finnish dry-sauna protocol rather than silently starting the daily 93 C / 200 F routine."
  trackingHints:
    confounderFields:
      - "illness_or_fever"
      - "alcohol_last_24h"
      - "dehydration_or_low_fluid_intake"
      - "hard_training_last_24h"
      - "travel_or_timezone_shift"
      - "unusual_stress"
      - "hot_weather_or_other_heat_exposure"
      - "new_medication_or_supplement_change"
    notes:
      - "The core result question is whether the heat routine changes resting heart rate, HRV, recovery, or perceived training tolerance enough to be worth the burden, not whether Bryan Johnson's personal claims reproduce."
  supportHints:
    missedLogFollowupCopy: "Did you end up doing today's sauna session? Totally fine either way, I just want the experiment record to be accurate."
whyItWorks:
  - "## Heat stacks on workout stress\n\nPost-workout sauna is not passive rest. Exercise already raises heat, catecholamines, heart rate, and fluid loss; 93 °C dry heat adds another circulatory load before recovery is complete."
  - "## Cooling tactics change dose\n\nGroin, face, or neck cooling changes local temperature and thermal feedback. It does not make the routine universally safe; it changes what heat signal the body receives."
  - "## Adaptation is heat handling\n\nRepeated heat exposure trains earlier sweating, larger plasma volume, steadier skin blood flow, and lower strain at the same temperature—when sleep, hydration, and training load recover."
mechanismChain:
  -
    label: "Session"
    content: "Daily post-workout dry sauna · 93 °C · 20 min"
  -
    label: "Heat load"
    content: "Exercise residue plus heat redirects blood to skin; sweating accelerates"
  -
    label: "Repeated signal"
    content: "High HR · fluid loss · heat-shock signaling · vascular shear"
  -
    label: "Adaptation"
    content: "Heat tolerance improves · plasma volume expands · resting strain drops if recovered"
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
      - source_artifact:bryanjohns0n-saunamaxx-2026-04-14
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
      - source_artifact:bryanjohns0n-saunamaxx-2026-04-14
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
      - source_artifact:bryanjohns0n-saunamaxx-2026-04-14
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
    text: Post-exercise sauna evidence is mixed: some repeated post-exercise sauna interventions report cardiovascular or endurance-performance benefits, while other recovery and HRV studies find no clear advantage or worse next-day performance.
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
  bottomLine: The exact Blueprint routine is documented by Bryan Johnson / Blueprint sources, while the stronger independent literature is indirect: it supports sauna as a real heat-load and cardiovascular stimulus, adds fertility and safety boundaries, and gives mixed post-workout expectations. No trial validates the exact daily 93 C / 200 F post-workout routine or Bryan Johnson's personal outcome claims.
  confidenceLabel: limited
  primaryClaim: Use this as a source-attributed, higher-burden sauna comparison and track tolerability, resting heart rate, HRV, symptoms, hydration, and training context rather than expecting Bryan Johnson's reported outcomes.
  mainCaveat: The independent studies use different temperatures, session lengths, populations, and exercise pairings; the long-term Finnish cohort studies are observational; and the Blueprint outcome claims are one-person self-reports.
  groups:

    -
      id: source-routine-spec
      label: What the Blueprint routine says
      stance: supports
      summary: These sources establish the external routine itself: a high-temperature dry-sauna session around 20 minutes daily, usually after exercise, with low humidity, rehydration, and source-specific cooling tactics. Use them for dose provenance and protocol wording, not clinical efficacy.
      sourceKeys:
        - source_artifact:bryan-johnson-sauna-protocol-2026-01-28
        - source_artifact:bryan-johnson-morning-routine-2026-04-08
        - source_artifact:bryan-johnson-protocol-2026-01-23
        - source_artifact:bryan-johnson-hot-truth-finnish-saunas-2025-04-13
      defaultOpen: true
    -
      id: personal-outcomes-not-causal
      label: Personal outcomes, not causal proof
      stance: does_not_confirm
      summary: Johnson reports toxin, microplastic, fertility, vascular, blood, biological-age, and resting-heart-rate observations around his sauna practice. These sources explain why the protocol exists, but they are one-person reports with many co-interventions and should not be rendered as expected user outcomes.
      sourceKeys:
        - source_artifact:linkedin-bryan-johnson-sauna-guide-2025-12-06
        - source_artifact:x-bryan-johnson-comprehensive-sauna-guide-2025-12-06
        - source_artifact:bryan-johnson-sauna-protocol-2026-01-28
        - source_artifact:x-bryan-johnson-most-people-sauna-wrong-2025-11-12
        - source_artifact:bryan-johnson-protocol-2026-01-23
        - source_artifact:bryanjohns0n-saunamaxx-2026-04-14
        - source_artifact:bryan-johnson-biological-age-sauna-2025-05-27
        - source_artifact:pmid-22505948
    -
      id: core-temperature-dose-variant
      label: Core-temperature dose variant
      stance: mixed
      summary: The April 2026 core-temperature posts change the interpretation of the original 20-minute routine: Johnson reports that reaching roughly 102.4 F / 39 C took closer to 31 minutes, and longer with face or neck cooling. Treat the threshold-targeted saunamaxx version as a higher-burden variant, with cooling used as a tolerability tactic rather than proof of safety.
      sourceKeys:
        - source_artifact:bryanjohns0n-saunamaxx-2026-04-14
        - source_artifact:bryanjohns0n-core-temp-prototype-2026-04-03
        - source_artifact:x-bryan-johnson-fired-review-2026-04-06
        - source_artifact:pmid-14648127
        - source_artifact:pmid-16916892
        - source_artifact:pmid-40041158
        - source_artifact:linkedin-bryan-johnson-core-temp-2026-04-16
        - source_artifact:linkedin-bryan-johnson-core-temp-prototype-2026-04-03
        - source_artifact:pmid-35092517
        - source_artifact:pmid-40355096
        - source_artifact:pmid-33646422
        - source_artifact:x-bryan-johnson-core-temp-2026-04-16
        - source_artifact:x-bryan-johnson-core-temp-update-2026-04-03
        - source_artifact:pmid-17928942
        - source_artifact:pmid-18704483
        - source_artifact:pmid-22222935
        - source_artifact:pmid-26264882
        - source_artifact:pmid-28944271
        - source_artifact:pmid-20414820
        - source_artifact:pmid-22488284
        - source_artifact:pmid-24085588
        - source_artifact:pmid-25722377
        - source_artifact:pmid-28842615
      defaultOpen: true
    -
      id: core-temperature-measurement-context
      label: Core-temperature measurement limits
      stance: context_only
      summary: Core-temperature sources explain why swallowed pills, rectal probes, skin sensors, ear readings, hydration, timing, and recovery lag can disagree. This supports careful measurement caveats; it does not turn a specific core-temperature threshold into a required target.
      sourceKeys:
        - source_artifact:pmid-17178778
        - source_artifact:pmid-18379216
        - source_artifact:pmid-28496414
        - source_artifact:pmid-12427049
        - source_artifact:pmid-18059987
        - source_artifact:pmid-19295956
        - source_artifact:pmid-22892415
        - source_artifact:pmid-24561595
        - source_artifact:pmid-26485169
        - source_artifact:pmid-27857951
        - source_artifact:pmid-28816921
        - source_artifact:pmid-33449102
        - source_artifact:pmid-33997115
        - source_artifact:pmid-34502822
        - source_artifact:pmid-36939844
        - source_artifact:pmid-40118073
        - source_artifact:pmid-33553501
        - source_artifact:pmid-36236737
        - source_artifact:pmid-35813051
        - source_artifact:pmid-27186918
    -
      id: independent-sauna-physiology-context
      label: Independent sauna physiology
      stance: context_only
      summary: Independent reviews and acute physiology studies make the basic mechanism easier to trust: dry sauna raises heat strain, heart rate, sweating, vascular demand, autonomic load, immune markers, and recovery burden. This supports tracking pulse, blood pressure, symptoms, and cooldown context, but it does not validate the exact daily Blueprint dose.
      sourceKeys:
        - source_artifact:pmid-29849692
        - source_artifact:pmid-29048215
        - source_artifact:pmid-29269746
        - source_artifact:pmid-31126559
        - source_artifact:pmid-41461792
        - source_artifact:pmid-31293098
        - source_artifact:mayo-2018-sauna-review
        - source_artifact:pmid-34622026
        - source_artifact:nct-NCT06125639
        - source_artifact:pmid-25001587
        - source_artifact:pmid-2759081
        - source_artifact:pmid-31136202
        - source_artifact:pmid-3218894
        - source_artifact:pmid-33922289
        - source_artifact:pmid-34770018
        - source_artifact:pmid-36813265
        - source_artifact:pmid-38271083
        - source_artifact:doi-10.1155-2014-106049
        - source_artifact:pmid-29971466
        - source_artifact:pmid-24304490
        - source_artifact:pmid-31331560
        - source_artifact:doi-10.1080-23328940.2026.2645467
        - source_artifact:pmid-24511348
        - source_artifact:pmid-28378983
      defaultOpen: true
    -
      id: adjacent-passive-heat-context
      label: Adjacent passive-heat evidence
      stance: mixed
      summary: Hot-water immersion and broader passive-heat syntheses provide useful cardiovascular, metabolic, and thermal-load context, but they use different heat transfer, temperatures, durations, and populations. Keep them as plausibility and caution evidence rather than direct dry-sauna proof.
      sourceKeys:
        - source_artifact:pmid-41049507
        - source_artifact:pmid-41603269
        - source_artifact:pmid-27270841
        - source_artifact:pmid-31642205
        - source_artifact:pmid-40087302
        - source_artifact:pmid-32814462
        - source_artifact:pmid-33866630
        - source_artifact:doi-10.1016-j.aimed.2024.09.009
        - source_artifact:pmid-30335579
        - source_artifact:pmid-33792402
        - source_artifact:pmid-27857958
        - source_artifact:nct-NCT05618197
    -
      id: long-term-cohort-context
      label: Long-term cohort context
      stance: context_only
      summary: Large Finnish cohort and review sources link frequent sauna bathing with long-term health outcomes, which helps explain why sauna is interesting. These are mostly observational or broad-context sources and cannot prove a short Blueprint-style self-experiment caused a wearable or biomarker change.
      sourceKeys:
        - source_artifact:pmid-25706401
        - source_artifact:pmid-34158458
        - source_artifact:pmid-34363927
        - source_artifact:pmid-35908583
        - source_artifact:pmid-28905164
        - source_artifact:pmid-31102597
        - source_artifact:pmid-31372865
        - source_artifact:pmid-33426640
        - source_artifact:pmid-33797457
        - source_artifact:pmid-38836690
        - source_artifact:pmid-27932366
        - source_artifact:pmid-29209938
        - source_artifact:pmid-29229091
        - source_artifact:pmid-29897261
        - source_artifact:pmid-33088678
        - source_artifact:pmid-38410962
        - source_artifact:pmid-31590079
        - source_artifact:pmid-37270272
        - source_artifact:pmid-38577299
        - source_artifact:pmid-32951736
        - source_artifact:pmid-36255556
        - source_artifact:pmid-37029766
        - source_artifact:pmid-28972808
        - source_artifact:pmid-29551418
        - source_artifact:pmid-29720543
        - source_artifact:pmid-30077204
        - source_artifact:pmid-37248758
        - source_artifact:pmid-26436738
        - source_artifact:pmid-25705824
        - source_artifact:pmid-28633297
        - source_artifact:pmid-30486813
    -
      id: post-workout-training-context
      label: Post-workout, recovery, and performance evidence
      stance: mixed
      summary: The exercise-coupled literature is mixed: some post-exercise sauna and high-heat acclimation studies report cardiovascular or performance signals, while other recovery, HRV, hydration, gut, and neuromuscular studies are null or negative. This is why the protocol asks users to log training load, soreness, hydration, and next-workout performance.
      sourceKeys:
        - source_artifact:pmid-35785965
        - source_artifact:pmid-40611569
        - source_artifact:pmid-16877041
        - source_artifact:pmid-31490429
        - source_artifact:pmid-31869820
        - source_artifact:pmid-33211153
        - source_artifact:pmid-34297227
        - source_artifact:pmid-41032138
        - source_artifact:pmid-40104529
        - source_artifact:doi-10.2478-v10036-008-0028-4
        - source_artifact:pmid-26446307
        - source_artifact:pmid-37398966
        - source_artifact:pmid-32599642
        - source_artifact:pmid-39762944
        - source_artifact:pmid-34727008
        - source_artifact:pmid-35710395
        - source_artifact:pmid-38846523
        - source_artifact:pmid-26180741
        - source_artifact:pmid-29444412
        - source_artifact:pmid-22163272
        - source_artifact:doi-10.3390-app151910762
        - source_artifact:pmid-36078656
        - source_artifact:isrctn-ISRCTN48038929
        - source_artifact:nct-NCT04540718
        - source_artifact:nct-NCT04556422
        - source_artifact:pmid-29470824
        - source_artifact:pmid-35254558
      defaultOpen: true
    -
      id: heat-acclimation-and-heat-shock-context
      label: Heat acclimation and heat-shock context
      stance: context_only
      summary: Heat-acclimation and heat-shock-protein sources support mechanistic interest in repeated heat strain, plasma-volume adaptation, cytokines, and HSP expression. They are mostly exercise-heat, hot-water, or high-heat adjacent studies, so they should calibrate hypotheses rather than become Blueprint efficacy claims.
      sourceKeys:
        - source_artifact:pmid-33627275
        - source_artifact:pmid-36767447
        - source_artifact:pmid-25432420
        - source_artifact:pmid-34503795
        - source_artifact:pmid-11795467
        - source_artifact:pmid-27511024
        - source_artifact:pmid-31823288
        - source_artifact:pmid-34127636
        - source_artifact:pmid-34199101
        - source_artifact:pmid-27188431
        - source_artifact:pmid-17615280
    -
      id: measurement-and-wearable-context
      label: Wearable, sweat, and hydration measurement
      stance: context_only
      summary: Wearable HR, HRV, sweat, sodium, and hydration-method papers help interpret the measurements a self-experiment will rely on. They support logging device quality, sweat loss, fluids, electrolytes, and missing data, but they do not show the sauna protocol works.
      sourceKeys:
        - source_artifact:pmid-32047863
        - source_artifact:pmid-17277604
        - source_artifact:pmid-36016077
        - source_artifact:pmid-19541738
        - source_artifact:pmid-26708360
        - source_artifact:pmid-28332116
        - source_artifact:pmid-28538708
        - source_artifact:pmid-29420145
        - source_artifact:pmid-32748563
        - source_artifact:pmid-32897239
        - source_artifact:pmid-36081005
        - source_artifact:pmid-40834291
        - source_artifact:pmid-24436351
        - source_artifact:pmid-30855232
        - source_artifact:pmid-36376641
        - source_artifact:pmid-38131698
    -
      id: safety-fertility-cooling-boundary
      label: Fertility and groin-cooling boundary
      stance: safety_boundary
      summary: Independent semen and heat-stress literature makes the fertility caveat real, while Johnson's groin-cooling sources explain why his named routine includes an ice-pack tactic. Together they support a warning and an off-ramp, not a promise that groin cooling prevents sauna-related fertility effects.
      sourceKeys:
        - source_artifact:pmid-5891617
        - source_artifact:isrctn-ISRCTN94041896
        - source_artifact:pmid-3275550
        - source_artifact:pmid-35722894
        - source_artifact:pmid-36412227
        - source_artifact:pmid-41875434
        - source_artifact:pmid-6103260
        - source_artifact:pmid-1288761
        - source_artifact:pmid-16130271
        - source_artifact:pmid-22540417
        - source_artifact:pmid-25456164
        - source_artifact:pmid-2888735
        - source_artifact:pmid-3678498
        - source_artifact:pmid-39145501
        - source_artifact:pmid-3959246
        - source_artifact:pmid-3987927
        - source_artifact:pmid-9756281
        - source_artifact:uroweb-male-infertility-guideline-2026-04-27
        - source_artifact:x-bryan-johnson-ice-balls-2026-04-09
        - source_artifact:pmid-18076419
        - source_artifact:pmid-29928539
        - source_artifact:pmid-32787870
        - source_artifact:pmid-34553153
        - source_artifact:pmid-34729240
        - source_artifact:pmid-35924639
        - source_artifact:pmid-6471178
        - source_artifact:who-semen-manual-2021-07-27
        - source_artifact:pmid-11277880
        - source_artifact:pmid-27410176
        - source_artifact:pmid-6476971
        - source_artifact:pmid-9240266
        - source_artifact:pmid-9972494
        - source_artifact:bryanjohnson-posts-icing-protocol-2025-07-15
        - source_artifact:pmid-23654310
        - source_artifact:pmid-25652627
        - source_artifact:bryan-johnson-fertility-sauna-2025-06-19
        - source_artifact:bryan-johnson-sperm-health-protocol-2025-06-10
        - source_artifact:bryanjohnson-posts-sauna-heat-swimmers-2025-07-10
        - source_artifact:bryan-johnson-sauna-protocol-2026-01-28
        - source_artifact:pmid-23411620
      defaultOpen: true
    -
      id: clinical-cardiovascular-boundaries
      label: Clinical cardiovascular boundaries
      stance: safety_boundary
      summary: Hypertension, coronary disease, heart-failure, Waon-therapy, medication, and registry sources belong in a supervised clinical boundary. They help identify who needs medical review and why disease-population findings should not be generalized to a high-temperature consumer routine.
      sourceKeys:
        - source_artifact:nct-NCT07468344
        - source_artifact:pmid-10492315
        - source_artifact:pmid-26152773
        - source_artifact:pmid-2741821
        - source_artifact:pmid-37650138
        - source_artifact:pmid-7957149
        - source_artifact:pmid-32615263
        - source_artifact:pmid-15564698
        - source_artifact:pmid-22561416
        - source_artifact:pmid-22863164
        - source_artifact:pmid-10955262
        - source_artifact:pmid-30239008
        - source_artifact:nct-NCT03620539
        - source_artifact:pmid-34115020
        - source_artifact:pmid-20884178
        - source_artifact:pmid-11869837
        - source_artifact:pmid-29409954
        - source_artifact:pmid-11583886
    -
      id: general-sauna-safety-screening
      label: General heat and sauna safety
      stance: safety_boundary
      summary: General heat, sauna, pregnancy, medication, dehydration, alcohol, skin, and emergency-medicine sources support a conservative screen before a daily 200 F post-workout routine. They are safety and exclusion context, not evidence that the Blueprint protocol is safe for every user.
      sourceKeys:
        - source_artifact:doi-10.3390-jcm15051910
        - source_artifact:doi-10.1016-j.heliyon.2025.e43031
        - source_artifact:cdc-clinical-heat-pregnancy-2025-09-18
        - source_artifact:mothertobaby-fever-hyperthermia-pregnancy-2025-02-01
        - source_artifact:pmid-30800676
        - source_artifact:pmid-38425235
        - source_artifact:pmid-39513185
        - source_artifact:pmid-7112434
        - source_artifact:pmid-7260810
        - source_artifact:pmid-7589027
        - source_artifact:pmid-8299674
        - source_artifact:pmid-9571303
        - source_artifact:sccm-heat-stroke-guideline-2025-02-22
        - source_artifact:bryan-johnson-sauna-protocol-2026-01-28
        - source_artifact:cdc-heat-medications-2025-09-18
        - source_artifact:bryan-johnson-protocol-2026-01-23
        - source_artifact:cdc-heat-clinical-overview-2025-09-18
        - source_artifact:pmid-15703536
        - source_artifact:pmid-1640616
        - source_artifact:cdc-heat-older-adults-2024-06-25
        - source_artifact:pmid-1588256
        - source_artifact:pmid-29496695
        - source_artifact:pmid-19749613
        - source_artifact:pmid-18471223
        - source_artifact:pmid-36170473
        - source_artifact:pmid-1017928
        - source_artifact:pmid-11165553
        - source_artifact:pmid-11874249
        - source_artifact:pmid-1267582
        - source_artifact:pmid-3218897
        - source_artifact:pmid-38344040
        - source_artifact:pmid-37211472
        - source_artifact:facebook-bryan-johnson-sweat-electrolytes-2025-05-14
        - source_artifact:pmid-26381473
        - source_artifact:pmid-17473783
        - source_artifact:pmid-11834331
        - source_artifact:pmid-12075060
        - source_artifact:pmid-16871826
        - source_artifact:pmid-16998815
        - source_artifact:pmid-1853995
        - source_artifact:pmid-1882775
        - source_artifact:pmid-19506509
        - source_artifact:pmid-26566054
        - source_artifact:pmid-28748097
        - source_artifact:pmid-32219708
        - source_artifact:pmid-3538994
        - source_artifact:pmid-39660118
        - source_artifact:pmid-41228151
        - source_artifact:pmid-707206
        - source_artifact:pmid-9100952
        - source_artifact:pmid-3218903
        - source_artifact:pmid-3218901
      defaultOpen: true
    -
      id: adjacent-modality-boundaries
      label: Adjacent heat modalities
      stance: context_only
      summary: Far-infrared sauna, hot yoga, hot-water, steam, portable sauna, and modality-comparison sources help prevent false equivalence. They can explain why heat exposure is active and sometimes risky, but their results should not be merged into this dry-sauna protocol claim.
      sourceKeys:
        - source_artifact:pmid-27107927
        - source_artifact:pmid-40332494
        - source_artifact:pmid-22927272
        - source_artifact:pmid-41320841
        - source_artifact:pmid-24899780
        - source_artifact:pmid-37870668
        - source_artifact:pmid-37979477
        - source_artifact:pmid-41032153
        - source_artifact:pmid-19602651
        - source_artifact:pmid-26504475
        - source_artifact:pmid-32509120
        - source_artifact:pmid-34188383
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
    - heat_intolerance_or_prior_heat_illness
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
    - Source-attributed and higher-burden — interpret more cautiously than simpler dry-sauna protocols.
    - Groin cooling, face/neck cooling, and no-cold-after guidance are source-specific, not general rules.
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
