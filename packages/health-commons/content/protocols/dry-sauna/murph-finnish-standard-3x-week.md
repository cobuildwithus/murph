---
schemaVersion: "murph.commons.page.v1"
entityType: "protocol_variant"
key: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week"
slug: "protocols/dry-sauna/murph-finnish-standard-3x-week"
title: "Finnish Dry Sauna"
summary: "Traditional dry sauna at steady, tolerable heat, where the body opens blood vessels near the skin and the heart pumps harder to move heat out while defending core temperature."
status: "field-testing"
quality: "usable"
preferredRouteId: "finnish-sauna"
sortRank: 10
aliases:
  - "dry sauna protocol"
  - "Finnish sauna protocol"
  - "Finnish dry sauna experiment"
  - "traditional Finnish sauna experiment"
  - "3x weekly dry sauna experiment"
categories:
  - "passive-heat"
  - "sauna"
  - "recovery"
  - "cardiovascular"
  - "murph-canonical"
media:

  -
    kind: "image"
    relativePath: "design-assets/hero-finnish-sauna.jpeg"
    mediaType: "image/jpeg"
    caption: "Finnish Dry Sauna"
relations:

  -
    type: "parent_family"
    target: "experiment_family:dry-sauna"
  -
    type: "primary_biomarker"
    target: "biomarker:resting-heart-rate"
  -
    type: "secondary_biomarker"
    target: "biomarker:morning-blood-pressure"
  -
    type: "secondary_biomarker"
    target: "biomarker:hrv-rmssd"
  -
    type: "secondary_biomarker"
    target: "biomarker:sleep-efficiency"
  -
    type: "secondary_biomarker"
    target: "biomarker:deep-sleep-minutes"
lineage:
  relationship: "root"
  rationale: "Murph-owned default dry-sauna experiment kept separate from external named routines, infrared sauna, steam/wet heat, Waon therapy, cold-contrast routines, and post-exercise heat variants."
attribution:
  ownerType: "murph"
protocol:
  doseSignature: "3x/week · first-session tolerance check 5–10 min, then 15–20 min only if well tolerated · traditional dry sauna preferably ~80–90 °C; 100 °C is a high-end ceiling, not a goal · 21-day stand-alone dry-sauna experiment"
  target: "traditional dry sauna, preferably around 80–90 °C; use lower heat when new and do not chase 100 °C"
  frequency:
    sessionsPerWeek: 3
  durationMinutes:
    min: 5
    max: 20
  sessionShape:
    label: One session
    segments:
      - label: settle
        kind: preparation
        durationMinutes: 2
      - label: sauna 80–100 °C
        kind: stimulus
        durationMinutes: 18
      - label: cool-down
        kind: cooldown
        durationMinutes: 3
    ticks:
      - label: "0"
        offsetMinutes: 0
      - label: "2 min"
        offsetMinutes: 2
      - label: "20 min"
        offsetMinutes: 20
      - label: "23 min"
        offsetMinutes: 23
  temperatureC:
    min: 70
    max: 90
  interventionSessionsMinimum: 4
  interventionSessionsTarget: 6
  steps:
    - "Pick a traditional dry sauna with safe ventilation, temperature control, timer, and easy exit; schedule cooldown time afterward."
    - "Start normally hydrated; avoid sauna after alcohol or recreational drugs; do not force large water or electrolyte doses."
    - "Use 5–10 min as first-session tolerance check; use 15–20 min later only when tolerated."
    - "Sit near the exit, lower bench when new; do not chase extreme discomfort, sweat, or core temperature."
    - "Leave immediately for any stop condition; early exit counts as valid data, not failure."
    - "Cool down gently before driving, exercise, hot showers, cold plunges, or bed; resume only fully alert and steady."
    - "Log dose, context, cooldown method, and symptoms the same day."
  tips:
    - "Start lower: 5–10 minutes, lower bench, easy exit. Add minutes only after easy sessions."
    - "Keep modality clean: traditional dry sauna only. Log heavy steam from water on rocks, unusual humidity, or hotter rooms."
    - "Arrive normally hydrated. Skip alcohol, recreational drugs, dehydration, fever, vomiting, diarrhea, or brutal training days."
    - "No catch-up heat: never stack sessions, raise temperature, or extend duration to make up misses."
    - "Cool down gently before driving, exercise, hot showers, cold plunges, or bed."
    - "Shared sauna: towel barrier, clear exit, working ventilation. Leave if hygiene or setup feels off."
  keepInMind:
    - "This is a short self-experiment for practical recovery context and cardiovascular proxies, not a treatment plan or longevity proof."
    - "HRV and sleep-stage changes are exploratory and can be moved by illness, stress, alcohol, travel, and training load."
    - "Traditional Finnish sauna can include water on rocks and changing humidity, so log unusually heavy steam or humidity if it changes the feel of the session."
    - "Infrared sauna, steam rooms, Waon therapy, hot-water immersion, cold plunges, and high-heat daily routines are related but separate protocols."
  logFields:
    - "session_date"
    - "session_start_time"
    - "session_duration_minutes"
    - "first_session_tolerance_check_minutes"
    - "approximate_temperature_c"
    - "bench_level_or_position"
    - "standalone_or_postexercise"
    - "exercise_type_and_load_if_applicable"
    - "humidity_or_heavy_steam_if_notable"
    - "cool_down_method"
    - "time_until_fully_steady_and_alert"
    - "hydration_notes"
    - "pre_post_body_mass_if_already_tracking_hydration"
    - "alcohol_last_24h"
    - "caffeine_stimulant_sedative_or_recreational_substance_context"
    - "medication_dose_or_timing_change"
    - "illness_or_fever"
    - "travel_or_timezone_shift"
    - "ambient_heat_or_other_heat_exposure"
    - "hard_training_last_24h"
    - "cold_shower_cold_plunge_cold_swim_or_contrast_exposure"
    - "skin_irritation_rash_hives_burning_or_infection_context"
    - "menstrual_pregnancy_or_fertility_context_if_relevant"
    - "public_shared_sauna_hygiene_or_facility_issue"
    - "symptoms_during_or_after"
  sessionFieldIds:
  - session_date
  - session_start_time
  - session_duration_minutes
  - first_session_tolerance_check_minutes
  - approximate_temperature_c
  - bench_level_or_position
  - standalone_or_postexercise
  - exercise_type_and_load_if_applicable
  - humidity_or_heavy_steam_if_notable
  - cool_down_method
  - time_until_fully_steady_and_alert
  - hydration_notes
  - pre_post_body_mass_if_already_tracking_hydration
  - alcohol_last_24h
  - caffeine_stimulant_sedative_or_recreational_substance_context
  - medication_dose_or_timing_change
  - illness_or_fever
  - travel_or_timezone_shift
  - ambient_heat_or_other_heat_exposure
  - hard_training_last_24h
  - cold_shower_cold_plunge_cold_swim_or_contrast_exposure
  - skin_irritation_rash_hives_burning_or_infection_context
  - menstrual_pregnancy_or_fertility_context_if_relevant
  - public_shared_sauna_hygiene_or_facility_issue
  - symptoms_during_or_after
  stopConditions:
    - "Stop the session immediately for chest pain or pressure, faintness, severe dizziness, loss of balance, confusion, neurologic symptoms, palpitations, unusual shortness of breath, severe headache, vomiting, weakness, feeling unwell, panic-level distress, skin burning, heat-triggered itching, hives, rash flare, or feeling unsafe."
    - "Leave and cool down gently if heat feels stronger than expected, humidity or steam becomes overwhelming, or you cannot stay comfortable without forcing it."
    - "End the experiment and seek urgent care for loss of consciousness, chest pain, neurologic symptoms, severe shortness of breath, repeated vomiting, severe headache, heat-stroke-like symptoms, symptoms that do not resolve promptly after leaving, or any symptom pattern that repeats across sessions."
    - "Do not continue during fever, acute infection, vomiting, diarrhea, significant dehydration, recent heat illness, day-of alcohol or recreational drug use, or unusually impaired recovery after hard training."
