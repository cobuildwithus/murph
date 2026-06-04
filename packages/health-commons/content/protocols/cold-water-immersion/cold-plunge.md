---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:cold-water-immersion/cold-plunge
slug: protocols/cold-water-immersion/cold-plunge
title: Cold Plunge
summary: Brief head-out immersion in measured cold water, where sudden cold forces a noradrenaline surge and drives blood inward to defend core temperature.
status: field-testing
quality: usable
aliases:
- cold plunge
- cold-water immersion
- cold water immersion
- CWI
- ice bath
- cold tub
- deliberate cold exposure
categories:
- cold-water-immersion
- cold-plunge
- recovery
- mood
- autonomic
- safety-first
- murph-canonical
media:
- kind: image
  relativePath: design-assets/cold-plunge-tub.jpeg
  mediaType: image/jpeg
  caption: Cold Plunge
relations:
- type: parent_family
  target: experiment_family:cold-water-immersion
- type: primary_biomarker
  target: biomarker:self-reported-mood
- type: secondary_biomarker
  target: biomarker:resting-heart-rate
- type: secondary_biomarker
  target: biomarker:hrv-rmssd
- type: secondary_biomarker
  target: biomarker:morning-blood-pressure
- type: secondary_biomarker
  target: biomarker:sleep-efficiency
- type: safety_outcome
  target: biomarker:morning-blood-pressure
lineage:
  relationship: root
  rationale: Murph canonical cold-plunge protocol, kept separate from cold showers, winter/open-water swimming, cold-air cryotherapy, hot-cold contrast, Wim Hof-style breathwork stacks, face-submersion or breath-hold challenges, and post-exercise-only CWI recovery variants.
attribution:
  ownerType: murph
  note: Drafted from the 2026-04-27 Cold Plunge research restart package, canonical source ledger, extracted source findings, and standalone source-protocol evidence appraisals.
protocol:
  doseSignature: 'Murph conservative field-test starting dose: 2–3x/week · measured 10–15 °C water · 1–3 min head-out immersion · 7-day baseline + 14-day intervention; not an evidence-proven optimal dose'
  target: A repeatable, uncomfortable-but-controlled head-out immersion that keeps breathing controllable and allows an immediate self-exit.
  frequency:
    sessionsPerWeek: 3
  durationMinutes:
    min: 1
    max: 3
  sessionShape:
    label: One session
    segments:
    - label: entry
      kind: transition
      durationMinutes: 1
    - label: cold exposure
      kind: stimulus
      durationMinutes: 3
    - label: gentle rewarm
      kind: recovery
      durationMinutes: 1
    ticks:
    - label: "0"
      offsetMinutes: 0
    - label: entry
      offsetMinutes: 1
    - label: "1-3 min in water"
      offsetMinutes: 4
    - label: rewarm
      offsetMinutes: 5
  temperatureC:
    min: 10
    max: 15
  interventionSessionsMinimum: 4
  interventionSessionsTarget: 6
  steps:
    - "Screen first; do not start if any cold-water safety answer is positive or uncertain."
    - "Use a controlled tub, plunge, or tank where you can stand and exit immediately; avoid open water."
    - "Measure water before every session; first-run range is 10–15 °C, never unmeasured or below 10 °C."
    - "Keep head out; no breathwork, hyperventilation, breath holds, face submersion, alcohol, sedatives, or swimming challenges."
    - "Set exit plan before entry: stable footing, towel, warm layers, open cover, clear path, and adult nearby for first exposure."
    - "Start timer, enter slowly, regain controlled breathing within 15–30 sec, and stay still or move minimally."
    - "Exit at planned time, any stop condition, or any loss of confidence in safe exit."
    - "Rewarm gently; log temperature, time, mood, cold-shock intensity, symptoms, and completion."
  safetyNotes:
  - This is a high-caution protocol because cold-water immersion can trigger cold shock, gasping or hyperventilation, cardiovascular strain, arrhythmia-relevant contexts, hypothermia risk, and drowning/submersion hazards.
  - The 1–3 minute 10–15 °C starting range is a conservative Murph field-test dose, not a claim that this exact dose is proven optimal. It is intentionally shorter than several direct studies and stronger than many public protocols on screening.
  - Default Cold Plunge is an adults-only ordinary-wellness protocol. Under-18 users, pregnancy/early postpartum, older adults with frailty, limited mobility, fall risk, or inability to exit/dress/rewarm independently require a separate clinician/professional-supervised variant rather than ordinary unsupervised setup.
  - Cardiovascular screening includes known cardiovascular disease, coronary disease, angina, arrhythmia, heart failure, prior heart attack/stroke, uncontrolled or medication-treated blood pressure when uncertain, channelopathy/Long QT, family sudden-cardiac-event history, significant palpitations, fainting/near-fainting, or clinician advice to avoid sudden cold/water stress.
  - 'Circulation, neurologic, respiratory, kidney, diabetes, and cold-reaction cautions are screening boundaries: peripheral artery disease, poor circulation, peripheral neuropathy, venous stasis, diabetes with hypoglycemia risk or impaired sensation, cold agglutinin disease, prior frostbite/non-freezing cold injury, severe Raynaud-type reaction, cold urticaria/anaphylaxis, severe asthma/COPD symptoms, seizure disorder/epilepsy, and kidney failure/serious kidney disease require clinician guidance before unsupervised start.'
  - Recent self-harm/suicide risk, severe or unstable mental-health symptoms, or using cold plunging as treatment for depression/anxiety requires a clinician-guided mental-health variant or safer alternative; the default protocol only tracks acute subjective mood as a wellness signal.
  - Pregnancy/postpartum, cold-urticaria/anaphylaxis, alcohol/sedative, and medication-related cautions are safety-screening boundaries rather than efficacy claims.
  tips:
  - "Set exit before entry: open lid, dry towel, warm layers, clear footing."
  - "Measure water every session; start at 10–15 °C and 1–3 minutes, warmer and shorter first."
  - "Enter slowly, keep your head out, and regain calm breathing before judging the session."
  - "Skip sauna, hard lifting, alcohol, sedatives, open water, breathwork, and face submersion the same day."
  - "Rewarm gently after exit: towel, dry clothes, warm room, light movement, no immediate hot-cold contrast."
  - "Log temperature, seconds, breathing control, and mood; do not extend for dopamine claims or wearable blips."
  keepInMind:
  - Evidence is mixed and early. Acute mood signals are plausible, but durable immune, cardiometabolic, sleep, cognition, or performance benefits are not established for this protocol.
  - Reduced discomfort after repeated exposure can mean habituation, not necessarily health improvement.
  - Do not treat external weekly-dose claims as Murph efficacy proof.
  logFields:
  - water_temperature_c
  - time_in_water_seconds
  - head_out_yes_no
  - mood_before_0_10
  - mood_after_0_10
  - cold_shock_intensity_0_10
  - breathing_controlled_yes_no
  - symptoms_or_stop_condition
  - rewarming_time_minutes
  - sleep_last_night
  - training_or_sauna_same_day
  - alcohol_or_sedative_context
  - notes
  - temperature_measurement_method
  - adult_nearby_or_rescue_plan_confirmed
  - first_session_or_changed_setup_yes_no
  - prior_cold_exposure_tolerance
  - pre_session_anxiety_or_panic_0_10
  - breathing_control_recovered_within_30s_yes_no
  - post_exit_balance_or_clumsiness
  - post_exit_shivering_or_unable_to_rewarm
  - medication_context_today
  - clinical_intent_wellness_vs_treatment
  - recent_illness_fever_dehydration_or_heat_illness
  - thermometer_available_yes_no
  - hard_training_or_resistance_training_within_24h
  - sauna_heat_or_hot_cold_contrast_same_day
  - alcohol_sedatives_recreational_drugs_or_major_sleep_deprivation_today
  - time_of_day
  sessionFieldIds:
  - water_temperature_c
  - time_in_water_seconds
  - mood_before
  - mood_after
  - cold_shock_intensity
  - breathing_controlled
  - symptoms_or_stop
  - rewarming_time_minutes
  - temperature_measurement_method
  - adult_nearby_or_rescue_plan_confirmed
  - first_session_or_changed_setup_yes_no
  - prior_cold_exposure_tolerance
  - pre_session_anxiety_or_panic_0_10
  - breathing_control_recovered_within_30s_yes_no
  - post_exit_balance_or_clumsiness
  - post_exit_shivering_or_unable_to_rewarm
  - medication_context_today
  - clinical_intent_wellness_vs_treatment
  - recent_illness_fever_dehydration_or_heat_illness
  - thermometer_available_yes_no
  - hard_training_or_resistance_training_within_24h
  - sauna_heat_or_hot_cold_contrast_same_day
  - alcohol_sedatives_recreational_drugs_or_major_sleep_deprivation_today
  - time_of_day
  stopConditions:
  - Do not start if water temperature is unmeasured, the thermometer is unavailable, water is below 10 °C for the first default Murph run, setup changed, no safe exit, no adult nearby for first exposure, or any safety screen is positive or uncertain.
  - Controlled breathing is not restored within 15–30 seconds, inability to speak in short sentences, uncontrolled gasping, hyperventilation, panic, or loss of breathing control.
  - Chest pain or pressure, severe shortness of breath, new wheeze, palpitations, irregular heartbeat sensation, faintness, fainting, confusion, severe headache, visual changes, or loss of coordination.
  - Hives, swelling, wheeze, throat tightness, angioedema, or any suspected cold-triggered allergic/systemic reaction.
  - Blue or gray lips, severe or worsening numbness, weakness, clumsiness, slurred speech, inability to grip/step out/dress, inability to rewarm, persistent or worsening shivering, or cold stress after exit that does not settle with gentle rewarming.
  - Unsafe footing, stuck cover/door, open-water conditions, unsafe water, alcohol/sedatives/recreational drugs, or being alone when supervision is needed.
  - 'Any stop condition occurs: exit immediately, end the session, do not repeat the next session until the cause is resolved; seek urgent/emergency help for chest symptoms, fainting, confusion, severe breathlessness, swelling/throat tightness/wheeze, suspected submersion/aspiration, or inability to rewarm.'
