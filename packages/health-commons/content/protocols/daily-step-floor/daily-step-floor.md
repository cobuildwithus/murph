---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:daily-step-floor/daily-step-floor
slug: protocols/daily-step-floor/daily-step-floor
title: Daily Step Floor
summary: A daily minimum step count, where a visible floor ensures enough steady low-grade cardiovascular and weight-bearing load for the body to adapt to rather than lose.
status: field-testing
quality: usable
aliases:
- Daily step-count floor
- Phone step goal
- 10,000 steps per day
- 10000 steps per day
- 6,000 steps per day
- 8,000 steps per day
- 12,000 steps per day
- Baseline plus step ramp
- Progressive step-count ramp
categories:
- walking
- activity
- wearable-metric
- behavior-change
- self-experiment
- murph-canonical
media:
- kind: image
  relativePath: design-assets/hero-daily-step-floor.jpeg
  mediaType: image/jpeg
  caption: Daily Step Floor
relations:
- type: parent_family
  target: experiment_family:daily-step-floor
- type: primary_biomarker
  target: biomarker:resting-heart-rate
- type: secondary_biomarker
  target: biomarker:estimated-vo2max
- type: secondary_biomarker
  target: biomarker:sleep-efficiency
- type: secondary_biomarker
  target: biomarker:musculoskeletal-pain
- type: secondary_biomarker
  target: biomarker:walking-safety-events
- type: secondary_biomarker
  target: biomarker:morning-blood-pressure
- type: secondary_biomarker
  target: biomarker:sedentary-time
- type: cites
  target: source_artifact:daily-step-floor-bibliography
lineage:
  relationship: root
  rationale: Default Murph canonical daily total-step-floor experiment; keeps cadence prescriptions, post-meal walking, structured exercise, weight-loss/coaching bundles, social competitions, rehabilitation, and clinical disease-treatment protocols as adjacent variants or context.
attribution:
  ownerType: murph
  note: Drafted from the Daily Step Floor research workspace and canonical ledger in the supplied snapshot.
protocol:
  doseSignature: 7–14 day baseline · chosen daily step floor · 28 day intervention · one consistent step source
  target: A daily total-step floor chosen from recent baseline, safety constraints, and burden tier; cadence or MVPA is optional logging, not part of the canonical dose.
  frequency:
    sessionsPerWeek: 7
  interventionSessionsMinimum: 21
  interventionSessionsTarget: 28
  steps:
    - "Pick 1 step source—phone, watch, wearable, or pedometer—and keep placement and wear/carry rules stable."
    - "Observe baseline 7–14 days before raising the target; use lower floors or guidance when safety context is uncertain."
    - "Choose floor before day 1: baseline-only, baseline +1,000–2,000, fixed 6k/8k/10k/12k, or custom ramp."
    - "Set fallback rule for poor sleep, illness, pain, heat, hazardous routes, travel, or disruption."
    - "Fill the step gap safely with errands, indoor laps, breaks, commute walking, or an easy planned walk."
    - "Accumulate steps however fits; cadence or MVPA targets belong to a separate variant."
    - "Log steps, floor hit, device gaps, intentional walking, pain, symptoms, recovery, sleep, illness, terrain, and confounders."
    - "Review weekly; lower, slow, or stop if pain, recovery, safety, sleep, or life friction worsens."
  tips:
  - Baseline first: wear the same tracker 7–14 days before raising your floor.
  - Set a floor from baseline: baseline-only, +1,000–2,000, 6k, 8k, 10k, 12k, or a ramp.
  - Fill gaps early with errands, indoor laps, walking breaks, commute walks, or one easy planned walk.
  - Use fallback days for poor sleep, illness, pain, heat, travel, unsafe routes, or recovery debt.
  - Do not turn the floor into cadence, MVPA, races, social challenges, or a new training plan.
  - Compare weekly median and floor-hit days; flag device gaps, switched devices, or phone-left-behind days.
  safetyNotes:
  - 'For low baseline activity, frailty, injury recovery, pregnancy/postpartum status, acute illness, pain, or cardiopulmonary symptoms, use baseline-only observation, a lower floor, a slower ramp, or clinician-guided adaptation rather than forcing a fixed public target. Source keys: source_artifact:pmid-29961442; source_artifact:healthgov-physical-activity-guidelines-americans-2018-11-12; source_artifact:govuk-physical-activity-guidelines-2019-09-07; source_artifact:who-physical-activity-guidelines-2020-11-25.'
  keepInMind:
  - A 10,000-step floor is an example, not the default requirement or a universal threshold.
  - 'Baseline-plus, 8,000, 10,000+, and other fixed floors are commitment tiers, not evidence-equivalent thresholds; interpret them through baseline capacity, safety limits, and burden. Source keys: source_artifact:pmid-14715035; source_artifact:pmid-21798044; source_artifact:pmid-35247352; source_artifact:pmid-40713949.'
  - Step-count gains show exposure and adherence; the outcome win is downstream improvement or stability in resting heart rate, blood pressure, fitness, sleep, pain, safety, and sedentary-time context.
  - Walking volume can become unsafe or counterproductive when the user has very low baseline activity, frailty, injury recovery, acute illness, heat exposure, foot wounds, neuropathy, cardiopulmonary symptoms, meaningful fall risk, pregnancy/postpartum restrictions, or worsening pain.
  - Support features such as reminders, social accountability, incentives, or coaching can be useful, but log them because they may become the real active ingredient.
  logFields:
  - daily_step_count
  - selected_step_floor
  - floor_hit
  - step_source
  - device_wear_or_carry_gap
  - device_change
  - baseline_activity_level
  - intentional_walking_minutes
  - intentional_exercise_or_training
  - sedentary_interruptions
  - pain_or_soreness_rating
  - safety_symptoms
  - fatigue_or_recovery_rating
  - sleep_disruption
  - illness_or_fever
  - injury_or_recovery_status
  - weather_heat_or_route_risk
  - footwear_or_terrain_change
  - footwear_change
  - terrain_change
  - unusual_work_travel_or_caregiving
  - occupational_walking
  - concurrent_training_or_rehab
  sessionFieldIds:
  - daily_step_count
  - selected_step_floor
  - floor_hit
  - step_source
  - device_wear_or_carry_gap
  - device_change
  - baseline_activity_level
  - intentional_walking_minutes
  - intentional_exercise_or_training
  - pain_or_soreness_rating
  - fatigue_or_recovery_rating
  - safety_symptoms
  - sleep_disruption
  - life_friction
  - route_weather_or_heat
  - injury_or_recovery_status
  - occupational_walking
  stopConditions:
  - Stop immediately for chest pain or pressure, syncope or near-syncope, fainting or near-fainting, severe dizziness, confusion, severe or unusual shortness of breath, or neurologic symptoms.
  - Pause and seek appropriate guidance for a fall, near-fall pattern, new or worsening foot wound, skin breakdown, severe blistering, or concerning foot symptoms.
  - Downshift or stop for new or worsening foot, ankle, knee, hip, shin, or back pain that changes gait, persists, or worsens across days.
  - Pause for heat-illness symptoms, fever, acute illness, dehydration concerns, or recovery debt that makes the floor require pushing through symptoms.
  - Do not start unsupervised without appropriate guidance when there is active diabetic foot disease or offloading, unstable cardiopulmonary disease, major balance/fall risk, frailty or severe deconditioning, injury recovery requiring restrictions, pregnancy/postpartum restrictions, or clinician-imposed activity limits.