testPlans:

  -
    planId: "rhr-21d"
    durationDays: 21
    baselineDays: 7
    interventionDays: 14
    primaryBiomarkerKey: "biomarker:morning-blood-pressure"
    secondaryBiomarkerKeys:
      - "biomarker:resting-heart-rate"
      - "biomarker:hrv-rmssd"
      - "biomarker:sleep-efficiency"
      - "biomarker:deep-sleep-minutes"
    minimumAdherenceSessions: 4
    targetAdherenceSessions: 6
    notes:
      - "Compare intervention-window averages against the user’s own 7-day baseline instead of highlighting single-session spikes."
      - "Treat morning blood pressure as optional but valuable when a validated home cuff and consistent routine are available."
      - "Keep HRV and sleep-stage markers exploratory unless the personal signal is strong, repeated, and not obviously confounded."
      - "Keep stand-alone sauna and post-exercise sauna interpretations separate whenever workout context is materially different."
expectedSignalDescriptions:

  -
    biomarkerKey: "biomarker:morning-blood-pressure"
    expected: "Small drop possible"
    expectedDirection: "down_or_stable"
    protocolProminence: "focus"
    displayValue: "Up to 5 mmHg lower"
    estimatedChange:
      kind: "absolute"
      low: -5
      high: 0
      unit: "mmHg"
      window: "2-6 weeks"
      confidence: "low"
      basis: "Short-term sauna-treatment meta-analysis reported about -5 mmHg systolic and -4 mmHg diastolic BP over 2-4 weeks in mostly clinical or adjacent protocols; direct Finnish-sauna physiology shows acute BP movement, but the Murph dose is shorter and healthier-user oriented."
    description: "Heat opens skin blood vessels and lowers vascular resistance, training morning vessel tone to relax after repeated tolerable sessions."
  -
    biomarkerKey: "biomarker:resting-heart-rate"
    expected: "Small change possible"
    expectedDirection: "mixed_or_contextual"
    protocolProminence: "focus"
    estimatedChange:
      kind: "absolute"
      low: -3
      high: 1
      unit: "bpm"
      window: "2-6 weeks"
      confidence: "low"
      basis: "Acute sauna raises heart rate during heat exposure; repeated passive-heat evidence suggests small resting-pulse reductions, but direct dry-sauna RCT evidence for consumer RHR is mixed."
    description: "Sauna raises heart rate during heat exposure; repeat tolerance lowers resting strain after recovery."
  -
    biomarkerKey: "biomarker:hrv-rmssd"
    expected: "May rise or fall"
    expectedDirection: "mixed_or_contextual"
    protocolProminence: "context"
    estimatedChange:
      kind: "mixed_or_contextual"
      window: "2-6 weeks"
      confidence: "low"
      basis: "Closest direct 3x/week dry-sauna trial used frequency-domain HRV in allergic-rhinitis patients, not RMSSD; passive-heating reviews show protocol-dependent sympathetic and vagal effects."
    description: "Heat raises sympathetic drive; calm cooldown restores vagal control, while dehydration, late timing, and stacked training suppress RMSSD."
  -
    biomarkerKey: "biomarker:sleep-efficiency"
    expected: "Could rise slightly"
    expectedDirection: "up_or_stable"
    protocolProminence: "context"
    estimatedChange:
      kind: "absolute"
      low: 0
      high: 3
      unit: "%"
      window: "2-3 weeks"
      confidence: "low"
      basis: "Adjacent warm bath/shower passive-heating meta-analysis supports better sleep efficiency from a warm-to-cool transition; extracted Finnish-sauna sources do not provide a direct estimate."
    description: "Sauna plus enough cooldown creates a warm-to-cool drop that supports settling and reduces wake time."
  -
    biomarkerKey: "biomarker:deep-sleep-minutes"
    expected: "Algorithm-sensitive"
    expectedDirection: "mixed_or_contextual"
    protocolProminence: "context"
    estimatedChange:
      kind: "mixed_or_contextual"
      window: "2-3 weeks"
      confidence: "low"
      basis: "No extracted direct Finnish-sauna finding supports a deep-sleep gain; consumer deep-sleep estimates depend on heart-rate, HRV, temperature, and movement proxies that sauna can perturb."
    description: "Sauna shifts overnight temperature, pulse, and movement patterns, changing how stable early-night deep sleep becomes."
  -
    biomarkerKey: "biomarker:rem-sleep-minutes"
    expected: "Algorithm-sensitive"
    expectedDirection: "mixed_or_contextual"
    protocolProminence: "context"
    estimatedChange:
      kind: "mixed_or_contextual"
      window: "2-3 weeks"
      confidence: "low"
      basis: "The direct Finnish-sauna evidence in this Commons set does not establish a REM-minutes effect; consumer REM estimates can move when total sleep, wake time, thermoregulation, or fragmentation changes."
    description: "Heat exposure changes relaxation, thermoregulation, and sleep continuity for some people, but REM minutes are not the direct target and can move in either direction."
  -
    biomarkerKey: "biomarker:blood-oxygen-spo2"
    expected: "Should stay stable"
    expectedDirection: "stable"
    protocolProminence: "context"
    estimatedChange:
      kind: "mixed_or_contextual"
      window: "session and overnight checks"
      confidence: "low"
      basis: "Sauna is not an oxygenation intervention; SpO2 belongs here as safety context for heat stress, dehydration, illness, or respiratory strain."
    description: "Sauna is a heat-stress and recovery experiment, not an oxygenation intervention; stable SpO2 is a guardrail rather than proof the protocol is working."
  -
    biomarkerKey: "biomarker:blood-glucose"
    expected: "Context-dependent"
    expectedDirection: "mixed_or_contextual"
    protocolProminence: "context"
    estimatedChange:
      kind: "mixed_or_contextual"
      window: "2-6 weeks"
      confidence: "low"
      basis: "Passive heat can change autonomic tone, hydration, and recovery context, but this Commons set does not support Finnish sauna as a validated glucose-lowering self-test."
    description: "Passive heat can change autonomic tone, hydration, and recovery context, but dehydration or heat stress can also confound glucose readings."
  -
    biomarkerKey: "biomarker:estimated-vo2max"
    expected: "Context-dependent"
    expectedDirection: "mixed_or_contextual"
    protocolProminence: "context"
    estimatedChange:
      kind: "mixed_or_contextual"
      window: "4-8 weeks"
      confidence: "low"
      basis: "Repeated heat exposure can create cardiovascular strain, but this protocol is not a direct aerobic-capacity intervention and should stay below aerobic training for VO2max interpretation."
    description: "Repeated heat exposure can create cardiovascular strain and recovery adaptations, but it is not a direct aerobic-capacity protocol."