testPlans:
- planId: mood-safety-21d
  durationDays: 21
  baselineDays: 7
  interventionDays: 14
  primaryBiomarkerKey: biomarker:self-reported-mood
  secondaryBiomarkerKeys:
  - biomarker:resting-heart-rate
  - biomarker:hrv-rmssd
  - biomarker:morning-blood-pressure
  - biomarker:sleep-efficiency
  safetyOutcomeKeys:
  - biomarker:morning-blood-pressure
  minimumAdherenceSessions: 4
  targetAdherenceSessions: 6
  notes:
  - 'Primary read: repeatable same-scale mood lift after sessions, with stop conditions, cold-shock intensity, recovery burden, and rewarming logged beside it.'
  - Resting heart rate, HRV/RMSSD, morning blood pressure, and sleep efficiency are wearable/home context signals for strain and recovery, not promised benefits.
  - Exclude or annotate days with illness, alcohol/sedatives, sauna/heat exposure, unusual training load, travel, major sleep disruption, or protocol deviations.
expectedSignalDescriptions:
- biomarkerKey: biomarker:self-reported-mood
  description: "Cold water creates a strong arousal surge, followed by relief after exit, shifting perceived challenge and mood state."
  expected: Mood lift
  estimatedChange:
    kind: mixed_or_contextual
    window: 30–180 min post-session vs pre-session
    confidence: low
    basis: Direct single-session CWI studies reported POMS/TMD mood improvements, but those scales and 5–20 minute exposures do not map cleanly to a 1–3 minute Murph run or a simple mood check-in.
  protocolProminence: focus
- biomarkerKey: biomarker:resting-heart-rate
  description: "Immersion raises cardiac load; next-morning resting pulse shows whether the stress response has resolved."
  expected: stable or slightly lower
  expectedDirection: mixed_or_contextual
  estimatedChange:
    kind: absolute
    low: -2
    high: 2
    unit: bpm
    window: 14-day morning or overnight average vs baseline
    confidence: low
    basis: Direct repeated-CWI and habituation sources show acute heart-rate load with mixed or unclear repeated-dose effects; a near-baseline range is the defensible expectation for consumer resting heart rate.
  protocolProminence: context
- biomarkerKey: biomarker:hrv-rmssd
  description: "Cold shifts the nervous system toward sympathetic drive; overnight RMSSD reflects whether parasympathetic recovery returned."
  expected: stable with possible acute dip
  estimatedChange:
    kind: relative_percent
    low: -10
    high: 10
    unit: '%'
    window: overnight RMSSD during intervention vs baseline
    confidence: low
    basis: Direct CWI HRV data are limited and include small acute/post-exercise contexts; adjacent athlete recovery studies are positive in places but not direct evidence of better baseline RMSSD.
  protocolProminence: context
- biomarkerKey: biomarker:morning-blood-pressure
  description: "Cold constricts peripheral vessels and raises pressure during exposure; morning pressure should settle once vascular tone normalizes."
  expected: should stay stable
  expectedDirection: mixed_or_contextual
  estimatedChange:
    kind: absolute
    low: -3
    high: 3
    unit: mmHg systolic
    window: 14-day morning average vs baseline
    confidence: low
    basis: Cold-shock and safety sources support acute pressure load, while direct repeated-dose and WHM-adjacent data do not establish a durable home-BP improvement.
  protocolProminence: context
- biomarkerKey: biomarker:sleep-efficiency
  description: "Late or stressful plunges disrupt thermoregulation and arousal, while earlier well-tolerated sessions preserve sleep continuity."
  expected: no clear change
  expectedDirection: mixed_or_contextual
  estimatedChange:
    kind: absolute
    low: -2
    high: 2
    unit: "%"
    window: intervention nights vs baseline nights
    confidence: low
    basis: Sleep evidence is mostly adjacent to athletes, cryotherapy, or post-exercise recovery and includes null findings; stable sleep efficiency is the best supported expectation.
  protocolProminence: context