testPlans:
- planId: wearable-step-floor-42d
  durationDays: 42
  baselineDays: 14
  interventionDays: 28
  primaryBiomarkerKey: biomarker:resting-heart-rate
  secondaryBiomarkerKeys:
  - biomarker:estimated-vo2max
  - biomarker:sleep-efficiency
  - biomarker:morning-blood-pressure
  - biomarker:sedentary-time
  - biomarker:musculoskeletal-pain
  safetyOutcomeKeys:
  - biomarker:walking-safety-events
  - biomarker:musculoskeletal-pain
  minimumAdherenceSessions: 21
  targetAdherenceSessions: 28
  notes:
  - Use the same device and carry/wear rule during baseline and intervention.
  - Daily step count and floor-hit days are exposure and adherence context, not the outcome win.
  - Flag device gaps, illness, travel, weather/heat, pain, route risk, and concurrent exercise or rehab.
  - Do not count a high step total as success if safety symptoms, pain, recovery debt, or life friction worsened.
expectedSignalDescriptions:
- biomarkerKey: biomarker:daily-step-count
  expected: up_or_stable
  expectedDirection: up_or_stable
  protocolProminence: focus
  description: The primary exposure signal is whether total daily steps rise versus baseline without worsening safety, pain, or recovery.
- biomarkerKey: biomarker:step-floor-days
  expected: up_or_stable
  expectedDirection: up_or_stable
  protocolProminence: focus
  description: Floor-hit days are the adherence signal; a high count with pain, unsafe symptoms, or obsessive behavior is not a good result.
- biomarkerKey: biomarker:resting-heart-rate
  expected: down_or_stable
  protocolProminence: focus
  description: 'Easy extra walking improves aerobic efficiency and stroke volume, reducing the resting beats needed when the added dose stays recoverable.'
  estimatedChange:
    kind: absolute
    low: -2
    high: 0
    unit: bpm
    window: 4 weeks
    confidence: low
    basis: 'Broad exercise evidence shows larger average resting-heart-rate drops, but a plain step floor is lower intensity and the 28-day window is short. Source keys: source_artifact:pmid-30513777; source_artifact:pmid-21088304.'
- biomarkerKey: biomarker:estimated-vo2max
  expected: up_or_stable
  protocolProminence: focus
  description: 'Added walking gives low-intensity aerobic practice, improving oxygen delivery most when baseline activity is low.'
  estimatedChange:
    kind: absolute
    low: 0
    high: 1
    unit: ml/kg/min
    window: 4-8 weeks
    confidence: low
    basis: 'Structured aerobic training often produces larger VO2max gains, while step-floor evidence is lower-intensity and mixed. Source keys: source_artifact:pmid-23802053; source_artifact:pmid-24128075; source_artifact:pmid-20484759.'
- biomarkerKey: biomarker:morning-blood-pressure
  expected: down_or_stable
  protocolProminence: focus
  description: 'Repeated walking improves vascular tone and replaces sitting, reducing resistance against each heartbeat.'
  estimatedChange:
    kind: absolute
    low: -4
    high: 0
    unit: mmHg systolic
    window: 4-12 weeks
    confidence: low
    basis: 'Pedometer reviews and step-goal studies report modest systolic-pressure reductions, but effects are smaller or absent in normotensive users. Source keys: source_artifact:pmid-18029834; source_artifact:pmid-37623330; source_artifact:pmid-23802053.'
- biomarkerKey: biomarker:sleep-efficiency
  expected: mixed_or_contextual
  protocolProminence: context
  description: 'Daytime movement builds sleep pressure; late or oversized step gaps keep the body activated and fragment sleep.'
  estimatedChange:
    kind: absolute
    low: -1
    high: 2
    unit: "%"
    window: 4 weeks
    confidence: low
    basis: 'Daily-step and walking-intervention sleep evidence is mixed, with stronger signals for self-reported sleep quality than wearable sleep efficiency. Source keys: source_artifact:pmid-41352200; source_artifact:pmid-31358470; source_artifact:pmid-26100101.'
- biomarkerKey: biomarker:musculoskeletal-pain
  expected: down_or_stable
  protocolProminence: focus
  description: 'A modest ramp builds tissue tolerance; rising foot, shin, knee, hip, or back pain signals load is too steep.'
  estimatedChange:
    kind: absolute
    low: -1
    high: 0
    unit: points
    window: 4 weeks
    confidence: low
    basis: 'Pain is mainly a safety/tolerability signal for this protocol; walking studies report musculoskeletal complaints when load is too high. Source keys: source_artifact:pmid-22843637; source_artifact:pmid-26289360; source_artifact:daily-step-floor-pmid-17521443.'
- biomarkerKey: biomarker:walking-safety-events
  expected: down_or_stable
  protocolProminence: focus
  description: 'Falls, near-falls, chest symptoms, heat symptoms, and foot or skin problems show the dose is unsafe.'
  estimatedChange:
    kind: absolute
    low: 0
    high: 0
    unit: new events
    window: 4 weeks
    confidence: moderate
    basis: 'Activity trials report few intervention-attributed serious events when screening and monitoring are used, but high-risk users still need conservative rules. Source keys: source_artifact:pmid-15921486; source_artifact:daily-step-floor-pmid-17521443; source_artifact:doi-10.1016-j.bjpt.2023.100500.'
- biomarkerKey: biomarker:sedentary-time
  expected: down_or_stable
  protocolProminence: context
  description: 'Filling the floor from sitting replaces chair time with light movement.'
  estimatedChange:
    kind: absolute
    low: -30
    high: 0
    unit: min/day
    window: 4 weeks
    confidence: low
    basis: 'Step-counter meta-analysis estimated about 23 fewer sedentary minutes per day, but effects depend on goals, reminders, and baseline sitting. Source keys: source_artifact:pmid-26334900; source_artifact:pmid-33036635; source_artifact:pmid-22843637.'
- biomarkerKey: biomarker:moderate-to-vigorous-activity-minutes
  expected: mixed_or_contextual
  expectedDirection: mixed_or_contextual
  protocolProminence: context
  description: MVPA is a secondary interpretation signal, not proof that a total-step floor hit an intensity guideline.
- biomarkerKey: biomarker:walking-bout-minutes
  expected: mixed_or_contextual
  expectedDirection: mixed_or_contextual
  protocolProminence: context
  description: Bout minutes explain how the floor was achieved, while the core protocol remains total daily steps.
- biomarkerKey: biomarker:walking-cadence
  expected: mixed_or_contextual
  expectedDirection: mixed_or_contextual
  protocolProminence: context
  description: Cadence belongs in interpretation because turning the goal into a cadence prescription changes the intervention into a different MVPA variant.