experimentOnboarding:
  schemaVersion: "murph.commons.experiment-onboarding.v2"
  startIntent:
    displayPrompt: "Hey Murph, I want to explore doing the Finnish dry sauna protocol."
    intentSummary: "Explore Finnish Dry Sauna"
  safetyScreen:
    dispositionIfAnyPositive: "clinician_guidance_before_unsupervised_start"
    mustAsk:
      - id: "cardiovascular_or_fainting_risk"
        prompt: "Any chest pain, fainting, significant dizziness, unstable blood pressure, known serious heart rhythm issue, heart failure, ischemic heart disease, recent cardiac event, peripheral arterial disease, or clinician advice to avoid heat?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "pregnancy_or_fertility_context"
        prompt: "Are you pregnant, possibly pregnant, trying to become pregnant, early postpartum, or actively protecting fertility or sperm markers?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "opioid_patch_or_transdermal_heat_risk"
        prompt: "Are you using a fentanyl, buprenorphine, or other transdermal opioid patch, or any medication patch with heat warnings?"
        ifPositive: "do_not_start_unsupervised_explicit_clinician_clearance_required"
      - id: "medication_or_substance_risk"
        prompt: "Any diuretics, blood-pressure medicines, beta blockers, anticholinergics, psychotropics, sedatives, stimulants, antiseizure medicines, lithium, insulin or other heat-sensitive medications, recreational drugs, or alcohol use planned before or after sauna?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "clinical_heat_risk_conditions"
        prompt: "Any diabetes, kidney disease, seizure disorder, asthma, COPD, chronic respiratory disease, heat intolerance, prior heat illness, skin condition that flares with heat or sweat, open wound, or active skin infection?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "acute_illness_or_dehydration"
        prompt: "Any fever, acute illness, recent heat exhaustion, dehydration, vomiting, diarrhea, or unusually hard training recovery right now?"
        ifPositive: "do_not_start_unsupervised"
  setupSlots:
    - id: "sauna_access"
      label: "Sauna access"
      question: "Do you have regular access to a traditional Finnish-style dry sauna for the next 2 weeks?"
      options:
        - "home_dry_sauna"
        - "gym_or_spa_dry_sauna"
        - "public_dry_sauna"
        - "infrared_or_steam_only"
        - "no_regular_access"
      target:
        object: "experimentRun"
        field: "saunaAccess"
    - id: "sauna_modality_match"
      label: "Modality match"
      question: "Can you keep this to a dry sauna around 80-100 C rather than infrared, steam, cold plunge, or mixed hot-cold sessions?"
      target:
        object: "experimentRun"
        field: "modalityMatch"
    - id: "usual_sauna_tolerance"
      label: "Usual sauna tolerance"
      question: "Have you used a sauna recently, and did it feel tolerable without dizziness, chest symptoms, or feeling unwell afterward?"
      options:
        - "recent_and_tolerated"
        - "recent_but_not_well_tolerated"
        - "not_recent"
        - "unsure"
      target:
        object: "onboardingCapture"
        field: "answers.usualSaunaTolerance"
    - id: "session_timing"
      label: "Session timing"
      question: "What 3 days or time windows could realistically work for sauna sessions?"
      constraints:
        sessionsPerWeek: 3
        avoidBackToBackWhenPossible: true
        defaultRunPlanSchedule:
          kind: "cron"
          expression: "0 18 * * 2,4,6"
          timeZone: "UTC"
        runPlanScheduleTimeZonePolicy: "replace_with_user_vault_timezone"
      target:
        object: "onboardingCapture"
        field: "answers.sessionTiming"
    - id: "standalone_context"
      label: "Session context"
      question: "Should we treat these as stand-alone sauna sessions, post-exercise sessions, or a mix we need to label carefully?"
      options:
        - "mostly_standalone"
        - "mostly_post_exercise"
        - "mixed_contexts"
      target:
        object: "experimentRun"
        field: "sessionContext"
    - id: "blood_pressure_tracking"
      label: "Morning blood pressure"
      question: "Do you already measure morning blood pressure with a home cuff, or should we keep blood pressure as optional context?"
      options:
        - "validated_home_cuff_available"
        - "cuff_available_but_inconsistent"
        - "no_home_cuff"
      constraints:
        optional: true
        askWhen: "if_unknown_or_stale"
      target:
        object: "analysisPlan"
        field: "morningBloodPressureMode"
    - id: "reminder_policy"
      label: "Reminder policy"
      question: "Would you like a reminder before planned sauna sessions, and should I ask once later that day if nothing is logged?"
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
    testPlanId: "rhr-21d"
    firstSessionGuidance: "Treat the first session as a tolerance check: 5–10 minutes or less is acceptable, use lower heat or a lower bench where possible, exit at the first concerning symptom, and do not add cold plunge, alcohol, recreational drugs, or hard exercise around the session."
    missedSessionGuidance: "Never make up a missed sauna by doubling duration, stacking sessions, or choosing hotter settings."
  adaptationPolicy:
    fields:
      - id: "modality"
        label: "Sauna modality"
        target:
          object: "protocol"
          field: "effectiveSpec.modality"
        sourceSlotIds:
          - "sauna_access"
          - "sauna_modality_match"
        requiredForRunSpec: true
        protocolReusable: true
        guidance: "Reuse a private protocol only when the available sauna is a traditional dry sauna rather than infrared, steam, or mixed hot-cold exposure."
      - id: "duration_minutes"
        label: "Session duration"
        target:
          object: "protocol"
          field: "effectiveSpec.durationMinutes"
        requiredForRunSpec: true
        protocolReusable: true
        guidance: "Keep the target session duration explicit, with early exits logged instead of treated as failure."
      - id: "temperature_c"
        label: "Temperature"
        target:
          object: "protocol"
          field: "effectiveSpec.temperatureC"
        sourceSlotIds:
          - "sauna_modality_match"
        requiredForRunSpec: true
        protocolReusable: true
        guidance: "Keep the dry-sauna temperature range explicit because lower heat, infrared, or steam changes the recipe."
      - id: "timing_context"
        label: "Timing context"
        target:
          object: "experimentRun"
          field: "timingContext"
        sourceSlotIds:
          - "session_timing"
          - "standalone_context"
        requiredForRunSpec: true
        protocolReusable: true
        guidance: "Store planned time windows and whether sessions are stand-alone, post-exercise, or mixed."
      - id: "measurement_plan"
        label: "Measurement plan"
        target:
          object: "analysisPlan"
          field: "measurementPlan"
        sourceSlotIds:
          - "blood_pressure_tracking"
        requiredForRunSpec: true
        protocolReusable: true
        guidance: "Resting heart rate remains the required primary signal; morning blood pressure and wearable recovery or sleep markers are optional context."
    measurementPlan:
      testPlanId: "rhr-21d"
      requiredSignals:
        - "biomarker:resting-heart-rate"
      optionalSignals:
        - "biomarker:morning-blood-pressure"
        - "biomarker:hrv-rmssd"
        - "biomarker:sleep-efficiency"
        - "biomarker:deep-sleep-minutes"
      notes:
        - "Use the same baseline and intervention windows as the selected test plan."
        - "Treat blood pressure as optional unless the user already has a consistent home-cuff routine."
    reusableSetup:
      enabled: true
      target:
        object: "protocol"
        field: "setupSnapshot"
      sourceSlotIds:
        - "sauna_access"
        - "sauna_modality_match"
        - "session_timing"
        - "standalone_context"
        - "blood_pressure_tracking"
      notes:
        - "Reuse the setup only when the dry-sauna modality, planned frequency, session context, and measurement plan still match the user’s current situation."
  trackingHints:
    confounderFields:
      - "illness_or_fever"
      - "alcohol_last_24h"
      - "caffeine_stimulant_sedative_or_recreational_substance_context"
      - "hard_training_last_24h"
      - "travel_or_timezone_shift"
      - "ambient_heat_or_other_heat_exposure"
      - "major_bedtime_change"
      - "major_diet_change"
      - "new_supplement_or_medication_change"
      - "medication_dose_or_timing_change"
      - "cold_shower_cold_plunge_cold_swim_or_contrast_exposure"
      - "public_shared_sauna_hygiene_or_facility_issue"
    notes:
      - "Keep stand-alone and post-exercise sauna interpretation separate whenever workout context could explain the recovery story."
      - "Do not require pre/post body-mass logging unless the user already tracks hydration that way."
  supportHints:
    missedLogFollowupCopy: "Did you end up doing today’s sauna session? Totally fine either way, I just want the experiment record to be accurate."
whyItWorks:
  - "## Heat forces redistribution\n\nDry sauna loads the body without muscle work. Skin vessels open; sweat carries heat out; heart rate rises; blood shifts outward. The stress is circulation and thermoregulation, not fitness effort."
  - "## Cooldown makes dose usable\n\n5–20 min works because heat stress needs an exit. Gentle cooldown restores pressure, temperature, fluid balance, and alertness; rushing into driving, exercise, cold plunge, or bed turns heat into strain."
  - "## Repeated heat trains vascular control\n\nAcross sessions, the body gets faster at dumping heat: earlier sweating, easier skin blood flow, steadier pressure. Resting HR plus morning BP track whether baseline strain drops."
  - "## Sleep signal comes from cooling\n\nSauna is not a sedative. The useful sleep mechanism is the warm-to-cool transition after a tolerable session; late, extreme, or dehydrating heat keeps arousal high."