experimentOnboarding:
  schemaVersion: "murph.commons.experiment-onboarding.v2"
  startIntent:
    displayPrompt: "Hey Murph, I want to explore a short cold plunge experiment."
    intentSummary: "Explore Cold Plunge"
  safetyScreen:
    dispositionIfAnyPositive: "clinician_guidance_before_unsupervised_start"
    mustAsk:
      - id: "age_frailty_and_fall_risk"
        prompt: "under 18, older adult with frailty, limited mobility, fall risk, difficulty stepping out of a tub, or needing help to dress or rewarm"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "cardiovascular_channelopathy_or_syncope"
        prompt: "known cardiovascular disease, coronary artery disease, angina, arrhythmia, Long QT/channelopathy, family history of sudden cardiac death or serious water-triggered cardiac events, heart failure, recent heart attack or stroke, unexplained fainting/near-fainting, exertional chest symptoms, significant palpitations, uncontrolled blood pressure, medication-treated high blood pressure if uncertain, or a clinician telling you to avoid sudden cold or water stress"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "circulation_neuropathy_cold_injury"
        prompt: "peripheral artery disease, poor circulation, peripheral neuropathy, venous stasis, prior frostbite or non-freezing cold injury, cold agglutinin disease, severe Raynaud-type reaction, severe numbness, or prior unsafe reaction to cold water"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "cold_allergy_or_systemic_reaction"
        prompt: "cold urticaria, cold-triggered hives, swelling, wheeze, throat tightness, angioedema, anaphylaxis history, or any cold-triggered systemic reaction"
        ifPositive: "do_not_start_unsupervised"
      - id: "respiratory_neurologic_kidney_or_diabetes_context"
        prompt: "severe asthma/COPD symptoms, cold-triggered respiratory symptoms, seizure disorder/epilepsy, kidney failure or serious kidney disease, diabetes with hypoglycemia risk or impaired sensation, or medication affecting heart rate, blood pressure, rhythm, alertness, thermoregulation, glucose, balance, or safe exit"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "pregnancy_postpartum_or_clinical_variant_context"
        prompt: "pregnancy, early postpartum, or another clinical situation where a clinician-guided or professionally supervised variant would be safer than an ordinary wellness run"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "clinical_mental_health_context"
        prompt: "recent self-harm or suicide risk, severe or unstable mental-health symptoms, or planning to use cold plunges as treatment for depression or anxiety"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "current_illness_or_depleted_state"
        prompt: "fever, acute infection, dehydration, recent heat illness, severe fatigue, major sleep deprivation, or feeling too unwell to safely exit and rewarm today"
        ifPositive: "do_not_start_unsupervised"
      - id: "unsafe_setup_or_exit"
        prompt: "unmeasured water temperature, no thermometer, water below 10 °C for the first default Murph run, no reliable way to get out immediately, slippery footing, locked or covered tub risk, open-water setting, no adult nearby for the first session or changed/colder/uncertain setup, or no dry warm rewarming plan"
        ifPositive: "do_not_start_unsupervised"
      - id: "alcohol_sedatives_or_impairment"
        prompt: "alcohol, sedatives, recreational drugs, major sleep deprivation, or anything that could impair judgment, balance, breathing control, or safe exit today"
        ifPositive: "do_not_start_unsupervised"
      - id: "breathwork_submersion_or_breath_hold_plan"
        prompt: "planning to do breathwork, deliberate hyperventilation, breath-holding, face submersion, underwater challenges, open-water swimming, sauna-to-plunge contrast, or hot-cold stacking as part of the session"
        ifPositive: "do_not_start_unsupervised"
    stopIf:
      additionalConditions:
        - "water temperature is unmeasured, the thermometer is unavailable, the setup changed, no safe exit, or no adult nearby for first exposure"
        - "controlled breathing is not restored within 15–30 seconds or the user cannot speak in short sentences"
        - "chest symptoms, severe breathlessness, wheeze, palpitations, faintness, fainting, confusion, visual changes, severe headache, or loss of coordination"
        - "cold-triggered hives, swelling, throat tightness, angioedema, or systemic reaction symptoms"
        - "post-exit unsteadiness, severe numbness, weak legs, poor grip, clumsiness, or inability to dress/rewarm without help"
        - "unsafe exit or rewarming setup"
  setupSlots:
    - id: "water_temperature_c"
      label: "Water temperature"
      question: "What measured water temperature in °C will you use for the first sessions?"
      constraints:
        unit: "C"
        min: 10
        max: 15
        recommendedMin: 10
        recommendedMax: 15
        firstDefaultRunHardGate: "measured_10_to_15_c; do_not_start_if_unmeasured_or_below_10_c"
      target:
        object: "protocol"
        field: "temperatureC"
    - id: "session_duration_minutes"
      label: "Session duration"
      question: "How many minutes will you stay in the water for the first sessions?"
      constraints:
        unit: "minutes"
        recommendedMin: 1
        recommendedMax: 3
      target:
        object: "protocol"
        field: "durationMinutes"
    - id: "sessions_per_week"
      label: "Sessions per week"
      question: "How many cold-plunge sessions per week can you realistically complete during the two-week intervention?"
      constraints:
        recommendedMin: 2
        recommendedMax: 3
      target:
        object: "protocol"
        field: "frequency.sessionsPerWeek"
    - id: "exit_and_rewarming_plan"
      label: "Exit and rewarming plan"
      question: "What is your exact exit and gentle rewarming plan?"
      target:
        object: "onboardingCapture"
        field: "exitAndRewarmingPlan"
    - id: "supervision_or_checkin"
      label: "Supervision or check-in"
      question: "What supervision or check-in will you use?"
      options:
        - "adult_nearby_and_able_to_help"
        - "adult_nearby_first_session_then_reassess"
        - "scheduled_checkin_after_prior_uneventful_sessions_only"
        - "not_sure"
      target:
        object: "onboardingCapture"
        field: "supervisionOrCheckin"
    - id: "mood_scale"
      label: "Mood scale"
      question: "Which same-scale mood rating will you use before and after sessions?"
      options:
        - "zero_to_ten"
        - "one_to_five"
      target:
        object: "analysisPlan"
        field: "moodScale"
    - id: "session_timing"
      label: "Session timing"
      question: "When will sessions usually happen, and will they be kept away from hard training or sauna?"
      constraints:
        optional: true
      target:
        object: "experimentRun"
        field: "sessionTiming"
    - id: "reminder_policy"
      label: "Logging reminder preference"
      question: "Should Murph remind you to log before and after a planned session?"
      constraints:
        optional: true
        askWhen: "at_confirmation"
      target:
        object: "assistantSupport"
        field: "reminderPolicy"
  planDefaults:
    testPlanId: "mood-safety-21d"
    firstSessionGuidance: "Use the warmer end of the measured 10–15 °C range and the shortest duration; another adult should be nearby and able to help; end immediately if breathing control or exit confidence changes."
  adaptationPolicy:
    fields:
      - id: "temperature_field"
        label: "Water temperature range"
        target:
          object: "protocol"
          field: "temperatureC"
        sourceSlotIds:
          - "water_temperature_c"
        requiredForRunSpec: true
        protocolReusable: true
        guidance: "Default first-run sessions require measured 10–15 °C water; do not start if unmeasured, below 10 °C, or changed setup unless this is a separate clinician-guided/professionally supervised variant."
      - id: "duration_field"
        label: "Session duration"
        target:
          object: "protocol"
          field: "durationMinutes"
        sourceSlotIds:
          - "session_duration_minutes"
        requiredForRunSpec: true
        protocolReusable: true
        guidance: "Start with 1–3 minutes; do not increase duration during the first run to chase discomfort."
      - id: "frequency_field"
        label: "Weekly frequency"
        target:
          object: "protocol"
          field: "frequency.sessionsPerWeek"
        sourceSlotIds:
          - "sessions_per_week"
        requiredForRunSpec: true
        protocolReusable: true
      - id: "safety_plan_field"
        label: "Safety setup"
        target:
          object: "onboardingCapture"
          field: "safetyPlan"
        sourceSlotIds:
          - "exit_and_rewarming_plan"
          - "supervision_or_checkin"
        requiredForRunSpec: true
        protocolReusable: false
        guidance: "Another adult nearby and able to help is required for the first session or any changed/colder/uncertain setup; a scheduled check-in is only for later uneventful sessions with unchanged measured setup and negative screen."
      - id: "mood_scale_field"
        label: "Primary mood scale"
        target:
          object: "analysisPlan"
          field: "moodScale"
        sourceSlotIds:
          - "mood_scale"
        requiredForRunSpec: true
        protocolReusable: true
    measurementPlan:
      testPlanId: "mood-safety-21d"
      requiredSignals:
        - "biomarker:self-reported-mood"
      optionalSignals:
        - "biomarker:resting-heart-rate"
        - "biomarker:hrv-rmssd"
        - "biomarker:morning-blood-pressure"
        - "biomarker:sleep-efficiency"
      notes:
        - "Configure mood and safety logs before creating the active experiment. Wearable and home-device signals can be linked later as context."
    reusableSetup:
      enabled: true
      target:
        object: "onboardingCapture"
        field: "coldPlungeSetup"
      sourceSlotIds:
        - "water_temperature_c"
        - "exit_and_rewarming_plan"
        - "supervision_or_checkin"
      notes:
        - "Reuse only for the same physical setup; re-ask if the tub, water source, location, exit plan, or supervision changes."
    notes:
      - "Cold Plunge onboarding adapts the dose downward when any safety, breathing-control, exit, or rewarming uncertainty appears."
  trackingHints:
    confounderFields:
      - "sleep_last_night"
      - "hard_training_same_day"
      - "sauna_or_heat_same_day"
      - "alcohol_or_sedatives"
      - "illness_or_fever"
      - "unusual_stress"
      - "medication_context_today"
      - "clinical_intent_wellness_vs_treatment"
      - "recent_illness_fever_dehydration_or_heat_illness"
      - "hard_training_or_resistance_training_within_24h"
      - "sauna_heat_or_hot_cold_contrast_same_day"
      - "alcohol_sedatives_recreational_drugs_or_major_sleep_deprivation_today"
      - "time_of_day"
    notes:
      - "Log before and after the session; never continue a session just to complete a log."
  supportHints:
    missedLogFollowupCopy: "I can remind you to log temperature, duration, mood, symptoms, and rewarming after planned cold-plunge sessions."