experimentOnboarding:
  schemaVersion: "murph.commons.experiment-onboarding.v2"
  startIntent:
    displayPrompt: "Hey Murph, I want to explore a Daily Step Floor experiment."
    intentSummary: "Explore Daily Step Floor"
  safetyScreen:
    dispositionIfAnyPositive: "clinician_guidance_before_unsupervised_start"
    mustAsk:
      - id: "cardiopulmonary_red_flags"
        prompt: "Any chest pain or pressure, syncope or near-syncope, severe dizziness, severe unusual shortness of breath, palpitations with symptoms, or known unstable heart/lung condition that could make more walking unsafe?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "movement_pain_falls_risk"
        prompt: "Any current injury or injury recovery, foot/ankle/knee/hip/back pain worsened by walking, recent falls or near-falls, balance limitation, frailty, gait aid change, or unsafe route constraint?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "special_contexts"
        prompt: "Any active foot wound or diabetic neuropathy/ulcer risk, pregnancy or early postpartum context, frailty or very low baseline activity, acute illness or fever, heat-illness risk, or clinician-imposed activity restriction?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
    stopIf:
      additionalConditions:
        - "new or worsening pain that changes gait"
        - "fall or repeated near-fall"
        - "foot wound or skin breakdown"
        - "chest pain, syncope or near-syncope, severe dizziness, severe unusual shortness of breath"
        - "heat illness, fever, or acute illness"
  setupSlots:
    - id: "step_source"
      label: "Step source of truth"
      question: "Which source should be treated as the source of truth for daily steps?"
      options:
        - "phone"
        - "watch_or_wearable"
        - "pedometer"
      target:
        object: "protocol"
        field: "stepSource"
    - id: "baseline_window"
      label: "Baseline window"
      question: "Use a 7-day or 14-day baseline before setting the floor?"
      options:
        - "seven_days"
        - "fourteen_days"
      target:
        object: "analysisPlan"
        field: "baselineWindow"
    - id: "floor_tier"
      label: "Step-floor tier"
      question: "Which floor tier should the experiment use?"
      options:
        - "baseline_observation"
        - "baseline_plus_1000"
        - "baseline_plus_2000"
        - "fixed_6000"
        - "fixed_8000"
        - "fixed_10000"
        - "fixed_12000"
        - "custom_ramp"
      target:
        object: "protocol"
        field: "floorTier"
    - id: "custom_ramp_rule"
      label: "Custom ramp rule"
      question: "If using a custom ramp, what exact daily floor or weekly ramp rule should Murph record?"
      constraints:
        optional: true
      target:
        object: "protocol"
        field: "customRampRule"
    - id: "fallback_rule"
      label: "Fallback rule"
      question: "What should happen on pain, illness, poor sleep, travel, heat, or hazardous-route days?"
      options:
        - "reduce_to_baseline"
        - "reduce_by_2000"
        - "rest_and_log_safety"
        - "custom_recovery_floor"
      target:
        object: "protocol"
        field: "fallbackRule"
    - id: "route_weather_constraints"
      label: "Route and weather constraints"
      question: "Any route, traffic, terrain, heat, or weather constraints that should shape walking plans?"
      constraints:
        optional: true
      target:
        object: "onboardingCapture"
        field: "routeWeatherConstraints"
    - id: "reminder_preference"
      label: "Reminder preference"
      question: "Would reminders help, and when should Murph avoid nudging?"
      constraints:
        optional: true
        askWhen: "at_confirmation"
      target:
        object: "assistantSupport"
        field: "reminderPreference"
  planDefaults:
    testPlanId: "wearable-step-floor-42d"
    firstSessionGuidance: "Start with a conservative floor chosen from baseline. The first week is for repeatability and safety, not maximal steps; low baseline activity, frailty, injury recovery, pregnancy/postpartum status, pain, acute illness, or cardiopulmonary symptoms should push the plan toward baseline-only, a lower floor, a slower ramp, or clinician-guided adaptation."
  trackingHints:
    confounderFields:
      - "device_change"
      - "phone_not_carried"
      - "watch_off_time"
      - "unusual_work_or_occupational_walking"
      - "travel"
      - "illness_or_fever"
      - "sleep_disruption"
      - "injury_or_recovery_status"
      - "injury_or_pain"
      - "weather_or_heat"
      - "footwear_change"
      - "terrain_change"
      - "intentional_exercise_program"
      - "concurrent_training"
      - "diet_or_weight_loss_change"
      - "medication_change"
  supportHints:
    missedLogFollowupCopy: "Would you like to log yesterday’s steps and whether anything affected walking or device data?"
whyItWorks:
  - "## Visible floor raises exposure\n\nA step floor turns activity into a daily threshold. The number changes behavior first; downstream fitness, blood pressure, sleep, and pain depend on the added load being real and recoverable."
  - "## Low-grade load accumulates\n\nWalking adds circulation, weight bearing, and muscle contractions without a formal workout. Repeated daily volume replaces sitting with enough movement for small cardiovascular and tissue signals."
  - "## Ramp protects adaptation\n\nBaseline matters. A floor that jumps too high turns walking into pain, fatigue, heat risk, or fall risk. The right floor increases exposure without breaking recovery."
mechanismChain:
  -
    label: "Daily dose"
    content: "Step floor · same source of truth · baseline-informed target"
  -
    label: "Acute effect"
    content: "Light aerobic work replaces sitting; joints and vessels get low load"
  -
    label: "Repeated signal"
    content: "Movement volume · weight bearing · circulation stay above baseline"
  -
    label: "Adaptation"
    content: "Better aerobic efficiency · lower vascular resistance · stronger walking tolerance"
claims:
- claimId: canonical-daily-total-step-floor-scope
  type: evidence_scope
  strength: moderate
  text: Canonical Daily Step Floor means a daily total-step minimum recorded with a pedometer, wearable tracker, or smartphone step counter; fixed, personalized, or ramped floors stay in scope when the active ingredient remains total daily steps.
  sourceKeys:
  - source_artifact:pmid-33036635
  - source_artifact:pmid-18029834
  - source_artifact:pmid-19791652
  - source_artifact:pmid-15809569
  - source_artifact:pmid-22429600
  - source_artifact:pmid-24982490
  caveats:
  - The direct evidence includes heterogeneous devices and support components, so this does not prove that every possible floor or tracker setup works identically.
- claimId: step-count-monitoring-can-raise-steps
  type: intervention_result
  strength: high
  text: Step-count monitoring, pedometers, apps, or explicit daily step targets can increase daily steps in adult samples over short-to-medium durations.
  sourceKeys:
  - source_artifact:pmid-33036635
  - source_artifact:pmid-18029834
  - source_artifact:pmid-19791652
  - source_artifact:pmid-15809569
  - source_artifact:pmid-21453540
  - source_artifact:pmid-24982490
  - source_artifact:pmid-29335328
  caveats:
  - Longer-term maintenance is mixed, and step gains should not be translated into guaranteed blood-pressure, glycemic, weight, mood, or sleep benefits.