mechanismChain:
  -
    label: "Session"
    content: "3x/week dry heat · 5–20 min · tolerable cooldown"
  -
    label: "Heat load"
    content: "Skin vessels open; heart rate rises; sweat carries heat out"
  -
    label: "Recovery"
    content: "Cooldown restores pressure, temperature, fluid balance, and alertness"
  -
    label: "Adaptation"
    content: "Earlier sweating · steadier vascular tone · lower resting strain"
claims:

  -
    claimId: "dry-sauna-evidence-broad-but-mixed"
    type: "evidence_scope"
    text: "Dry-sauna research is broad enough to justify a bounded self-test, but the evidence varies by modality, temperature, humidity, session context, population, and endpoint."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-16871826"
      - "source_artifact:pmid-29849692"
      - "source_artifact:pmid-30077204"
      - "source_artifact:pmid-34363927"
      - "source_artifact:pmid-38577299"
    caveats:
      - "The exact Murph 3x/week, 21-day design is a practical protocol, not a named clinical trial."
      - "Review-level evidence should not be converted into guaranteed personal outcomes."
  -
    claimId: "near-term-cardiovascular-proxies-are-practical-targets"
    type: "design_guardrail"
    text: "Resting heart rate and optional morning blood pressure are practical short-horizon signals to track, not promised outcomes; HRV, sleep-stage, immune, vascular, and lab markers remain exploratory or adjacent."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:doi-10.1080-23328940.2026.2645467"
      - "source_artifact:pmid-23859414"
      - "source_artifact:pmid-24511348"
      - "source_artifact:pmid-2830109"
      - "source_artifact:pmid-29450979"
      - "source_artifact:pmid-30827125"
      - "source_artifact:pmid-31102877"
      - "source_artifact:pmid-3218894"
      - "source_artifact:pmid-3218896"
      - "source_artifact:pmid-3218898"
      - "source_artifact:pmid-33513711"
      - "source_artifact:pmid-33710173"
      - "source_artifact:pmid-33866630"
      - "source_artifact:pmid-34269334"
      - "source_artifact:pmid-34770018"
      - "source_artifact:pmid-36343372"
      - "source_artifact:pmid-39657954"
      - "source_artifact:pmid-41049507"
      - "source_artifact:pmid-41166412"
    caveats:
      - "Acute heart-rate and blood-pressure changes do not prove lower resting heart rate or durable blood-pressure improvement."
      - "Morning blood-pressure interpretation requires a consistent home-cuff routine."
      - "HRV and sleep-stage markers are noisy and heavily confounded."
      - "RCT-only passive-heating synthesis preserved mostly null cardiometabolic, resting-heart-rate, and HRV findings; warm-bath sleep evidence is adjacent, not dry-sauna sleep proof."
  -
    claimId: "repeated-heat-is-plausible-but-not-guaranteed"
    type: "mechanistic"
    text: "Repeated tolerable heat exposure is biologically plausible as a thermoregulatory and vascular stressor, but the best personal read is still adherence, tolerability, and baseline-versus-intervention signals."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-16871826"
      - "source_artifact:pmid-25943654"
      - "source_artifact:pmid-30618849"
      - "source_artifact:pmid-41166412"
    caveats:
      - "Adjacent heat-acclimation and passive-heating literature includes non-sauna modalities and athlete or clinical populations."
      - "A plausible mechanism does not define an optimal dose for every user."
  -
    claimId: "standalone-and-postexercise-contexts-should-be-separated"
    type: "design_guardrail"
    text: "Stand-alone sauna and post-exercise sauna should be logged and interpreted separately because exercise, dehydration, and recovery context can change the signal."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-28035584"
      - "source_artifact:pmid-34727008"
      - "source_artifact:pmid-39762944"
      - "source_artifact:pmid-41032138"
    caveats:
      - "Post-exercise heat may be useful for some goals, but it is not the same experiment as a stand-alone dry-sauna test."
  -
    claimId: "long-term-observational-context-is-not-a-21-day-endpoint"
    type: "association_not_causation"
    text: "Long-term observational and real-world findings are background context, not outcomes a short personal experiment can prove."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-31590079"
      - "source_artifact:pmid-37029766"
      - "source_artifact:pmid-37270272"
    caveats:
      - "Observational evidence cannot prove an individual causal benefit."
      - "The available extraction set did not recover every major Finnish cohort source, so long-term disease framing should remain conservative."
  -
    claimId: "modality-boundaries-matter"
    type: "design_guardrail"
    text: "Finnish dry sauna, steam or wet heat, infrared sauna, Waon therapy, hot-water immersion, cold plunges, and contrast routines should not be merged into one protocol claim."
    strength: "high"
    sourceKeys:
      - "source_artifact:acog-sauna-hot-tub-pregnancy-2026-04-27"
      - "source_artifact:cdc-heat-medications-2025-09-18"
      - "source_artifact:cdc-heat-pregnancy-2025-09-18"
      - "source_artifact:doi-10.16926-par.2023.11.07"
      - "source_artifact:fimea-opioid-patch-sauna-warning-2024-11-26"
      - "source_artifact:pmid-11165553"
      - "source_artifact:pmid-15703536"
      - "source_artifact:pmid-1640616"
      - "source_artifact:pmid-38577299"
      - "source_artifact:saunasociety-build-sauna-temperature-2026-04-27"
      - "source_artifact:saunasociety-faqs-2026-04-27"
      - "source_artifact:saunasociety-sauna-experience-2026-04-27"
    caveats:
      - "Adjacent modalities can inform mechanisms or safety but should stay labeled as adjacent evidence."
  -
    claimId: "safety-screening-should-lead-the-experiment"
    type: "safety"
    text: "Unsupervised sauna setup should screen for heat intolerance, pregnancy, cardiovascular symptoms, recent fainting or dehydration, medication risks, opioid patches, fertility goals, alcohol, fever, and severe symptoms before emphasizing possible benefits."
    strength: "high"
    sourceKeys:
      - "source_artifact:acog-sauna-hot-tub-pregnancy-2026-04-27"
      - "source_artifact:alberta-health-pool-standards-sauna-2017-11-03"
      - "source_artifact:bryan-johnson-sauna-protocol-2026-01-28"
      - "source_artifact:cdc-heat-medications-2025-09-18"
      - "source_artifact:cdc-heat-pregnancy-2025-09-18"
      - "source_artifact:doi-10.16926-par.2023.11.07"
      - "source_artifact:fimea-opioid-patch-sauna-warning-2024-11-26"
      - "source_artifact:linkedin-bryan-johnson-core-temp-2026-04-16"
      - "source_artifact:ncceh-sauna-safety-2026-01-16"
      - "source_artifact:pmid-1017928"
      - "source_artifact:pmid-11165553"
      - "source_artifact:pmid-1267582"
      - "source_artifact:pmid-15703536"
      - "source_artifact:pmid-1640616"
      - "source_artifact:pmid-16871826"
      - "source_artifact:dry-sauna-pmid-17473783"
      - "source_artifact:pmid-18525205"
      - "source_artifact:dry-sauna-pmid-19602651"
      - "source_artifact:pmid-23411620"
      - "source_artifact:pmid-23833705"
      - "source_artifact:pmid-25614882"
      - "source_artifact:pmid-25943653"
      - "source_artifact:pmid-27270841"
      - "source_artifact:pmid-29351426"
      - "source_artifact:pmid-29409954"
      - "source_artifact:pmid-29496695"
      - "source_artifact:pmid-31102597"
      - "source_artifact:pmid-3218897"
      - "source_artifact:pmid-3218900"
      - "source_artifact:pmid-3218901"
      - "source_artifact:dry-sauna-pmid-32217980"
      - "source_artifact:pmid-32740103"
      - "source_artifact:pmid-33586133"
      - "source_artifact:pmid-3788622"
      - "source_artifact:pmid-38344040"
      - "source_artifact:pmid-39513185"
      - "source_artifact:pmid-40134984"
      - "source_artifact:pmid-41426898"
      - "source_artifact:pmid-6476971"
      - "source_artifact:pmid-6501022"
      - "source_artifact:pmid-7260810"
      - "source_artifact:pmid-7589027"
      - "source_artifact:pmid-7957149"
      - "source_artifact:pmid-9010709"
      - "source_artifact:pmid-9100952"
      - "source_artifact:pmid-9571303"
      - "source_artifact:pmid-9972494"
      - "source_artifact:who-safe-recreational-water-environments-2006-01-02"
      - "source_artifact:x-bryan-johnson-fired-review-2026-04-06"
    caveats:
      - "General tolerability language does not clear unstable cardiovascular disease, pregnancy, high-risk medications, severe heat symptoms, or extreme-heat sessions."
      - "Fertility-related evidence is limited but important enough to disclose."
  -
    claimId: "temperature_duration_not_a_target"
    type: "safety"
    text: "Traditional dry sauna may occur around 80–90 °C, but this protocol should frame 100 °C and 20 minutes as upper bounds, not goals; first-session early exit is valid."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-16871826"
      - "source_artifact:infofinland-finnish-sauna-2025-04-11"
      - "source_artifact:pmid-1017928"
      - "source_artifact:pmid-1267582"
      - "source_artifact:pmid-38344040"
      - "source_artifact:saunologia-finnish-sauna-instructions-2018-01-10"
    caveats:
      - "Safety boundaries are routing rules for an unsupervised wellness experiment, not individualized medical advice."
  -
    claimId: "acute_stop_rules"
    type: "safety"
    text: "Chest pain, faintness, severe dizziness, confusion, palpitations, unusual shortness of breath, severe headache, vomiting, weakness, skin symptoms, panic, or feeling unsafe require immediate exit and may require care."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-1017928"
      - "source_artifact:pmid-38344040"
      - "source_artifact:ncceh-sauna-safety-2026-01-16"
      - "source_artifact:infofinland-finnish-sauna-2025-04-11"
    caveats:
      - "Safety boundaries are routing rules for an unsupervised wellness experiment, not individualized medical advice."
  -
    claimId: "opioid_patch_hard_stop"
    type: "safety"
    text: "Transdermal opioid patches and sauna/external heat require a hard-stop or explicit clinician-clearance boundary."
    strength: "high"
    sourceKeys:
      - "source_artifact:fimea-opioid-patch-sauna-warning-2024-11-26"
      - "source_artifact:pmid-32740103"
      - "source_artifact:pmid-9571303"
    caveats:
      - "Safety boundaries are routing rules for an unsupervised wellness experiment, not individualized medical advice."
  -
    claimId: "pregnancy_possible_pregnancy_boundary"
    type: "safety"
    text: "Pregnancy, possible pregnancy, trying to conceive, and early postpartum status require clinician-guided routing rather than an ordinary unsupervised wellness run."
    strength: "high"
    sourceKeys:
      - "source_artifact:acog-sauna-hot-tub-pregnancy-2026-04-27"
      - "source_artifact:cdc-heat-pregnancy-2025-09-18"
      - "source_artifact:pmid-15703536"
      - "source_artifact:pmid-1640616"
      - "source_artifact:pmid-29496695"
      - "source_artifact:dry-sauna-pmid-32217980"
    caveats:
      - "Safety boundaries are routing rules for an unsupervised wellness experiment, not individualized medical advice."
  -
    claimId: "medications_heat_interaction"
    type: "safety"
    text: "Medication classes that affect hydration, electrolytes, blood pressure, alertness, sweating, thermoregulation, skin blood flow, or heat tolerance require clinician or pharmacist review; users should not self-adjust medications for sauna."
    strength: "high"
    sourceKeys:
      - "source_artifact:cdc-heat-medications-2025-09-18"
      - "source_artifact:pmid-39513185"
      - "source_artifact:pmid-7589027"
      - "source_artifact:pmid-7957149"
      - "source_artifact:pmid-9010709"
      - "source_artifact:pmid-9571303"
    caveats:
      - "Safety boundaries are routing rules for an unsupervised wellness experiment, not individualized medical advice."
  -
    claimId: "hydration_fluid_loss_boundary"
    type: "safety"
    text: "Fever, vomiting, diarrhea, dehydration, recent heat illness, and heavy training recovery are postponement contexts; hydration should be logged without encouraging forced overhydration."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-3218894"
      - "source_artifact:pmid-3218897"
      - "source_artifact:pmid-25614882"
      - "source_artifact:pmid-34727008"
      - "source_artifact:saunologia-finnish-sauna-instructions-2018-01-10"
    caveats:
      - "Safety boundaries are routing rules for an unsupervised wellness experiment, not individualized medical advice."
  -
    claimId: "fertility_boundary"
    type: "safety"
    text: "Active fertility or sperm-marker goals require a caution boundary because sauna heat has limited, mixed, and population-specific reproductive evidence."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-23411620"
      - "source_artifact:pmid-9972494"
      - "source_artifact:pmid-6476971"
      - "source_artifact:pmid-29849692"
      - "source_artifact:pmid-18076419"
    caveats:
      - "Safety boundaries are routing rules for an unsupervised wellness experiment, not individualized medical advice."
  -
    claimId: "skin_shared_sauna_boundary"
    type: "safety"
    text: "Heat-triggered skin symptoms, open wounds, active infection, and shared-sauna hygiene concerns require screening, logging, and possible postponement."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-3218900"
      - "source_artifact:pmid-18525205"
      - "source_artifact:ncceh-sauna-safety-2026-01-16"
    caveats:
      - "Safety boundaries are routing rules for an unsupervised wellness experiment, not individualized medical advice."
  -
    claimId: "cold_plunge_separate_exposure"
    type: "safety"
    text: "Cold plunge, cold swimming, ice bath, and contrast therapy should remain separate exposures and confounders, not part of this dry-sauna protocol."
    strength: "high"
    sourceKeys:
      - "source_artifact:saunologia-finnish-sauna-instructions-2018-01-10"
      - "source_artifact:sauna-fi-health-effects-2026-04-27"
      - "source_artifact:pmid-9100952"
      - "source_artifact:doi-10.16926-par.2023.11.07"
    caveats:
      - "Safety boundaries are routing rules for an unsupervised wellness experiment, not individualized medical advice."
  -
    claimId: "clinical_variant_boundary"
    type: "safety"
    text: "Cardiovascular disease, PAD, heart failure, COPD/asthma/chronic respiratory disease, diabetes, kidney disease, seizure disorder, minors, frail users, and medication-managed users require separate clinician-guided variants because direct evidence is mismatched, supervised, observational, or adjacent."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-23859414"
      - "source_artifact:pmid-16871826"
      - "source_artifact:pmid-18522783"
      - "source_artifact:pmid-29409954"
      - "source_artifact:pmid-33587690"
      - "source_artifact:pmid-39819110"
      - "source_artifact:pmid-34808071"
      - "source_artifact:pmid-40134984"
      - "source_artifact:pmid-41426898"
      - "source_artifact:pmid-37029766"
    caveats:
      - "Safety boundaries are routing rules for an unsupervised wellness experiment, not individualized medical advice."
  -
    claimId: "alcohol_recreational_substance_boundary"
    type: "safety"
    text: "Alcohol and recreational substances should be treated as postponement or clinician-guidance contexts, not merely as interpretation confounders."
    strength: "high"
    sourceKeys:
      - "source_artifact:doi-10.3390-ijerph23030347"
      - "source_artifact:pmid-11165553"
      - "source_artifact:ncceh-sauna-safety-2026-01-16"
      - "source_artifact:cdc-heat-medications-2025-09-18"
    caveats:
      - "Safety boundaries are routing rules for an unsupervised wellness experiment, not individualized medical advice."
  -
    claimId: "external-named-routines-stay-external"
    type: "design_guardrail"
    text: "Huberman and Bryan Johnson or Blueprint routines should remain external-protocol context; their daily-dose, toxin, microplastic, fertility, vascular, core-temperature, and heat-shock-protein claims should not become Murph outcome promises."
    strength: "high"
    sourceKeys:
      - "source_artifact:bryan-johnson-morning-routine-2026-04-08"
      - "source_artifact:bryan-johnson-podcast-sauna-2025-06-26"
      - "source_artifact:bryan-johnson-sauna-protocol-2026-01-28"
      - "source_artifact:hubermanlab-deliberate-heat-exposure-2022-06-01"
      - "source_artifact:linkedin-bryan-johnson-core-temp-2026-04-16"
      - "source_artifact:protocol-bryanjohnson-sauna-2026-04-27"
      - "source_artifact:x-bryan-johnson-fired-review-2026-04-06"
    caveats:
      - "External web, podcast, social, and N-of-1 sources are not controlled efficacy evidence."
      - "Core-temperature threshold claims should not be converted into stop-rule-breaking encouragement."