whyItWorks:
  - "## Cold shock defends core\n\nCold water hits skin thermoreceptors fast. Breathing spikes, vessels clamp down, heart rate and pressure shift; blood moves inward to defend core temperature."
  - "## Rewarming is part of the dose\n\nThe session is not over at exit. Shivering, vasoconstriction release, and rewarming decide whether the stress resolves cleanly or carries into recovery."
  - "## Repeated exposure quiets alarm\n\nWith controlled repetition, cold shock becomes less violent: breathing steadies faster, panic drops, and rewarming gets smoother. Pushing colder or longer defeats the adaptation."
mechanismChain:
  -
    label: "Session"
    content: "Brief head-out cold water · measured temperature · controlled exit"
  -
    label: "Cold shock"
    content: "Cold receptors fire; breathing spikes; vessels constrict; blood shifts inward"
  -
    label: "Repeated signal"
    content: "Noradrenaline · thermal stress · rewarming repeat"
  -
    label: "Adaptation"
    content: "Cold shock quiets · breathing steadies · rewarming gets smoother"
claims:
- claimId: cold-plunge-scope-controlled-head-out
  type: design_guardrail
  text: Murph Cold Plunge is a brief, deliberate, usually head-out cold-water immersion in a controlled tub, tank, or plunge setting; cold showers, open-water swimming, cold-air cryotherapy, contrast therapy, breathwork bundles, and post-exercise-only recovery CWI are adjacent variants rather than interchangeable direct evidence.
  strength: high
  sourceKeys:
  - source_artifact:pmid-37866096
  - source_artifact:doi-10.1002-lim2.53
  - source_artifact:doi-10.1002-lim2.70044
  - source_artifact:doi-10.1002-lim2.70048
  - source_artifact:clevelandclinic-cold-plunge-benefits-risks-2024-12-24
  - source_artifact:hubermanlab-cold-exposure-protocol-2026-04-27
  caveats:
  - This is a protocol boundary, not an efficacy claim; external public dose sources are kept as context-only sources.
- claimId: direct-evidence-short-term-and-mixed
  type: evidence_scope
  text: 'The direct and near-direct cold-plunge evidence base recovered here is mostly short-term and mixed: acute mood/stress and habituation findings are plausible, immune/leukocyte evidence is mixed or null, and tissue-cooling or catecholamine findings are mechanistic dose/safety context rather than benefits. Durable clinical, immune-protection, cardiometabolic, cognition, sleep, or performance benefits are not established.'
  strength: moderate
  sourceKeys:
  - source_artifact:doi-10.1002-lim2.53
  - source_artifact:doi-10.1002-lim2.70044
  - source_artifact:doi-10.1002-lim2.70048
  - source_artifact:pmid-37866096
  - source_artifact:pmid-37711459
  - source_artifact:pmid-40815943
  - source_artifact:pmid-31203599
  - source_artifact:pmid-39779795
  - source_artifact:pmid-39879231
  caveats:
  - Many direct studies are small, short, young/healthy, male-heavy, acute, or mechanistic; adjacent variants must stay labeled.
- claimId: acute-mood-signal-plausible-not-durable-proof
  type: mixed_evidence
  text: 'Acute self-reported mood is a plausible short-term target: several direct single-session cold-water immersion records in screened young, healthy, or self-reported-low-mood samples reported immediate mood improvement, while a separate 10 °C immersion study showed a delayed negative-mood/cortisol signal with mixed mood and cardiovascular interpretation. Treat mood as a personal subjective signal, not a durable mental-health treatment claim.'
  strength: moderate
  sourceKeys:
  - source_artifact:doi-10.1002-lim2.53
  - source_artifact:doi-10.1002-lim2.70044
  - source_artifact:doi-10.1002-lim2.70048
  - source_artifact:pmid-37866096
  caveats:
  - The strongest mood-supportive records used single-session naturalistic or controlled settings; one direct study found mixed endpoint timing and cardiovascular interpretation.
- claimId: cold-water-is-acute-stressor-safety-first
  type: safety
  text: Cold-water immersion can create a real acute stress load, including cold shock, gasping or hyperventilation, sympathetic/catecholamine activation, blood-pressure and heart-rate strain, and arrhythmia-relevant contexts; safety screening and stop rules should be stronger than efficacy language.
  strength: high
  sourceKeys:
  - source_artifact:pmid-2010387
  - source_artifact:pmid-2691172
  - source_artifact:pmid-10751106
  - source_artifact:pmid-8891513
  - source_artifact:pmid-39779795
  - source_artifact:pmid-36396152
  caveats:
  - Mechanistic and safety sources are not benefit evidence; they set the risk boundary for home use.
- claimId: habituation-specific-not-broad-adaptation
  type: intervention_result
  text: Repeated cold-water exposures can habituate some ventilatory, perceptual, or cold-shock responses, but the evidence does not justify a broad claim of whole-body adaptation, better health, or improved performance from a short plunge block.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-38211547
  - source_artifact:pmid-9721005
  - source_artifact:pmid-11072768
  - source_artifact:pmid-24229801
  - source_artifact:pmid-40815943
  - source_artifact:pmid-38301228
  caveats:
  - Habituation studies often use lab settings, small samples, and male or military/fit populations; reduced discomfort is not proof of benefit.
- claimId: immune-and-inflammation-claims-remain-mixed
  type: mixed_evidence
  text: Immune, leukocyte, inflammation, and illness-protection claims should remain mixed or context-only because the recovered evidence includes acute biomarker shifts, null or unclear repeated-CWI leukocyte findings, and adjacent cold-shower or voluntary-cold-exposure evidence rather than direct plunge protection.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-39879231
  - source_artifact:pmid-33910456
  - source_artifact:pmid-37711459
  - source_artifact:pmid-8925815
  - source_artifact:pmid-27631616
  caveats:
  - Do not frame Cold Plunge as preventing colds, improving immune function, or treating inflammatory disease.
- claimId: sleep-hrv-and-recovery-are-exploratory-context
  type: mixed_evidence
  text: Sleep, HRV, cognition, and recovery signals are useful to monitor for strain or context, but the recovered evidence is exploratory, adjacent, athlete-specific, cryotherapy-heavy, or mixed rather than direct proof that a general Cold Plunge protocol improves sleep or recovery.
  strength: low
  sourceKeys:
  - source_artifact:pmid-39515683
  - source_artifact:pmid-33766020
  - source_artifact:pmid-30551730
  - source_artifact:pmid-30876470
  - source_artifact:pmid-32472928
  - source_artifact:pmid-39918163
  caveats:
  - Wearables should be treated as context and safety burden signals; mood/safety/adherence are better primary outcomes for this first Murph protocol.
- claimId: observational-frequency-signals-not-causal
  type: association_not_causation
  text: Observational frequency or habitual-use signals are not causal cold-plunge evidence because they can be confounded by training, outdoor activity, socioeconomic factors, selection into cold exposure, and bundled lifestyle behaviors.
  strength: low
  sourceKeys:
  - source_artifact:pmid-37530998
  - source_artifact:pmid-41127868
  caveats:
  - Use observational sources for hypothesis generation and expectation management only.
- claimId: post-exercise-cwi-is-separate-recovery-variant
  type: mixed_evidence
  text: 'Post-exercise cold-water immersion is a separate recovery/timing variant: it may help some soreness or selected short-term recovery endpoints, but evidence is comparator-, timing-, sport-, sex/population-, and adaptation-dependent, includes null recovery trials, and may conflict with some resistance-training adaptation goals.'
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-22336838
  - source_artifact:doi-10.1186-s12891-024-07315-2
  - source_artifact:doi-10.1002-ejsc.12074
  - source_artifact:pmid-24674975
  - source_artifact:pmid-25760154
  - source_artifact:pmid-25437181
  - source_artifact:pmid-39918163
  - source_artifact:doi-10.1371-journal.pone.0322416
  caveats:
  - Do not use athlete recovery evidence to promise general wellness benefits or to recommend plunging after every strength session.
- claimId: breathwork-submersion-and-breath-holding-excluded
  type: safety
  text: Breathwork in water, deliberate hyperventilation, breath-hold challenges, face submersion, and open-water challenges are excluded from this Murph Cold Plunge protocol because they add drowning, submersion, arrhythmia, and recovery-context risks that are not part of the controlled tub/plunge test.
  strength: high
  sourceKeys:
  - source_artifact:wimhofmethod-faq-safety-2026-04-27
  - source_artifact:pmid-7950804
  - source_artifact:pmid-17086766
  - source_artifact:pmid-20377144
  - source_artifact:pmid-26754186
  - source_artifact:pmid-7337825
  caveats:
  - A branded method or sports-recovery protocol should be represented as its own external or adjacent protocol, not folded into this canonical protocol.