- claimId: ten-thousand-is-example-not-magic-threshold
  type: design_guardrail
  strength: moderate
  text: A 10,000-step floor is a familiar example, not the canonical requirement or a universal health threshold; fixed and baseline-plus floors are commitment tiers rather than evidence-equivalent thresholds, and the selected floor should fit baseline capacity, safety limits, and burden.
  sourceKeys:
  - source_artifact:pmid-14715035
  - source_artifact:pmid-21798015
  - source_artifact:pmid-21798044
  - source_artifact:pmid-30127487
  - source_artifact:pmid-35247352
  - source_artifact:pmid-34477847
  - source_artifact:pmid-40713949
  caveats:
  - Most cut-point and dose-response sources are observational or classification context, not randomized floor-assignment evidence.
- claimId: personalized-ramped-floors-stay-in-scope
  type: design_guardrail
  strength: moderate
  text: Baseline-plus, ramped, or personalized floors can stay inside Daily Step Floor when the prescribed dose remains a daily total-step minimum and the ramp is implementation rather than a different active ingredient.
  sourceKeys:
  - source_artifact:pmid-22429600
  - source_artifact:pmid-26150019
  - source_artifact:pmid-33252961
  - source_artifact:pmid-26860430
  - source_artifact:10000steps-setting-step-goal-2026-04-26
  caveats:
  - If adaptive rewards, coaching, social competition, or another behavior-change component is required for the effect, that component should be separated as an adjacent variant.
- claimId: same-device-and-placement-matter
  type: design_guardrail
  strength: moderate
  text: A step-floor experiment should use one source of truth and a consistent carry or wear rule because consumer step counts vary by device, placement, gait, activity type, and validation setting.
  sourceKeys:
  - source_artifact:pmid-33361276
  - source_artifact:pmid-33953288
  - source_artifact:doi-10.1186-s13102-024-00943-0
  - source_artifact:doi-10.1123-jmpb.2022-0022
  - source_artifact:doi-10.3390-s20216293
  caveats:
  - Use within-person trend changes rather than cross-device absolute comparisons.
- claimId: cadence-mvpa-bouts-are-adjacent-variants
  type: design_guardrail
  strength: high
  text: Cadence or intensity prescriptions, such as 100 steps per minute or step-bout MVPA targets, should be treated as adjacent cadence/MVPA variants rather than the canonical total-step-floor protocol.
  sourceKeys:
  - source_artifact:pmid-19362695
  - source_artifact:pmid-23059868
  - source_artifact:pmid-24528783
  - source_artifact:pmid-28459099
  - source_artifact:pmid-30654810
  - source_artifact:pmid-33168018
  - source_artifact:pmid-34556146
  caveats:
  - Cadence can be logged as secondary context, but requiring cadence changes the dose and burden.
- claimId: downstream-health-outcomes-are-secondary-and-mixed
  type: mixed_evidence
  strength: moderate
  text: Daily Step Floor is best supported as a step-behavior intervention; cardiometabolic, fitness, sleep, mood, quality-of-life, and mortality-related endpoints should be treated as secondary, mixed, indirect, or exploratory.
  sourceKeys:
  - source_artifact:pmid-16979410
  - source_artifact:pmid-21453540
  - source_artifact:pmid-30127487
  - source_artifact:pmid-33036635
  - source_artifact:doi-10.1136-bmjopen-2024-088524
  caveats:
  - Some direct trials report null or mixed secondary endpoints even when step behavior improves; observational dose-response evidence should not be framed as causal proof of this protocol.
- claimId: support-addons-change-the-protocol-question
  type: mixed_evidence
  strength: moderate
  text: Financial incentives, reminders, app features, coaching, social support, and gamification can be useful implementation supports, but they should be logged or separated when they are the active ingredient being tested.
  sourceKeys:
  - source_artifact:pmid-29718931
  - source_artifact:pmid-32182353
  - source_artifact:pmid-21169160
  - source_artifact:pmid-26895847
  - source_artifact:pmid-36396151
  caveats:
  - These supports change adherence mechanics, cost, burden, and sustainability relative to a simple daily floor.
- claimId: safety-ramp-and-stop-conditions-override-adherence
  type: safety
  strength: moderate
  text: 'Safety and repeatability should override floor-hitting: low baseline activity, frailty, injury recovery, pregnancy/postpartum restrictions, worsening musculoskeletal pain, cardiopulmonary symptoms, foot or skin problems, falls or near-falls, heat illness, acute illness, or poor recovery should trigger a lower floor, slower ramp, pause, or clinician guidance.'
  sourceKeys:
  - source_artifact:pmid-15921486
  - source_artifact:daily-step-floor-pmid-17521443
  - source_artifact:pmid-26289360
  - source_artifact:pmid-18801859
  - source_artifact:doi-10.1016-j.bjpt.2023.100500
  - source_artifact:doi-10.1016-j.diabres.2021.108733
  - source_artifact:who-physical-activity-guidelines-2020-11-25
  - source_artifact:pmid-29961442
  - source_artifact:healthgov-physical-activity-guidelines-americans-2018-11-12
  - source_artifact:govuk-physical-activity-guidelines-2019-09-07
  caveats:
  - Batch 012 safety guideline records were preserved as metadata-only stubs when extraction artifacts were absent, so safety language stays conservative and does not invent adverse-event rates.