researchLandscape:
  bottomLine: "Best read as a bounded dry-sauna self-experiment for tolerability, recovery context, and short-horizon cardiovascular proxies, not as proof of long-term disease prevention or a guarantee that HRV, vascular, immune, toxin, fertility, or sleep-stage markers will improve."
  confidenceLabel: "mixed"
  primaryClaim: "The practical support is strongest for tracking resting heart rate, optional morning blood pressure, session tolerance, symptoms, and context over repeated dry-sauna sessions, not for expecting a uniform improvement."
  mainCaveat: "The extracted evidence is heterogeneous, several adjacent intervention endpoints are mixed or null, major cohort findings are context only, and external high-heat routines should stay separate from the Murph canonical protocol."
  groups:

    -
      id: "evidence-backbone-and-claim-calibration"
      label: "Evidence reviews and claim guardrails"
      stance: "mixed"
      summary: "Reviews set the overall direction: sauna is physiologically active and plausible, but the evidence is mixed enough that claims should stay modest."
      sourceKeys:
        - "source_artifact:pmid-41049507"
        - "source_artifact:pmid-29849692"
        - "source_artifact:pmid-30077204"
        - "source_artifact:pmid-38577299"
        - "source_artifact:mayo-2018-sauna-review"
        - "source_artifact:pmid-16871826"
        - "source_artifact:pmid-11165553"
        - "source_artifact:pmid-34363927"
        - "source_artifact:doi-10.3390-ijerph23030347"
        - "source_artifact:sauna-1997-kauppinen-facts-and-fables-about-sauna"
        - "source_artifact:pmid-29351426"
        - "source_artifact:doi-10-1016-j-aimed-2024-09-009"
        - "source_artifact:sauna-1986-kauppinen-man-in-the-sauna-review-article"
        - "source_artifact:sauna-1988-eisalo-the-finnish-sauna-and-cardiovascular-diseases"
        - "source_artifact:sauna-2000-keast-the-finnish-sauna-bath-and-its-use-in-patients-with-cardio"
        - "source_artifact:sauna-1988-kukkonen-harjula-how-the-sauna-affects-the-endocrine-system"
        - "source_artifact:sauna-1988-laitinen-lungs-and-ventilation-in-the-sauna"
        - "source_artifact:pmid-31102597"
        - "source_artifact:pmid-33513711"
        - "source_artifact:pmid-37270272"
        - "source_artifact:pmid-40202605"
        - "source_artifact:pmid-41426898"
        - "source_artifact:doi-10-3389-fcvm-2025-1537194"
      defaultOpen: true
    -
      id: "dry_sauna_acute_thermoregulation"
      label: "Classic heat-response physiology"
      stance: "context_only"
      summary: "Older thermoregulation work explains the heat strain, sweating, heart-rate load, and cooldown needs behind the protocol."
      sourceKeys:
        - "source_artifact:pmid-3218894"
      defaultOpen: false
    -
      id: "near-term-autonomic-vascular-and-immune-signals"
      label: "Short-term physiology to track"
      stance: "mixed"
      summary: "Acute and repeated-session studies make pulse, blood pressure, HRV, sleep context, symptoms, and training context worth watching, without promising a uniform response."
      sourceKeys:
        - "source_artifact:pmid-23859414"
        - "source_artifact:pmid-29269746"
        - "source_artifact:pmid-34622026"
        - "source_artifact:doi-10.1080-23328940.2026.2645467"
        - "source_artifact:pmid-31126559"
        - "source_artifact:pmid-31331560"
        - "source_artifact:pmid-33866630"
        - "source_artifact:pmid-41049507"
        - "source_artifact:pmid-41166412"
        - "source_artifact:pmid-24511348"
        - "source_artifact:pmid-31293098"
        - "source_artifact:pmid-34770018"
        - "source_artifact:sauna-1989-kukkonen-harjula-haemodynamic-and-hormonal-responses-to-heat-exposure-in-a"
        - "source_artifact:pmid-36343372"
        - "source_artifact:pmid-3218896"
        - "source_artifact:sauna-1989-kauppinen-sauna-shower-and-ice-water-immersion-physiological-respons-2"
        - "source_artifact:pmid-3218898"
        - "source_artifact:pmid-33513711"
        - "source_artifact:pmid-34269334"
        - "source_artifact:pmid-30827125"
        - "source_artifact:sauna-1989-kauppinen-sauna-shower-and-ice-water-immersion-physiological-respons-3"
        - "source_artifact:pmid-33710173"
        - "source_artifact:pmid-29450979"
        - "source_artifact:pmid-39657954"
        - "source_artifact:pmid-2830109"
        - "source_artifact:pmid-32615263"
        - "source_artifact:pmid-3766176"
        - "source_artifact:pmid-3174262"
        - "source_artifact:pmid-36813265"
        - "source_artifact:pmid-31102877"
        - "source_artifact:pmid-32951736"
        - "source_artifact:pmid-33792402"
        - "source_artifact:pmid-26152773"
        - "source_artifact:pmid-31950931"
        - "source_artifact:pmid-24304490"
        - "source_artifact:pmid-3788622"
        - "source_artifact:pmid-3218894"
        - "source_artifact:pmid-38011189"
      defaultOpen: false
    -
      id: "intervention-design-training-and-mixed-results"
      label: "Repeated-use trials and mixed results"
      stance: "mixed"
      summary: "Intervention studies show useful signals alongside null or mixed results, especially when sauna is combined with exercise or clinical care."
      sourceKeys:
        - "source_artifact:pmid-40611569"
        - "source_artifact:pmid-25432420"
        - "source_artifact:pmid-37650138"
        - "source_artifact:pmid-35710395"
        - "source_artifact:sauna-2014-gryka-the-effect-of-sauna-bathing-on-lipid-profile-in-young-phys"
        - "source_artifact:pmid-39819110"
        - "source_artifact:pmid-30618849"
        - "source_artifact:pmid-32814462"
        - "source_artifact:pmid-35785965"
        - "source_artifact:sauna-2015-kanji-efficacy-of-regular-sauna-bathing-for-chronic-tension-type"
        - "source_artifact:sauna-1990-ernst-regular-sauna-bathing-and-the-incidence-of-common-colds"
        - "source_artifact:pmid-34727008"
        - "source_artifact:doi-10.3390-app151910762"
        - "source_artifact:pmid-18522783"
        - "source_artifact:pmid-41603269"
        - "source_artifact:pmid-25943654"
        - "source_artifact:pmid-33211153"
        - "source_artifact:pmid-28035584"
        - "source_artifact:pmid-31177835"
        - "source_artifact:pmid-32166103"
        - "source_artifact:pmid-33587690"
        - "source_artifact:pmid-34199101"
        - "source_artifact:pmid-34808071"
        - "source_artifact:pmid-31490429"
        - "source_artifact:sauna-2005-miyamoto-safety-and-efficacy-of-repeated-sauna-bathing-in-patients"
        - "source_artifact:pmid-19154844"
        - "source_artifact:pmid-31869820"
        - "source_artifact:pmid-34297227"
        - "source_artifact:pmid-41831305"
      defaultOpen: false
    -
      id: "post_exercise_heat_performance"
      label: "Post-exercise heat context"
      stance: "mixed"
      summary: "Athlete and recovery studies should be logged separately from stand-alone sauna because workout timing can change both benefit and risk signals."
      sourceKeys:
        - "source_artifact:pmid-39762944"
        - "source_artifact:pmid-41032138"
      defaultOpen: false
    -
      id: "cultural-practice-and-protocol-context"
      label: "How Finnish sauna is normally used"
      stance: "context_only"
      summary: "Practice guides define ordinary session behavior, beginner pacing, hydration, breaks, and exit-if-unwell rules; they are not efficacy evidence."
      sourceKeys:
        - "source_artifact:saunologia-finnish-sauna-instructions-2018-01-10"
        - "source_artifact:infofinland-finnish-sauna-2025-04-11"
        - "source_artifact:sauna-fi-guidelines-bathing-2026-04-27"
        - "source_artifact:sauna-fi-health-effects-2026-04-27"
      defaultOpen: false
    -
      id: "traditional-sauna-design-and-operation"
      label: "Sauna setup and operation"
      stance: "safety_boundary"
      summary: "Design and FAQ sources help set practical boundaries for temperature, humidity, ventilation, frequency, and home or community sauna use."
      sourceKeys:
        - "source_artifact:saunasociety-build-sauna-temperature-2026-04-27"
        - "source_artifact:saunasociety-faqs-2026-04-27"
      defaultOpen: false
    -
      id: "sauna-modality-definition-context"
      label: "What counts as Finnish sauna"
      stance: "context_only"
      summary: "Modality sources keep traditional Finnish sauna separate from steam rooms, infrared sauna, hot-water immersion, and contrast routines."
      sourceKeys:
        - "source_artifact:saunasociety-sauna-experience-2026-04-27"
      defaultOpen: false
    -
      id: "long-term-finnish-cohort-and-real-world-context"
      label: "Long-term population context"
      stance: "context_only"
      summary: "Finnish cohort and real-world studies give long-horizon context, but they should not be read as proof that a short self-experiment will prevent disease."
      sourceKeys:
        - "source_artifact:pmid-25705824"
        - "source_artifact:pmid-30486813"
        - "source_artifact:pmid-28633297"
        - "source_artifact:pmid-37270272"
        - "source_artifact:pmid-29720543"
        - "source_artifact:pmid-28972808"
        - "source_artifact:pmid-29897261"
        - "source_artifact:pmid-37029766"
        - "source_artifact:pmid-31590079"
        - "source_artifact:pmid-29229091"
        - "source_artifact:pmid-28905164"
        - "source_artifact:pmid-27932366"
        - "source_artifact:pmid-30173212"
        - "source_artifact:pmid-31372865"
        - "source_artifact:pmid-35908583"
        - "source_artifact:pmid-36255556"
        - "source_artifact:pmid-38410962"
        - "source_artifact:pmid-38836690"
        - "source_artifact:sauna-1989-markkola-sauna-habits-and-related-symptoms-in-finnish-children"
        - "source_artifact:pmid-39446139"
        - "source_artifact:pmid-41340471"
      defaultOpen: false
    -
      id: "safety-dose-modality-and-context-boundaries"
      label: "Safety, dose, and population boundaries"
      stance: "safety_boundary"
      summary: "Safety and special-population sources set the strongest rules: screen risk, keep dose conservative, hydrate, avoid alcohol and unsafe medications, and stop early when symptoms appear."
      sourceKeys:
        - "source_artifact:fimea-opioid-patch-sauna-warning-2024-11-26"
        - "source_artifact:acog-sauna-hot-tub-pregnancy-2026-04-27"
        - "source_artifact:pmid-32740103"
        - "source_artifact:cdc-heat-medications-2025-09-18"
        - "source_artifact:cdc-heat-pregnancy-2025-09-18"
        - "source_artifact:pmid-39513185"
        - "source_artifact:pmid-15703536"
        - "source_artifact:pmid-1640616"
        - "source_artifact:pmid-38344040"
        - "source_artifact:sauna-1988-eisalo-the-finnish-sauna-and-cardiovascular-diseases"
        - "source_artifact:pmid-9571303"
        - "source_artifact:dry-sauna-pmid-32217980"
        - "source_artifact:pmid-7589027"
        - "source_artifact:pmid-29496695"
        - "source_artifact:pmid-23411620"
        - "source_artifact:bryan-johnson-sauna-protocol-2026-01-28"
        - "source_artifact:pmid-1017928"
        - "source_artifact:pmid-11165553"
        - "source_artifact:pmid-31102597"
        - "source_artifact:pmid-41461792"
        - "source_artifact:sauna-2000-keast-the-finnish-sauna-bath-and-its-use-in-patients-with-cardio"
        - "source_artifact:pmid-1267582"
        - "source_artifact:pmid-29351426"
        - "source_artifact:pmid-16871826"
        - "source_artifact:pmid-19154844"
        - "source_artifact:pmid-24899780"
        - "source_artifact:pmid-3218897"
        - "source_artifact:pmid-3788622"
        - "source_artifact:pmid-33586133"
        - "source_artifact:pmid-34727008"
        - "source_artifact:sauna-2005-miyamoto-safety-and-efficacy-of-repeated-sauna-bathing-in-patients"
        - "source_artifact:pmid-3218901"
        - "source_artifact:doi-10.16926-par.2023.11.07"
        - "source_artifact:pmid-7260810"
        - "source_artifact:pmid-9100952"
        - "source_artifact:pmid-25614882"
        - "source_artifact:dry-sauna-pmid-17473783"
        - "source_artifact:pmid-26152773"
        - "source_artifact:pmid-27270841"
        - "source_artifact:pmid-9972494"
        - "source_artifact:pmid-41426898"
        - "source_artifact:pmid-29409954"
        - "source_artifact:pmid-7957149"
        - "source_artifact:pmid-40134984"
        - "source_artifact:dry-sauna-pmid-19602651"
        - "source_artifact:pmid-18076419"
        - "source_artifact:pmid-25943653"
        - "source_artifact:pmid-6476971"
        - "source_artifact:sauna-1992-roine-alcohol-and-sauna-bathing-effects-on-cardiac-rhythm-blood"
        - "source_artifact:pmid-23833705"
        - "source_artifact:pmid-9010709"
        - "source_artifact:pmid-3218900"
        - "source_artifact:pmid-18525205"
        - "source_artifact:pmid-6501022"
        - "source_artifact:sauna-1994-kukkonen-harjula-cardiovascular-effects-of-atenolol-scopolamine-and-their-c"
        - "source_artifact:pmid-30800676"
        - "source_artifact:sauna-1996-vanakoski-effects-of-heat-exposure-in-a-finnish-sauna-on-the-pharmac"
        - "source_artifact:pmid-445022"
        - "source_artifact:sauna-1989-markkola-sauna-habits-and-related-symptoms-in-finnish-children"
        - "source_artifact:sauna-1989-kauppinen-sauna-shower-and-ice-water-immersion-physiological-respons-2"
        - "source_artifact:sauna-1990-jokinen-children-in-sauna-cardiovascular-adjustment"
        - "source_artifact:sauna-1989-kauppinen-sauna-shower-and-ice-water-immersion-physiological-respons-3"
        - "source_artifact:sauna-1991-jokinen-children-in-sauna-electrocardiographic-abnormalities"
        - "source_artifact:pmid-3218892"
        - "source_artifact:sauna-1988-kukkonen-harjula-how-the-sauna-affects-the-endocrine-system"
        - "source_artifact:sauna-1988-laitinen-lungs-and-ventilation-in-the-sauna"
        - "source_artifact:sauna-1989-kauppinen-sauna-shower-and-ice-water-immersion-physiological-respons"
        - "source_artifact:sauna-1989-kauppinen-some-endocrine-responses-to-sauna-shower-and-ice-water-imm"
        - "source_artifact:pmid-36078656"
      defaultOpen: true
    -
      id: "operational-public-sauna-safety"
      label: "Public sauna safety"
      stance: "safety_boundary"
      summary: "Facility and public-health guidance covers cleaning, signage, temperature controls, monitoring, and shared-space hazards."
      sourceKeys:
        - "source_artifact:ncceh-sauna-safety-2026-01-16"
        - "source_artifact:alberta-health-pool-standards-sauna-2017-11-03"
        - "source_artifact:who-safe-recreational-water-environments-2006-01-02"
      defaultOpen: false
    -
      id: "external-protocol-claims"
      label: "External protocol claims"
      stance: "context_only"
      summary: "Named public routines are useful comparison points, but their self-experiment claims should not become Murph outcome promises."
      sourceKeys:
        - "source_artifact:bryan-johnson-sauna-protocol-2026-01-28"
        - "source_artifact:x-bryan-johnson-fired-review-2026-04-06"
        - "source_artifact:hubermanlab-deliberate-heat-exposure-2022-06-01"
        - "source_artifact:protocol-bryanjohnson-sauna-2026-04-27"
        - "source_artifact:bryan-johnson-podcast-sauna-2025-06-26"
      defaultOpen: false
    -
      id: "external-protocol-dose-context"
      label: "External high-heat dose context"
      stance: "context_only"
      summary: "High-heat public routines can inform what to log, but they should not change the default dose or encourage threshold chasing."
      sourceKeys:
        - "source_artifact:bryan-johnson-morning-routine-2026-04-08"
      defaultOpen: false
    -
      id: "core-temperature-measurement-context"
      label: "Core-temperature measurement context"
      stance: "mixed"
      summary: "Core-temperature posts are useful for measurement context, not for turning a 39 C target or heat-shock-protein threshold into a requirement."
      sourceKeys:
        - "source_artifact:x-bryan-johnson-fired-review-2026-04-06"
        - "source_artifact:linkedin-bryan-johnson-core-temp-2026-04-16"
      defaultOpen: false
    -
      id: "heat-tolerance-safety-boundaries"
      label: "Extreme heat tolerance boundary"
      stance: "safety_boundary"
      summary: "Reports of painful or panic-level high-heat attempts support clear stop rules and gradual progression."
      sourceKeys:
        - "source_artifact:x-bryan-johnson-fired-review-2026-04-06"
        - "source_artifact:linkedin-bryan-johnson-core-temp-2026-04-16"
      defaultOpen: false