- claimId: onboarding-requires-high-caution-screen
  type: design_guardrail
  text: 'Cold Plunge should power Murph experiment creation only through high-caution onboarding: screen for adult-only fit, cardiovascular/channelopathy/syncope, respiratory, neurologic, kidney, diabetes, cold-triggered allergic/vascular/circulation, pregnancy/postpartum, medication, alcohol/sedative, mental-health-treatment intent, supervision, measured-temperature, exit, and rewarming risks before configuring a run.'
  strength: high
  sourceKeys:
  - source_artifact:royallifesaving-cold-water-immersion-therapy-2024-02-26
  - source_artifact:pmid-36396152
  - source_artifact:pmid-26617380
  - source_artifact:pmid-2010387
  - source_artifact:weather-gov-cold-water-safety-2026-04-27
  - source_artifact:doi-10.1002-lim2.70009
  - source_artifact:pmid-34862605
  - source_artifact:pmid-37873787
  - source_artifact:pmid-41044831
  - source_artifact:pmid-497899
  - source_artifact:pmid-9088850
  - source_artifact:pmid-6129886
  caveats:
  - A positive or uncertain screen is not a diagnosis; it means Murph should not start an unsupervised cold-water experiment without clinician guidance or a safer alternative.
researchLandscape:
  bottomLine: "Cold Plunge has a plausible acute mood and tolerance use case, but the evidence base is early, mixed, and safety-boundary heavy. Treat this as a conservative personal experiment, not a broad health, immune, sleep, or performance prescription."
  confidenceLabel: mixed
  primaryClaim: "A short, controlled, head-out cold-water immersion block may be worth testing for acute subjective mood and tolerance in screened adults, while monitoring safety, burden, and recovery context."
  mainCaveat: "The strongest practical guidance comes from small acute studies, habituation and mechanistic studies, safety guidance, adjacent sports-recovery evidence, and public protocol context; durable health outcomes are not established."
  groups:
  - id: acute-mood
    label: "Acute mood signal"
    stance: supports
    summary: "A controlled single-session immersion record reported immediate mood-score improvement in young, healthy participants; use this as a short-term subjective-mood signal, not a treatment claim."
    sourceKeys:
    - source_artifact:doi-10.1002-lim2.53
    defaultOpen: true
  - id: environment-mood
    label: "Sea versus laboratory mood signal"
    stance: supports
    summary: "A small crossover study reported mood improvement after both sea and laboratory immersion, while suggesting the setting can modify the psychological response."
    sourceKeys:
    - source_artifact:doi-10.1002-lim2.70044
    defaultOpen: false
  - id: dose-mood
    label: "Duration-dose mood signal"
    stance: supports
    summary: "A duration-comparison trial reported acute mood improvement after 5-20 minutes of cool immersion, while also showing autonomic and safety-relevant shifts in a small subgroup."
    sourceKeys:
    - source_artifact:doi-10.1002-lim2.70048
    defaultOpen: true
  - id: acute-mood-stress
    label: "Acute mixed mood and stress markers"
    stance: mixed
    summary: "A direct 10 C immersion study supports cautious acute stress and mood tracking, but its timing, cortisol, mood, and vascular signals were mixed."
    sourceKeys:
    - source_artifact:pmid-37866096
    defaultOpen: true
  - id: brain-mood-context
    label: "Brain and affect measurement context"
    stance: context_only
    summary: "Brain-connectivity and affect-measurement records can help choose endpoints, but the acute pre-post designs do not prove a durable cold-plunge benefit."
    sourceKeys:
    - source_artifact:pmid-36829490
    - source_artifact:pmid-37719079
    defaultOpen: false
  - id: mental-health-and-open-water-context
    label: "Mental-health and open-water context"
    stance: mixed
    summary: "Clinical, supervised, open-water, and bundled mental-health records can inform endpoints and screening, but they do not show that a short controlled plunge treats mood disorders."
    sourceKeys:
    - source_artifact:pmid-40530059
    - source_artifact:pmid-39606690
    - source_artifact:pmid-40560861
    - source_artifact:pmid-37443045
    - source_artifact:doi-10.1123-tsp.2024-0086
    - source_artifact:doi-10.1192-bja.2023.60
    - source_artifact:pmid-37381680
    - source_artifact:doi-10.3389-fpubh.2025.1693026
    - source_artifact:doi-10.1016-j.jenvp.2023.102073
    - source_artifact:doi-10.1002-lim2.12
    - source_artifact:doi-10.1016-j.mhpa.2022.100472
    - source_artifact:pmid-30131418
    - source_artifact:doi-10.1016-j.mhpa.2025.100723
    defaultOpen: false
  - id: health-wellbeing-review
    label: "Health and wellbeing review boundary"
    stance: mixed
    summary: "Broad reviews and mechanistic hypotheses are useful landscape evidence, but they mix modalities, small samples, timepoints, and outcomes; use them to constrain rather than expand protocol claims."
    sourceKeys:
    - source_artifact:pmid-39879231
    - source_artifact:pmid-41160573
    - source_artifact:doi-10.5502-ijw.v15i1.3981
    defaultOpen: true
  - id: observational-and-winter-swimming-context
    label: "Observational and winter-swimming context"
    stance: context_only
    summary: "Habitual-use, winter-swimming, seasonal, and cross-sectional records are useful for hypotheses and confounders, not causal proof for a controlled cold-plunge block."
    sourceKeys:
    - source_artifact:pmid-37530998
    - source_artifact:pmid-41127868
    - source_artifact:pmid-12078959
    - source_artifact:pmid-15253480
    - source_artifact:pmid-38509857
    - source_artifact:pmid-12546194
    defaultOpen: false
  - id: cold-shock-safety
    label: "Cold shock and breathing safety"
    stance: safety_boundary
    summary: "Cold-shock and respiratory physiology sources support first-exposure breathing cautions, no forcing, and immediate exit if ventilation is not quickly controlled."
    sourceKeys:
    - source_artifact:pmid-2010387
    - source_artifact:pmid-16714416
    - source_artifact:pmid-41602813
    defaultOpen: true
  - id: safety-cold-shock-hypothermia
    label: "Cold-shock, hypothermia, and extreme-cold boundary"
    stance: safety_boundary
    summary: "Cold-shock, hypothermia, sudden-death, and extreme-cold records anchor the main safety boundary; they are not benefit evidence."
    sourceKeys:
    - source_artifact:pmid-25275647
    - source_artifact:pmid-2691172
    - source_artifact:pmid-40408371
    - source_artifact:pmid-38609397
    - source_artifact:pmid-14698111
    - source_artifact:pmid-26592137
    - source_artifact:doi-10.3389-fphys.2025.1679550
    - source_artifact:pmid-28833689
    defaultOpen: false
  - id: temperature-dose-physiology
    label: "Temperature and tissue-dose physiology"
    stance: context_only
    summary: "Temperature, duration, and tissue-cooling studies help define dose measurement and thermal load, but cooling depth is not itself a wellness endpoint."
    sourceKeys:
    - source_artifact:pmid-31203599
    - source_artifact:pmid-10751106
    defaultOpen: false
  - id: sympathetic-cardiovascular
    label: "Autonomic and cardiovascular physiology"
    stance: safety_boundary
    summary: "Autonomic, endocrine, vascular, medication, and cardiovascular studies explain the acute load of cold exposure; use them for monitoring and caution, not benefit claims."
    sourceKeys:
    - source_artifact:pmid-38663342
    - source_artifact:pmid-8891513
    - source_artifact:pmid-32082177
    - source_artifact:pmid-36101432
    - source_artifact:pmid-37079282
    - source_artifact:pmid-36792625
    - source_artifact:pmid-37840386
    - source_artifact:pmid-38478550
    - source_artifact:pmid-1517364
    - source_artifact:pmid-6129886
    - source_artifact:pmid-2789570
    defaultOpen: false
  - id: catecholamine-dose-context
    label: "Catecholamine, lipid, and biomarker context"
    stance: context_only
    summary: "Noradrenaline, lipid, and related biomarker responses are mechanistic dose context, not evidence that the protocol improves clinical outcomes."
    sourceKeys:
    - source_artifact:pmid-39779795
    - source_artifact:pmid-36150503
    defaultOpen: false
  - id: cold-shock-habituation-safety
    label: "Habituation and cold-shock adaptation"
    stance: safety_boundary
    summary: "Repeated exposure can reduce some cold-shock, ventilatory, anxiety, or perception responses, but habituation should not be converted into broad safety or efficacy claims."
    sourceKeys:
    - source_artifact:pmid-9721005
    - source_artifact:pmid-24229801
    - source_artifact:pmid-24722189
    - source_artifact:pmid-38211547
    - source_artifact:pmid-22918558
    - source_artifact:pmid-24597161
    - source_artifact:pmid-28242468
    - source_artifact:pmid-29695988
    - source_artifact:doi-10.3390-app15137107
    - source_artifact:pmid-9763650
    - source_artifact:pmid-36106151
    - source_artifact:pmid-11072768
    defaultOpen: false
  - id: habituation-brief-immersions
    label: "Brief repeated immersion habituation"
    stance: mixed
    summary: "Repeated brief 12 C head-out immersions habituated ventilation and perception but did not show broad cardiovascular, metabolic, core, or skin-temperature adaptation."
    sourceKeys:
    - source_artifact:pmid-40815943
    defaultOpen: false
  - id: measurement-cognition-and-balance-context
    label: "Measurement, cognition, and balance context"
    stance: context_only
    summary: "Cold-stress, hand-test, balance, cognition, and measurement-method papers help choose logs and stop rules, but they are not direct outcome evidence."
    sourceKeys:
    - source_artifact:pmid-40012949
    - source_artifact:pmid-39479308
    - source_artifact:pmid-41185024
    - source_artifact:pmid-21432119
    defaultOpen: false
  - id: cold-plunge-safety-guideline
    label: "Safety screening and implementation guidance"
    stance: safety_boundary
    summary: "Guideline, position-statement, and clinical explainer sources support screening, measured temperature, supervision, acclimatization, exit planning, and emergency planning."
    sourceKeys:
    - source_artifact:clevelandclinic-cold-plunge-benefits-risks-2024-12-24
    - source_artifact:utahhealth-cold-plunging-health-2023-03-24
    - source_artifact:pmid-26617380
    - source_artifact:pmid-36396152
    - source_artifact:royallifesaving-cold-water-immersion-therapy-2024-02-26
    defaultOpen: true
  - id: cold-water-safety-boundary
    label: "Cold-water and contrast safety boundary"
    stance: safety_boundary
    summary: "Public cold-water, cardiopulmonary, and hot-cold contrast sources keep cold shock, incapacitation, respiratory risk, hypothermia, and rescue planning visible."
    sourceKeys:
    - source_artifact:heart-org-cold-water-plunge-risks-2022-12-09
    - source_artifact:weather-gov-cold-water-safety-2026-04-27
    - source_artifact:lungorg-sauna-cold-plunges-health-impacts-2025-05-29
    defaultOpen: true
  - id: cardiac-risk-clinical-boundary
    label: "Cardiac-risk clinical boundary"
    stance: safety_boundary
    summary: "Heart-disease, blood-pressure, long-QT, channelopathy, and supervised cardiac-immersion sources support clinician guidance before unsupervised cold-water exposure."
    sourceKeys:
    - source_artifact:harvardhealth-cold-plunges-heart-2025-06-01
    - source_artifact:pmid-39461093
    - source_artifact:pmid-26152773
    - source_artifact:pmid-38060596
    - source_artifact:pmid-19696059
    defaultOpen: false
  - id: autonomic-conflict-arrhythmia-risk
    label: "Autonomic conflict and arrhythmia risk"
    stance: safety_boundary
    summary: "Cold-water, diving, face-immersion, and long-QT sources show how competing autonomic reflexes can raise arrhythmia risk, especially with submersion or susceptible users."
    sourceKeys:
    - source_artifact:pmid-22547634
    - source_artifact:pmid-29408217
    - source_artifact:pmid-40624837
    defaultOpen: false
  - id: cold-urticaria-anaphylaxis-screening
    label: "Cold urticaria and allergic-reaction screening"
    stance: safety_boundary
    summary: "Cold-triggered urticaria and anaphylaxis sources support explicit screening because complete cold-water immersion can trigger systemic reactions in susceptible people."
    sourceKeys:
    - source_artifact:pmid-37873787
    - source_artifact:pmid-41044831
    - source_artifact:pmid-23839613
    - source_artifact:pmid-34437035
    - source_artifact:pmid-34862605
    defaultOpen: false
  - id: pregnancy-safety-boundary
    label: "Pregnancy and postpartum boundary"
    stance: safety_boundary
    summary: "Pregnancy and cold-stress sources are safety boundaries, not clearance for this ordinary unsupervised wellness protocol."
    sourceKeys:
    - source_artifact:pmid-10223611
    - source_artifact:doi-10.1002-lim2.70009
    defaultOpen: false
  - id: alcohol-cold-water-safety-boundary
    label: "Alcohol and cold-water safety boundary"
    stance: safety_boundary
    summary: "Alcohol changes thermal balance and early cold-water responses, supporting an alcohol and sedative exclusion for sessions."
    sourceKeys:
    - source_artifact:pmid-497899
    - source_artifact:pmid-9088850
    defaultOpen: false
  - id: drowning-rescue-boundary
    label: "Drowning and rescue-planning boundary"
    stance: safety_boundary
    summary: "Drowning, open-water, and submersion sources support first-session supervision, rescue planning, and urgent escalation after suspected submersion or aspiration."
    sourceKeys:
    - source_artifact:pmid-31178366
    - source_artifact:pmid-26889019
    - source_artifact:pmid-17622298
    - source_artifact:pmid-21458133
    - source_artifact:pmid-33276648
    - source_artifact:pmid-26941276
    - source_artifact:pmid-39530204
    - source_artifact:pmid-38379489
    defaultOpen: false
  - id: hypothermia-emergency-escalation
    label: "Hypothermia recognition and rewarming"
    stance: safety_boundary
    summary: "Hypothermia, rescue, afterdrop, and rewarming guidance support post-exit observation and urgent escalation for confusion, non-responsiveness, inability to rewarm, or deterioration."
    sourceKeys:
    - source_artifact:pmid-23150960
    - source_artifact:pmid-29162267
    - source_artifact:pmid-34383570
    - source_artifact:pmid-35010760
    - source_artifact:pmid-16538942
    - source_artifact:uscg-cold-water-survival-guide-2012-11-30
    - source_artifact:pmid-33675869
    - source_artifact:pmid-31740369
    defaultOpen: false
  - id: immune-inflammation-illness-context
    label: "Immune, inflammation, and illness boundary"
    stance: mixed
    summary: "Immune, inflammation, illness, cold-shower, clinical, and WHM-adjacent records are mixed or indirect and do not support an immune-protection promise for Cold Plunge."
    sourceKeys:
    - source_artifact:pmid-33820701
    - source_artifact:pmid-27631616
    - source_artifact:pmid-34428265
    - source_artifact:pmid-39299098
    - source_artifact:pmid-38478473
    - source_artifact:pmid-24799686
    - source_artifact:pmid-36137565
    - source_artifact:pmid-18382932
    - source_artifact:pmid-36348102
    - source_artifact:pmid-39078461
    - source_artifact:pmid-35021915
    - source_artifact:pmid-12471310
    - source_artifact:pmid-10066131
    defaultOpen: false
  - id: immune-stress-acute
    label: "Acute immune and stress biomarkers"
    stance: mixed
    summary: "Short whole-body CWI triggered stress hormones and mixed cytokine or white-blood-cell changes; use this as biomarker context, not immune benefit proof."
    sourceKeys:
    - source_artifact:pmid-33910456
    defaultOpen: false
  - id: repeated-cwi-leukocytes
    label: "Repeated CWI leukocyte findings"
    stance: mixed
    summary: "Repeated 7 C CWI had no clear relevant leukocyte effect and uncertain practical significance."
    sourceKeys:
    - source_artifact:pmid-37711459
    defaultOpen: false
  - id: immune-adaptation
    label: "Immune adaptation context"
    stance: mixed
    summary: "Repeated cold exposure shifted some immune markers, but clinical meaning and direct cold-plunge benefit relevance are limited."
    sourceKeys:
    - source_artifact:pmid-8925815
    defaultOpen: false
  - id: sleep-cognition
    label: "Direct sleep and cognition signal"
    stance: mixed
    summary: "A small repeated therapeutic cooling or CWI study reported sleep and cognition signals but neutral wellbeing findings; use it as preliminary context only."
    sourceKeys:
    - source_artifact:pmid-39515683
    defaultOpen: false
  - id: sleep-hrv-recovery-context
    label: "Sleep, HRV, and recovery context"
    stance: mixed
    summary: "Athlete and recovery studies make sleep, HRV, soreness, inflammation, and fatigue worth monitoring, but the evidence is adjacent and mixed rather than a direct wellness benefit."
    sourceKeys:
    - source_artifact:pmid-39959124
    - source_artifact:pmid-37462808
    - source_artifact:pmid-33870188
    - source_artifact:pmid-23377833
    - source_artifact:pmid-29801652
    - source_artifact:pmid-21941017
    - source_artifact:doi-10.1007-s11332-018-0522-6
    - source_artifact:doi-10.1002-lim2.70029
    - source_artifact:doi-10.1186-2046-7648-4-s1-a150
    - source_artifact:pmid-23799825
    - source_artifact:pmid-30026562
    - source_artifact:pmid-33507839
    - source_artifact:pmid-26275673
    - source_artifact:pmid-33144349
    defaultOpen: false
  - id: cold-exposure-sleep-adjacent-variants
    label: "Adjacent cold-exposure sleep context"
    stance: context_only
    summary: "Cold-shower, cold-air, cryotherapy, thermal sleep, and circadian records can inform what to monitor, but they are not direct Cold Plunge sleep-benefit proof."
    sourceKeys:
    - source_artifact:pmid-37782163
    - source_artifact:pmid-30551730
    - source_artifact:pmid-30876470
    - source_artifact:pmid-32472928
    - source_artifact:pmid-33766020
    defaultOpen: false
  - id: sports-recovery-training-adaptation-boundary
    label: "Post-exercise recovery and training-adaptation boundary"
    stance: mixed
    summary: "Athlete and post-exercise CWI can help some soreness or selected recovery endpoints, includes null trials, and can conflict with strength or hypertrophy goals; it is a separate timing variant."
    sourceKeys:
    - source_artifact:pmid-22336838
    - source_artifact:pmid-38301228
    - source_artifact:doi-10.1002-ejsc.12074
    - source_artifact:doi-10.1186-s12891-024-07315-2
    - source_artifact:doi-10.1371-journal.pone.0322416
    - source_artifact:doi-10.3389-fspor.2021.714148
    - source_artifact:pmid-24674975
    - source_artifact:pmid-16372177
    - source_artifact:pmid-25760154
    - source_artifact:pmid-26062633
    - source_artifact:pmid-23743793
    - source_artifact:pmid-25074283
    - source_artifact:pmid-25121612
    - source_artifact:pmid-25437181
    - source_artifact:pmid-19308790
    - source_artifact:pmid-19074671
    - source_artifact:pmid-20403733
    - source_artifact:pmid-26174323
    - source_artifact:pmid-26413718
    - source_artifact:pmid-26581833
    - source_artifact:pmid-27704555
    - source_artifact:pmid-29627884
    - source_artifact:pmid-29755363
    - source_artifact:pmid-31513450
    - source_artifact:pmid-31788800
    - source_artifact:pmid-33146851
    - source_artifact:pmid-33217726
    - source_artifact:pmid-33898988
    - source_artifact:pmid-35068365
    - source_artifact:pmid-35157264
    - source_artifact:pmid-36399666
    - source_artifact:pmid-21947816
    - source_artifact:pmid-23434565
    - source_artifact:pmid-24768476
    - source_artifact:doi-10.1016-j.jtherbio.2004.08.069
    - source_artifact:mayoclinichealthsystem-cold-plunge-after-workouts-2024-01-30
    - source_artifact:pmcid-PMC3766664
    - source_artifact:pmid-25573221
    - source_artifact:pmid-21077001
    - source_artifact:pmid-21716151
    - source_artifact:pmid-16937951
    - source_artifact:pmcid-PMC3499890
    - source_artifact:pmid-10735978
    - source_artifact:pmid-10444630
    - source_artifact:pmid-26614422
    - source_artifact:pmid-27398915
    - source_artifact:pmid-27430594
    - source_artifact:pmid-27557407
    - source_artifact:pmid-28116880
    - source_artifact:pmid-29685828
    - source_artifact:pmid-29952675
    - source_artifact:pmid-30443221
    - source_artifact:pmid-31222379
    - source_artifact:pmid-32695024
    - source_artifact:pmid-32880050
    - source_artifact:pmid-33345125
    - source_artifact:pmid-34575347
    - source_artifact:ito-water-immersion-mucosal-immune-defense-2019-01-01
    - source_artifact:pmid-36527593
    - source_artifact:pmid-36744038
    - source_artifact:pmid-36862831
    - source_artifact:pmid-38491303
    - source_artifact:pmid-38548939
    - source_artifact:pmid-38613679
    - source_artifact:pmid-39376896
    - source_artifact:pmid-39918163
    - source_artifact:pmid-40078372
    - source_artifact:pmid-41716304
    - source_artifact:pmid-41845491
    - source_artifact:pmid-33877402
    - source_artifact:pmid-35629351
    - source_artifact:pmid-36308505
    defaultOpen: false
  - id: external-protocol-dose-claims
    label: "Public protocols and explainer claims"
    stance: context_only
    summary: "Huberman, Mayo, Wim Hof, cold-shower, and other public protocol or explainer sources are useful for expectations and attribution, but they are not direct proof for this Murph protocol."
    sourceKeys:
    - source_artifact:hubermanlab-cold-exposure-protocol-2026-04-27
    - source_artifact:hubermanlab-deliberate-cold-exposure-podcast-2022-04-04
    - source_artifact:mayoclinicpress-ice-baths-recovery-2024-04-15
    - source_artifact:wimhofmethod-cold-showers-2026-04-27
    - source_artifact:wimhofmethod-regular-ice-baths-2026-04-27
    defaultOpen: false
  - id: breathwork-cold-bundle-boundary
    label: "Breathwork and bundled cold-exposure boundary"
    stance: mixed
    summary: "Wim Hof-style and mindfulness-plus-cold studies bundle breathing, meditation, showers, swimming, coaching, or commitment with cold exposure, so they should not be cited as isolated cold-plunge proof."
    sourceKeys:
    - source_artifact:wimhofmethod-faq-safety-2026-04-27
    - source_artifact:pmid-41309213
    - source_artifact:pmid-36248220
    - source_artifact:pmid-41388053
    - source_artifact:doi-10.1038-s41598-023-44902-0
    defaultOpen: false
  - id: breath-hold-submersion-arrhythmia
    label: "Breath-hold, face-submersion, and underwater boundary"
    stance: safety_boundary
    summary: "Breath-hold, face-submersion, diving, and underwater-training sources support keeping the default Cold Plunge protocol head-out, with no hyperventilation, breath-holding, or underwater escalation."
    sourceKeys:
    - source_artifact:pmid-7337825
    - source_artifact:pmid-20377144
    - source_artifact:pmid-26754186
    - source_artifact:pmid-17086766
    - source_artifact:pmid-7950804
    defaultOpen: true