researchLandscape:
  bottomLine: Daily Step Floor is landing-ready as a self-experiment for increasing daily step behavior, with conservative safety screening and strict variant separation. The direct evidence is strongest for step-count increases; health endpoints, cut points, cadence, sedentary-time, device validity, guidelines, and safety boundaries are separate evidence lanes.
  confidenceLabel: moderate
  primaryClaim: A conservative, baseline-informed daily step floor can test whether a user’s daily steps increase when measured consistently.
  mainCaveat: Do not promise disease-treatment, mortality, weight, glucose, blood-pressure, sleep, mood, or fitness benefits from the floor alone; many supporting sources are adjacent, observational, measurement-context, guideline, or safety-boundary evidence.
  groups:
  - id: step-count-monitoring-efficacy
    label: Direct step-monitoring evidence
    stance: supports
    summary: 'The strongest direct lane supports a behavior claim: step-count self-monitoring and daily step targets can raise daily steps over short-to-medium durations. It does not establish that every downstream health endpoint improves.'
    sourceKeys:
    - source_artifact:pmid-18029834
    - source_artifact:pmid-19791652
    - source_artifact:pmid-33036635
    defaultOpen: true
  - id: direct-step-floor-rcts
    label: Direct step-floor trials
    stance: mixed
    summary: Direct trials and close app/pedometer variants often increase steps, but secondary outcomes and durability are mixed across populations and support packages.
    sourceKeys:
    - source_artifact:pmid-15809569
    - source_artifact:pmid-16979410
    - source_artifact:pmid-21453540
    - source_artifact:pmid-22429600
    - source_artifact:pmid-24982490
    - source_artifact:pmid-29335328
    - source_artifact:pmid-22200586
    defaultOpen: true
  - id: baseline_plus_ramp_trials
    label: Baseline-plus and ramped goals
    stance: mixed
    summary: Baseline-plus, progressive, and fixed-goal studies support using a floor that fits current capacity, but goal difficulty and bundled support can change adherence and achievement.
    sourceKeys:
    - source_artifact:pmid-11689731
    - source_artifact:pmid-14569279
    - source_artifact:pmid-18021411
    - source_artifact:pmid-18775062
    - source_artifact:pmid-28045890
    - source_artifact:pmid-29371177
    - source_artifact:pmid-39486024
    - source_artifact:pmid-26860430
    - source_artifact:pmid-16911238
    - source_artifact:pmid-23059868
    - source_artifact:pmid-21918241
    - source_artifact:pmid-25493265
    - source_artifact:pmid-29899015
    - source_artifact:pmid-24393423
    - source_artifact:pmid-28918547
    - source_artifact:pmid-33252961
    - source_artifact:pmid-26139447
    - source_artifact:pmid-32182353
    - source_artifact:pmid-26150019
    - source_artifact:pmid-19362695
    - source_artifact:pmid-38583084
    - source_artifact:pmid-18655723
    - source_artifact:pmid-24304838
    - source_artifact:pmid-21088304
    - source_artifact:pmid-37623330
    - source_artifact:pmid-29165018
    - source_artifact:doi-10.1007-s12662-022-00821-2
    - source_artifact:pmid-26810251
    - source_artifact:pmid-28356097
    - source_artifact:pmid-29522529
    - source_artifact:pmid-28074635
    - source_artifact:pmid-26860434
    - source_artifact:pmid-22585884
    - source_artifact:pmid-25689364
    - source_artifact:pmid-24349392
  - id: dose_response_cut_points
    label: Observational dose-response and cut points
    stance: context_only
    summary: Step-count cut points and dose-response curves are useful target context, but they are not proof that assigning this protocol causes mortality, cardiovascular, dementia, or metabolic outcomes.
    sourceKeys:
    - source_artifact:doi-10.1136-bmjopen-2024-088524
    - source_artifact:pmid-14715035
    - source_artifact:pmid-21798044
    - source_artifact:pmid-35247352
    - source_artifact:pmid-40713949
    - source_artifact:pmid-23438219
    - source_artifact:pmid-34029758
    - source_artifact:pmid-36066874
    - source_artifact:pmid-32207799
    - source_artifact:pmid-32427398
    - source_artifact:pmid-36216933
    - source_artifact:pmid-31141585
    - source_artifact:pmid-35050362
    - source_artifact:pmid-35428253
    - source_artifact:pmid-29685125
    - source_artifact:pmid-33256704
    - source_artifact:pmid-38442950
    - source_artifact:clinicaltrials-nct03845478-2026-04-26
    - source_artifact:pmid-18022061
    - source_artifact:pmid-27556393
    - source_artifact:pmid-26536618
    - source_artifact:pmid-36094529
    - source_artifact:pmid-38566344
    - source_artifact:pmid-34477847
    - source_artifact:pmid-19453204
    - source_artifact:pmid-34417979
    - source_artifact:pmid-39680407
    - source_artifact:pmid-31095077
    - source_artifact:pmid-38901742
    - source_artifact:pmid-21798015
    - source_artifact:pmid-36537288
    - source_artifact:pmid-37676198
    - source_artifact:pmid-18562971
    - source_artifact:pmid-32563261
    - source_artifact:pmid-37555441
    - source_artifact:pmid-34547483
  - id: measurement-validity-standards-reviews-general-validation
    label: Measurement validity and source-of-truth rules
    stance: context_only
    summary: Consumer and research devices can estimate steps, but accuracy varies by device, placement, gait, speed, wear/carry pattern, and validation setting, so Daily Step Floor should compare within-person trends using one source of truth.
    sourceKeys:
    - source_artifact:pmid-33361276
    - source_artifact:pmid-33953288
    - source_artifact:doi-10.1186-s13102-024-00943-0
    - source_artifact:doi-10.5888-pcd19.210343
    - source_artifact:pmid-33447097
    - source_artifact:pmid-31518367
    - source_artifact:pmid-36188762
    - source_artifact:pmid-22157772
    - source_artifact:pmid-25517396
    - source_artifact:pmid-21904249
    - source_artifact:pmid-27589592
    - source_artifact:pmid-31851949
    - source_artifact:pmid-31524786
    - source_artifact:pmid-35060915
    - source_artifact:pmid-30093371
    - source_artifact:pmid-25668268
    - source_artifact:pmid-28666177
    - source_artifact:pmid-31828072
    - source_artifact:pmid-25121517
    - source_artifact:pmid-28078908
    - source_artifact:pmid-36535270
    - source_artifact:doi-10.1186-s12984-022-01085-5
    - source_artifact:pmid-27912681
    - source_artifact:pmid-28659255
    - source_artifact:pmid-35679106
    - source_artifact:pmid-32897239
    - source_artifact:pmid-28005190
    - source_artifact:pmid-26684758
    - source_artifact:pmid-29704922
    - source_artifact:pmid-25890168
    - source_artifact:pmid-38481238
    - source_artifact:doi-10.3390-technologies11010029
    - source_artifact:pmid-29179653
  - id: measurement_validity_device_placement_gait_adl_tracker_comparisons
    label: Device placement, gait, and ADL comparisons
    stance: context_only
    summary: Device comparisons reinforce the rule that phone pocket, wrist, hip, gait speed, and activity type can change counts; do not switch devices mid-experiment without flagging the day.
    sourceKeys:
    - source_artifact:doi-10.1123-jmpb.2022-0022
    - source_artifact:doi-10.3390-s20216293
    - source_artifact:doi-10.3390-technologies9030055
    - source_artifact:pmid-18091020
    - source_artifact:pmid-22483530
    - source_artifact:pmid-24795762
    - source_artifact:pmid-29662048
    - source_artifact:pmid-30117355
    - source_artifact:pmid-39532924
    - source_artifact:pmid-29718452
    - source_artifact:pmid-29977979
    - source_artifact:pmid-35783129
    - source_artifact:pmid-29729611
    - source_artifact:pmid-28138464
    - source_artifact:pmid-38384680
    - source_artifact:pmid-29610110
    - source_artifact:pmid-33447097
    - source_artifact:pmid-30373549
    - source_artifact:pmid-36812638
    - source_artifact:pmid-37966891
    - source_artifact:pmid-32601613
    - source_artifact:pmid-28777710
    - source_artifact:pmid-32509137
    - source_artifact:pmid-30545810
    - source_artifact:pmid-40724167
    - source_artifact:pmid-25881662
    - source_artifact:pmid-36188762
    - source_artifact:pmid-28339904
    - source_artifact:pmid-31518367
  - id: cadence_intensity_bouts_mvpa_context
    label: Cadence, MVPA, and bout context
    stance: context_only
    summary: Cadence and bout evidence helps interpret intensity, but adding cadence or MVPA requirements changes the protocol dose and should be treated as an adjacent variant.
    sourceKeys:
    - source_artifact:doi-10.7326-annals-25-01547
    - source_artifact:pmid-28459099
    - source_artifact:pmid-30654810
    - source_artifact:pmid-33168018
    - source_artifact:pmid-34556146
    - source_artifact:pmid-38031156
    - source_artifact:pmid-31698337
    - source_artifact:pmid-36403207
    - source_artifact:pmid-29858465
    - source_artifact:pmid-30400331
    - source_artifact:pmid-31095078
    - source_artifact:pmid-33568188
    - source_artifact:pmid-39554950
    - source_artifact:pmid-38852004
    - source_artifact:pmid-28253056
    - source_artifact:pmid-29567764
    - source_artifact:clinicaltrials-nct07204834-2026-04-26
    - source_artifact:pmid-36976556
    - source_artifact:pmid-35876127
    - source_artifact:pmid-38326857
    - source_artifact:pmid-21297184
    - source_artifact:pmid-41088002
    - source_artifact:pmid-31518246
    - source_artifact:pmid-23335555
    - source_artifact:pmid-22462794
    - source_artifact:pmid-40668771
  - id: sedentary_time_and_activity_pattern_outcomes
    label: Sedentary time and activity pattern outcomes
    stance: mixed
    summary: Sedentary-time and activity-pattern studies are useful for interpretation, but they answer a different question from hitting a daily total-step floor.
    sourceKeys:
    - source_artifact:pmid-22866941
    - source_artifact:pmid-25112481
    - source_artifact:pmid-25907181
    - source_artifact:pmid-26334900
    - source_artifact:pmid-39045858
    - source_artifact:pmid-34169503
    - source_artifact:pmid-40229981
    - source_artifact:pmid-37252261
    - source_artifact:pmid-26623654
    - source_artifact:pmid-41317975
    - source_artifact:pmid-39235836
    - source_artifact:pmid-31409357
    - source_artifact:pmid-39551583
    - source_artifact:pmid-41526810
    - source_artifact:pmid-40217539
    - source_artifact:pmid-29566746
    - source_artifact:pmid-38219269
    - source_artifact:pmid-26431257
    - source_artifact:pmid-31695350
    - source_artifact:pmid-29926475
    - source_artifact:pmid-27526175
    - source_artifact:pmid-37810519
    - source_artifact:pmid-31434697
    - source_artifact:pmid-35977732
    - source_artifact:pmid-35868813
    - source_artifact:pmid-40175011
    - source_artifact:pmid-27604226
    - source_artifact:pmid-33239356
    - source_artifact:pmid-29663984
    - source_artifact:pmid-28892811
    - source_artifact:pmid-28599680
    - source_artifact:pmid-27094749
    - source_artifact:pmid-35552166
    - source_artifact:pmid-28800736
  - id: cardiometabolic-fitness-diabetes-blood-pressure-endpoints
    label: Cardiometabolic, fitness, diabetes, and blood-pressure endpoints
    stance: mixed
    summary: Some populations show favorable secondary signals, but extracted trials and syntheses are mixed enough that Daily Step Floor should not promise blood pressure, glucose, lipid, weight, or fitness improvement.
    sourceKeys:
    - source_artifact:pmid-15539058
    - source_artifact:pmid-17152246
    - source_artifact:pmid-24128075
    - source_artifact:pmid-30127487
    - source_artifact:pmid-38220510
    - source_artifact:pmid-20484759
    - source_artifact:pmid-27589017
    - source_artifact:pmid-30513777
    - source_artifact:pmid-30603352
    - source_artifact:clinicaltrials-nct01475201-2026-04-26
    - source_artifact:pmid-27753558
    - source_artifact:pmid-20732776
    - source_artifact:pmid-23492248
    - source_artifact:pmid-33630309
    - source_artifact:pmid-34496859
    - source_artifact:pmid-31678965
    - source_artifact:pmid-28173623
    - source_artifact:pmid-34283229
    - source_artifact:pmid-26926674
    - source_artifact:pmid-24571580
    - source_artifact:pmid-24528783
    - source_artifact:pmid-32700325
  - id: mental-health-sleep-qol-direct-step-floor-trials
    label: Mood, sleep, and quality-of-life outcomes
    stance: mixed
    summary: Mood, sleep, and quality-of-life measures can be logged, but direct step-floor trials are too mixed and population-specific for a guaranteed mental-health or sleep claim.
    sourceKeys:
    - source_artifact:pmid-20551485
    - source_artifact:pmid-22843637
    - source_artifact:pmid-25895747
    - source_artifact:pmid-29361921
    - source_artifact:pmid-33218524
    - source_artifact:doi-10.1186-s13690-019-0368-7
    - source_artifact:pmid-27471879
  - id: self-monitoring-digital-support
    label: Self-monitoring and digital-support add-ons
    stance: mixed
    summary: Digital feedback, reminders, and support features may improve adherence for some users, but they should be logged as implementation supports or separated when they are the intervention being tested.
    sourceKeys:
    - source_artifact:pmid-21169160
    - source_artifact:pmid-26895847
    - source_artifact:pmid-27658677
    - source_artifact:pmid-41805551
  - id: guidelines_external_protocol_claims_and_history
    label: Guidelines and external 10,000-step claims
    stance: context_only
    summary: Public physical-activity guidelines and external 10,000-step materials provide context and practical history, not proof that this exact Murph protocol has a universal floor or endpoint guarantee.
    sourceKeys:
    - source_artifact:healthgov-physical-activity-guidelines-americans-2018-11-12
    - source_artifact:pmid-30418471
    - source_artifact:daily-step-floor-pmid-33239350
    - source_artifact:who-physical-activity-guidelines-2020-11-25
    - source_artifact:10000steps-counting-your-steps-2026-04-26
    - source_artifact:10000steps-setting-step-goal-2026-04-26
    - source_artifact:doi-10.1111-nbu.12409
    - source_artifact:pmid-35782159
    - source_artifact:govuk-physical-activity-guidelines-2019-09-07
    - source_artifact:pmid-30860691
    - source_artifact:pmid-28870978
    - source_artifact:doi-10.1071-he03095
    - source_artifact:pmid-36129746
    - source_artifact:pmid-17716553
    - source_artifact:pmid-22260810
    - source_artifact:pmid-22390341
    - source_artifact:pmid-21205290
    - source_artifact:pmid-26180040
    - source_artifact:pmid-23503570
    - source_artifact:doi-10.1123-jpah.3.1.1
    - source_artifact:pmid-21393377
    - source_artifact:pmid-41339900
  - id: clinical-walking-safety-monitoring
    label: Clinical walking safety monitoring
    stance: safety_boundary
    summary: Clinical and higher-risk walking sources support conservative screening, slower ramps, and stop conditions rather than blanket clearance for unsupervised self-escalation, especially with low baseline activity, frailty, injury recovery, cardiopulmonary symptoms, or falls risk.
    sourceKeys:
    - source_artifact:pmid-15921486
    - source_artifact:daily-step-floor-pmid-17521443
    - source_artifact:pmid-26289360
    - source_artifact:pmid-29961442
  - id: diabetes-foot-safety
    label: Diabetes foot and neuropathy safety
    stance: safety_boundary
    summary: Diabetes, neuropathy, foot-ulcer, and offloading contexts require individual or clinical guidance before translating a generic step floor into more weight-bearing.
    sourceKeys:
    - source_artifact:doi-10.1016-j.bjpt.2023.100500
    - source_artifact:doi-10.1016-j.diabres.2021.108733
    - source_artifact:pmid-12840628
    - source_artifact:pmid-18801859
    - source_artifact:pmid-37243880
    - source_artifact:pmid-20798179
    - source_artifact:pmid-23276801
  - id: chronic-pain-walking
    label: Chronic-pain and pain-flare boundaries
    stance: safety_boundary
    summary: Walking can be feasible in some pain contexts, but pain flares and musculoskeletal symptoms should drive downshifts, pauses, or clinician-guided adaptation.
    sourceKeys:
    - source_artifact:pmid-23446066
    - source_artifact:pmid-23969029
    - source_artifact:pmid-25012720
    - source_artifact:pmid-33607979
  - id: direct-protocol-context
    label: Direct protocol design context
    stance: mixed
    summary: Close step-floor protocols and follow-up reports help calibrate duration, adherence decay, and secondary endpoints without turning every design paper into efficacy evidence.
    sourceKeys:
    - source_artifact:pmid-23802053
    - source_artifact:pmid-22894138
  - id: cardiometabolic-and-weight-context
    label: Weight and cardiometabolic context
    stance: mixed
    summary: Pedometer and walking studies report some weight, blood-pressure, glucose, and lipid signals, but the results are mixed enough to keep these as secondary outcomes.
    sourceKeys:
    - source_artifact:pmid-18029834
    - source_artifact:pmid-18195317
  - id: wearable-tracker-adjacent-context
    label: Wearable tracker intervention context
    stance: context_only
    summary: Wearable feedback can raise activity in some trials, but broader tracker packages are not the same as testing one daily step floor.
    sourceKeys:
    - source_artifact:pmid-35082116
    - source_artifact:pmid-30977740
  - id: implementation-and-device-context
    label: Implementation and device simplicity
    stance: mixed
    summary: Component evidence supports keeping the protocol simple and logging support features instead of assuming more coaching or devices always improve the result.
    sourceKeys:
    - source_artifact:pmid-33036635
  - id: component-review-context
    label: Self-monitoring component reviews
    stance: context_only
    summary: Reviews of self-monitoring plus added components help interpret goals, counseling, and feedback layers without making them mandatory parts of the protocol.
    sourceKeys:
    - source_artifact:pmid-36396151
  - id: adjacent-coached-app-variants
    label: Coached app and weight-loss variants
    stance: context_only
    summary: Coached app programs can increase steps, but counseling and weight-loss framing change the intervention and should stay adjacent to a simple step floor.
    sourceKeys:
    - source_artifact:pmid-32348263
  - id: adjacent-incentive-social-variants
    label: Incentive and social variants
    stance: mixed
    summary: Financial incentives, peer networks, and family gamification may change goal achievement while the support is active, but they add cost, social pressure, and maintenance questions.
    sourceKeys:
    - source_artifact:pmid-25274710
    - source_artifact:pmid-26881417
    - source_artifact:pmid-26976287
    - source_artifact:pmid-27717766
    - source_artifact:pmid-28973115
    - source_artifact:pmid-30553693
    - source_artifact:pmid-31441936
  - id: motivation-autonomy-adherence-step-targets
    label: Motivation, autonomy, and adherence
    stance: mixed
    summary: Fitness-app and goal-setting studies show that step targets can affect motivation and adherence as well as behavior, so burden and autonomy should be tracked.
    sourceKeys:
    - source_artifact:pmid-32422597
    - source_artifact:doi-10.1080-1612197x.2020.1854820
  - id: diabetes-digital-step-goals
    label: Diabetes digital step-goal variants
    stance: mixed
    summary: Diabetes-specific text-message or digital goal programs are useful implementation context, but their mixed results should not be generalized to all users.
    sourceKeys:
    - source_artifact:pmid-29718931
  - id: adjacent-walking-and-physical-activity-mental-health
    label: Adjacent walking and mental-health context
    stance: context_only
    summary: Walking and general physical-activity reviews can inform mood expectations, but they do not prove that this step-floor protocol treats depression or anxiety.
    sourceKeys:
    - source_artifact:pmid-35416941
    - source_artifact:pmid-25601182
    - source_artifact:pmid-39045858
  - id: mental-health-sleep-qol-step-mental-health-observational
    label: Step count and mental-health cohorts
    stance: context_only
    summary: Observational step-count studies can make mood tracking worthwhile, but they are not causal evidence that raising steps will treat mental-health symptoms.
    sourceKeys:
    - source_artifact:pmid-34979178
    - source_artifact:pmid-36529963
    - source_artifact:pmid-32980870
    - source_artifact:pmid-41674149
  - id: mental-health-sleep-qol-sleep-step-context
    label: Step count and sleep context
    stance: mixed
    summary: Daily-step and sleep studies give useful context for logging sleep quality, while endpoint-specific results remain mixed and indirect.
    sourceKeys:
    - source_artifact:pmid-31358470
    - source_artifact:pmid-41352200
  - id: mental-health-sleep-qol-clinical-population-step-trials
    label: Clinical quality-of-life step trials
    stance: mixed
    summary: Cancer, cardiac, COPD, asthma, and postmenopausal samples show that pedometer programs can affect quality-of-life outcomes, but the clinical context limits consumer protocol claims.
    sourceKeys:
    - source_artifact:pmid-22177854
    - source_artifact:pmid-35454330
    - source_artifact:pmid-28799458
    - source_artifact:pmid-17557948
    - source_artifact:pmid-26100101
  - id: mental-health-sleep-qol-clinical-depression-step-trials
    label: Clinical depression step trials
    stance: does_not_confirm
    summary: Depression-specific pedometer trials are important guardrails because they do not support treating severe depression with a step floor alone.
    sourceKeys:
    - source_artifact:pmid-37589727
  - id: protocol-registry-and-study-protocol-context
    label: Study protocols and registries
    stance: context_only
    summary: Registry records and protocol papers help identify planned endpoints and safety boundaries, but results should come from completed outcome reports.
    sourceKeys:
    - source_artifact:clinicaltrials-nct02850341-2026-04-26
    - source_artifact:pmid-33180994
  - id: cardiac-rehab-step-goals
    label: Cardiac rehab step goals
    stance: context_only
    summary: Cardiac-rehabilitation step-goal studies support supervised clinical use, not unsupervised escalation for people with cardiovascular symptoms or restrictions.
    sourceKeys:
    - source_artifact:pmid-24282749
    - source_artifact:pmid-31714397
    - source_artifact:doi-10.4172-2329-9096.1000157
  - id: copd-cardiopulmonary-step-goals
    label: COPD and cardiopulmonary step goals
    stance: safety_boundary
    summary: COPD and cardiopulmonary walking programs reinforce slow ramps, symptom monitoring, and clinical boundaries for breathlessness, chest pain, and functional limits.
    sourceKeys:
    - source_artifact:pmid-25811395
    - source_artifact:pmid-33913819
    - source_artifact:pmid-27502583
    - source_artifact:pmid-41147625
    - source_artifact:pmid-24491137
    - source_artifact:pmid-29993339
  - id: kidney-special-populations
    label: Kidney disease special populations
    stance: context_only
    summary: Dialysis and kidney-transplant walking trials are special-population evidence and should not be used as generic step-floor proof.
    sourceKeys:
    - source_artifact:pmid-32912051
    - source_artifact:pmid-31679747
  - id: cognitive-impairment-step-prescription
    label: Cognitive impairment step prescriptions
    stance: context_only
    summary: Step prescriptions in cognitive impairment may require assistance, supervision, and fall-risk planning before they resemble a self-directed experiment.
    sourceKeys:
    - source_artifact:pmid-40499016
  - id: postpartum-and-cancer-special-populations
    label: Postpartum and cancer walking contexts
    stance: safety_boundary
    summary: Postpartum and oncology walking studies are feasibility and boundary evidence because recovery status, treatment, fatigue, and clinician limits can dominate the step target.
    sourceKeys:
    - source_artifact:pmid-24460069
    - source_artifact:pmid-22176722
  - id: older-adult-wearable-context
    label: Older-adult tracker context
    stance: context_only
    summary: Older-adult tracker trials can improve activity but are mixed on body composition and function, so age, function, and adherence should shape interpretation.
    sourceKeys:
    - source_artifact:pmid-40179387
  - id: older-adult-falls
    label: Older-adult falls context
    stance: safety_boundary
    summary: Falls-prevention evidence supports broader exercise and balance context, not walking-only step floors as a proven falls intervention.
    sourceKeys:
    - source_artifact:pmid-33239019
  - id: long-term-health-safety-context
    label: Long-term health and safety follow-up
    stance: context_only
    summary: Long-term follow-up can inform expectations about cardiovascular, fracture, falls, diabetes, and depression outcomes, but it remains indirect for a short self-experiment.
    sourceKeys:
    - source_artifact:pmid-31237875
  - id: sedentary-time-context
    label: Sedentary-time tracker context
    stance: mixed
    summary: Tracker studies that fail to reduce sedentary time are useful guardrails against assuming a step floor automatically fixes sitting patterns.
    sourceKeys:
    - source_artifact:pmid-35082116
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
  - active_foot_wound_or_diabetic_foot
  - neuropathy_or_offloading_requirement
  - unstable_cardiopulmonary_symptoms
  - recent_falls_or_balance_limitation
  - unsafe_gait_change
  - pregnancy_or_early_postpartum
  - clinician_activity_restriction
  - low_baseline_frailty_or_deconditioning
  - injury_recovery
  - acute_illness_or_fever
  - heat_illness_risk_or_dehydration
  - new_or_worsening_musculoskeletal_pain
  stopIf:
  - chest pain or pressure, syncope or near-syncope, severe dizziness, confusion, severe unusual shortness of breath, or neurologic symptoms
  - fall, repeated near-fall, or unsafe balance change
  - new or worsening foot wound, skin breakdown, severe blistering, or concerning foot symptoms
  - pain in the foot, ankle, knee, hip, shin, or back that worsens across days or changes gait
  - heat-illness symptoms, fever, acute illness, or recovery debt that makes the floor require pushing through symptoms
  notes:
  - Safety claims use extracted clinical-boundary sources conservatively — no invented adverse-event rates.
  - Batch 012 guideline stubs are metadata-only; do not infer detailed rates from them.
  - Lower floor, slower ramp, or pause beats forcing the number when capacity or safety is marginal.