safety:
  cautionLevel: "high"
  avoidOrGetClinicianGuidance:
    - pregnancy_or_early_postpartum
    - active_fertility_or_sperm_concerns
    - transdermal_opioid_or_medication_patches
    - unstable_cardiovascular_disease
    - recent_cardiac_event
    - unexplained_chest_pain
    - serious_arrhythmia
    - heart_failure
    - ischemic_heart_disease
    - peripheral_arterial_disease
    - uncontrolled_blood_pressure
    - prior_fainting_with_heat
    - diabetes
    - kidney_disease
    - seizure_disorder
    - chronic_respiratory_disease_or_copd
    - heat_intolerance_or_prior_heat_illness
    - fever_or_acute_illness
    - significant_dehydration
    - medications_affecting_thermoregulation
    - alcohol_or_recreational_drugs_same_day
    - heat_triggered_skin_conditions
    - open_wounds_or_skin_infection
    - children_or_frail_older_adults
  stopIf:
    - "chest pain or pressure"
    - "faintness, severe dizziness, loss of balance, or weakness"
    - "confusion or neurologic symptoms"
    - "palpitations or unusual shortness of breath"
    - "severe headache, vomiting, or symptoms that do not resolve promptly after leaving the sauna"
    - "skin burning, heat-triggered itching, hives, rash flare, or painful irritation"
    - "panic-level distress or feeling unsafe"
  notes:
    - "Safety beats adherence — leaving early is a valid logged outcome."
    - "Never chase extreme heat, a sweat target, or a core-temperature threshold."
    - "Skip sessions after same-day alcohol or recreational drugs — hydration does not compensate."
    - "Never adjust medications for sauna — medication and fluid plans belong with a clinician."
    - "Fertility, pregnancy, medication, skin, respiratory, kidney, seizure, diabetes, or cardiovascular concerns pause unsupervised setup."