safety:
  cautionLevel: high
  avoidOrGetClinicianGuidance:
  - under_18
  - pregnancy_or_early_postpartum
  - older_adult_with_frailty_or_fall_risk
  - inability_to_exit_or_rewarm_alone
  - coronary_artery_disease_or_angina
  - arrhythmia_or_long_qt
  - family_sudden_cardiac_event_history
  - heart_failure
  - recent_heart_attack_or_stroke
  - unexplained_fainting
  - uncontrolled_blood_pressure
  - peripheral_artery_disease
  - peripheral_neuropathy_or_poor_circulation
  - diabetes_with_hypoglycemia_or_neuropathy
  - cold_agglutinin_disease
  - prior_frostbite_or_cold_injury
  - severe_raynaud_reaction
  - cold_urticaria_or_cold_anaphylaxis
  - cold_triggered_angioedema
  - severe_asthma_or_copd
  - cold_triggered_respiratory_symptoms
  - seizure_disorder_or_epilepsy
  - kidney_failure_or_serious_kidney_disease
  - medication_affecting_hr_bp_or_rhythm
  - medication_affecting_thermoregulation
  - recent_self_harm_or_suicide_risk
  - unstable_mental_health_symptoms
  - fever_or_acute_illness
  - dehydration_or_recent_heat_illness
  - alcohol_sedatives_or_recreational_drugs
  - open_water_or_swimming_challenge
  - breathwork_or_breath_holding_in_water
  - sauna_to_plunge_contrast_stack
  - unmeasured_water_temperature
  - water_below_10c_on_first_run
  - inability_to_exit_immediately
  stopIf:
  - water temperature is unmeasured, below the default first-run range, setup changed, no safe exit, no adult nearby for first exposure, or any safety screen is positive or uncertain
  - controlled breathing is not restored within 15–30 seconds, inability to speak in short sentences, uncontrolled gasping, hyperventilation, panic, or loss of breathing control
  - chest pain or pressure, severe shortness of breath, new wheeze, palpitations, irregular heartbeat sensation, faintness, fainting, confusion, severe headache, visual changes, or loss of coordination
  - hives, swelling, wheeze, throat tightness, angioedema, or any suspected cold-triggered allergic/systemic reaction
  - blue or gray lips, severe or worsening numbness, weakness, clumsiness, slurred speech, inability to grip/step out/dress, inability to rewarm, persistent or worsening shivering, or cold stress after exit that does not settle with gentle rewarming
  - unsafe footing, stuck cover/door, open-water conditions, unsafe water, alcohol/sedatives/recreational drugs, or being alone when supervision is needed
  - 'any stop condition occurs: exit immediately, end the session, do not repeat the next session until the cause is resolved; seek urgent/emergency help for chest symptoms, fainting, confusion, severe breathlessness, swelling/throat tightness/wheeze, suspected submersion/aspiration, or inability to rewarm'
  notes:
  - Screening boundaries are safety gates, not efficacy claims.