researchCoverage:
  bibliographyKey: source_artifact:daily-step-floor-bibliography
  corpusStats:
    canonicalLedgerRecords: 334
    sourcePageDraftsRecovered: 320
    metadataOnlyStubsGenerated: 14
    standaloneEvidenceAppraisals: 323
    artifactCandidates: 335
    largestExtractionBatchSize: 36
    auditCutoff: '2026-04-28'
---

# Daily Step Floor

Daily Step Floor is a conservative self-experiment: pick a daily total-step minimum from your own baseline, measure it with one consistent step source, and see whether daily steps rise without making safety, pain, recovery, sleep, or life friction worse.

## What belongs in this protocol

Use this page when the active ingredient is **total daily steps**: a phone, wearable, or pedometer reports the day’s step count, and the user tries to meet a selected floor. Fixed examples such as 6,000, 8,000, 10,000, or 12,000 steps can belong here, as can baseline-plus or ramped floors, as long as the dose remains a daily total-step minimum. Treat those options as commitment tiers rather than evidence-equivalent thresholds. This scope is supported by direct step-monitoring and step-target sources, while cut-point sources remain context rather than proof of a universal floor [source_artifact:pmid-33036635; source_artifact:pmid-18029834; source_artifact:pmid-19791652; source_artifact:pmid-15809569; source_artifact:pmid-22429600; source_artifact:pmid-24982490; source_artifact:pmid-14715035; source_artifact:pmid-21798044; source_artifact:pmid-35247352; source_artifact:pmid-40713949].