researchCoverage:
  canonicalLedgerPath: "output-packages/research/finnish-dry-sauna-research-restart-20260427/downloads/11-source-ledger-reducer/canonical_source_ledger_v1.json"
  ledgerSourceCount: 265
  usableExtractionBatches:
    - "batch-004"
    - "batch-005"
    - "batch-006"
    - "batch-009"
    - "batch-010"
    - "batch-012-inline"
  skippedOrUnavailableBatches:
    - "batch-001 unavailable extraction JSON"
    - "batch-002 cold-water/cold-plunge mismatch"
    - "batch-003 unavailable extraction JSON"
    - "batch-007 contaminated by prolonged-fasting thread"
    - "batch-008 cold-water/cold-plunge mismatch"
    - "batch-011 unavailable extraction JSON"
  usableAppraisalCount: 108
  usableSourceFindingCount: 158
  usableSourcePageCount: 104
  sourceExtractionRunLimitNote: "All source-extraction runs used by this package remained within the <=40-source-record cap; final landing reducer performed no new source extraction."
---

## Question this experiment answers

After a stable baseline, does a traditional **Finnish dry-sauna** routine change tolerability, recovery context, sleep context, resting pulse, or morning blood-pressure signals enough to be worth keeping?

## Simple version

Use a traditional dry sauna, keep the routine repeatable, and compare averages from the baseline window with the intervention window. The useful read is not a dramatic single-session spike; it is whether the routine was tolerable, completed often enough, and produced a signal that is not better explained by illness, travel, alcohol, training load, or another new intervention.