researchCoverage:
  researchRun: output-packages/research/cold-plunge-research-restart-20260427
  canonicalLedgerSourceCount: 262
  extractedSourcePageCount: 235
  extractedSourceFindingCount: 386
  evidenceAppraisalCount: 235
  artifactManifestStubCount: 235
  missingRegistryOrCurrentTrialRecords: 26
  excludedCommercialOrLowReliabilityRecords: 1
  generatedSourceIndexPresent: false
  auditCutoff: '2026-04-27'
  notes:
  - Generated source index was absent from the supplied snapshot, so existing source-key reuse could not be checked beyond the snapshot content.
  - Batch 003 registry/current-trial records are not cited as outcome evidence until extracted.
  - 'Work-log check: source-extraction prompts batch-001 through batch-012 each declared Maximum source count <=40; the largest listed batch was 40 sources (batch-005), preserving the no-more-than-40-source-records-per-extraction-run guarantee.'
---

## Question this experiment answers

After a stable baseline, does a short block of **controlled, head-out cold plunges** improve your same-scale mood rating or tolerance enough to be worth repeating, **without** unsafe cold-shock symptoms, recovery strain, or adherence burden?

## Simple version

Run a 21-day experiment:

- **7 baseline days**
- **14 intervention days**
- **2–3 cold-plunge sessions per week**
- **6 target sessions**, with **4 sessions** as the minimum for a useful first read
- a Murph conservative starting cap: measured **10–15 °C** water and **1–3 minutes** per session
- treat that cap as a safety-first field-test configuration, not an evidence-proven optimal dose
- head stays out, no breathwork, no breath-holding, no face submersion, no open water, no alcohol or sedatives