## What stays separate

Cadence prescriptions, MVPA minutes, structured exercise sessions, post-meal walking, financial incentives, social competition, gamification, weight-loss bundles, disease treatment, supervised rehabilitation, and clinical gait or foot-care protocols are adjacent variants or context. They may be useful, but they answer different questions from “Can I sustain a daily total-step floor?” [source_artifact:pmid-19362695; source_artifact:pmid-28459099; source_artifact:pmid-26881417; source_artifact:pmid-28973115; source_artifact:doi-10.1016-j.bjpt.2023.100500].

## How to read the result

Daily step count plus floor-hit days show whether the dose happened; they are not the outcome win. A good result means the step trend rises or stays meaningfully above baseline **and** downstream signals such as resting heart rate, blood pressure, wearable fitness estimates or field-test performance, pain, safety, sleep/recovery, and sedentary time improve or stay acceptable. These endpoints remain exploratory because the extracted evidence is mixed, population-specific, or indirect for those outcomes [source_artifact:pmid-16979410; source_artifact:pmid-21453540; source_artifact:pmid-30127487; source_artifact:pmid-33036635; source_artifact:doi-10.1136-bmjopen-2024-088524].

## Measurement rule

Pick one source of truth and keep it stable. Phone-not-carried days, watch-off time, device switching, gait changes, and placement changes can all distort interpretation, so they should be logged rather than silently treated as equivalent data [source_artifact:pmid-33361276; source_artifact:pmid-33953288; source_artifact:doi-10.1186-s13102-024-00943-0; source_artifact:doi-10.1123-jmpb.2022-0022; source_artifact:doi-10.3390-s20216293].

## Safety posture

This is not a “push through the number” challenge. Very low baseline activity, frailty, injury recovery, pain, cardiopulmonary symptoms, falls or near-falls, foot or skin problems, heat illness, acute illness, pregnancy/postpartum restrictions, diabetes-foot risk, or clinician limits should override the floor. When in doubt, downshift, slow the ramp, pause, or seek appropriate guidance rather than trying to preserve adherence [source_artifact:pmid-15921486; source_artifact:daily-step-floor-pmid-17521443; source_artifact:pmid-26289360; source_artifact:pmid-18801859; source_artifact:doi-10.1016-j.bjpt.2023.100500; source_artifact:doi-10.1016-j.diabres.2021.108733; source_artifact:pmid-29961442; source_artifact:healthgov-physical-activity-guidelines-americans-2018-11-12; source_artifact:govuk-physical-activity-guidelines-2019-09-07; source_artifact:who-physical-activity-guidelines-2020-11-25].