## What to watch

The clearest downstream signals are morning blood pressure, when the user already has a consistent home-cuff routine, and resting heart rate from the same wearable or quiet-morning method. A small BP drop or modest resting-pulse shift is more interpretable than session completion. HRV/RMSSD, sleep efficiency, and deep-sleep minutes can explain timing and recovery context, but heat load, cooldown, hydration, training, alcohol, and device algorithms can dominate those signals.

## What to log

Log the session dose, first-session tolerance duration when relevant, bench or position, time of day, whether it followed exercise, cool-down method, any notable humidity or heavy steam, hydration context, alcohol or substance context, illness, travel, ambient heat, hard training, skin or safety symptoms, and any facility issue. Missing context does not erase the experiment, but it should make the interpretation more cautious.

## What this does not test

This experiment does not test mortality, dementia, stroke, kidney outcomes, cancer, pneumonia, toxin removal, microplastic reduction, fertility preservation, heat-shock-protein thresholds, or long-term disease incidence. Those topics belong in background evidence, external-protocol context, or future specialized protocols, not in the result promise for this short personal test.

## Evidence snapshot

The evidence map includes dry-sauna reviews, acute Finnish-sauna physiology, adjacent passive-heat and heat-acclimation studies, post-exercise heat boundary sources, home blood-pressure measurement guidance, pregnancy and medication safety sources, fertility caution sources, public-sauna operational guidance, and external named protocol claims. That mix makes the experiment plausible to run with careful tracking, but it also keeps the claim conservative: personal signals first, safety first, and no guarantee that every marker improves.