The primary read is subjective: mood before the session and again after the session using the same scale. Resting heart rate, HRV/RMSSD, morning blood pressure, and sleep efficiency are wearable/home-device context and safety signals, not promised benefits.

## What this protocol is

This protocol is a controlled cold-water immersion experiment in a tub, plunge, or tank where you can exit immediately. Direct or near-direct immersion records include controlled head-out or chest-deep cold-water immersion, while cold showers, open-water swimming, cryotherapy, breathwork bundles, contrast therapy, and athlete post-exercise recovery protocols are adjacent variants rather than interchangeable proof. Public protocol and explainer sources are context only.

## What to watch

The most defensible first-run signal is **acute subjective mood**, not a guaranteed health outcome. Direct or near-direct mood records are encouraging in some screened young or healthy samples, but they are short-horizon and mixed enough that Murph should test them personally rather than promise them.

Watch safety and burden at least as strongly as mood:

- Was breathing controlled within the first 15–30 seconds?
- Did you exit exactly as planned?
- Did rewarming feel straightforward?
- Did HRV, resting heart rate, sleep, blood pressure, or next-day fatigue look worse?
- Did you need more effort, supervision, or recovery time than expected?

Safety-first interpretation is evidence-backed because cold-water immersion can provoke cold shock, gasping or hyperventilation, sympathetic/catecholamine load, blood-pressure/heart-rate strain, and drowning/submersion hazards.

## How to run a session

1. Confirm the safety screen is still negative.
2. Measure and log water temperature with a thermometer; do not start if unmeasured, below 10 °C for the first default Murph run, or the setup changed since onboarding.
3. Confirm the exit/rescue and gentle rewarming plan, including another adult nearby and able to help for the first session or any changed, colder, or uncertain setup.
4. Start with the shortest planned time, especially for the first session.
5. Enter slowly enough to keep breathing controlled; exit if controlled breathing is not restored within 15–30 seconds or you cannot speak in short sentences.
6. Keep your head out of the water.
7. Exit at the planned time or immediately at any stop condition.
8. Dry off, dress warmly, and rewarm gently.
9. Log mood, cold-shock intensity, symptoms, temperature, duration, and context.

## What to log

Use the same mood scale every time. A simple 0–10 score is enough.

Log before and after each session:

- mood
- stress or calm rating if you track it
- water temperature
- time in water
- breathing control
- cold-shock intensity
- symptoms or stop conditions
- rewarming time
- sleep, illness, alcohol/sedatives, sauna, hard training, or unusual stress

## Stop conditions

Stop immediately for unmeasured or below-range first-run water, changed setup, no safe exit, no adult nearby for first exposure, uncontrolled gasping, breathing not controlled within 15–30 seconds, inability to speak in short sentences, chest pain/pressure, severe breathlessness, new wheeze, palpitations, faintness/fainting, confusion, severe headache, visual changes, loss of coordination, hives/swelling/throat tightness, severe or worsening numbness, weakness, clumsiness, slurred speech, inability to grip/step out/dress, inability to rewarm, persistent or worsening shivering, unsafe footing, stuck cover/door, open-water conditions, alcohol/sedatives/recreational drugs, or any doubt that you can rewarm safely.

Do not “push through” a stop condition. Exit immediately, end the session, and do not repeat the next session until the cause is resolved. Seek urgent/emergency help for chest symptoms, fainting, confusion/non-responsiveness, severe or persistent shortness of breath, wheeze/throat tightness/swelling, suspected submersion/aspiration, inability to rewarm, worsening shivering, slurred speech, severe clumsiness, or persistent cold stress. The protocol’s first job is to keep the user safe enough that any signal is interpretable.

## What not to claim

Do not use this protocol page to claim that cold plunges prevent illness, treat inflammation, improve cardiovascular health, improve sleep, improve cognition, raise HRV, or improve sports performance in general. The recovered evidence is mixed, adjacent, short-term, or safety-heavy for those endpoints.

## Evidence snapshot

The evidence landscape is mixed. There are plausible acute mood signals, repeated-exposure habituation signals, and strong safety boundaries. There is not yet a landing-ready basis for broad durable health claims. The full source-specific interpretation lives in the standalone evidence appraisals at `packages/health-commons/content/evidence-appraisals/source-protocol-evidence/cold-water-immersion.jsonl`.
