---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:daily-step-floor/daily-step-floor
slug: protocols/daily-step-floor/daily-step-floor
title: Daily Step Floor
summary: Choose a daily minimum step-count floor from your own baseline, then test whether a consistent phone, wearable, or pedometer signal can raise steps without worsening pain, safety, recovery, or life friction.
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
relations:
- type: parent_family
  target: experiment_family:daily-step-floor
- type: primary_biomarker
  target: biomarker:daily-step-count
- type: secondary_biomarker
  target: biomarker:step-floor-days
- type: secondary_biomarker
  target: biomarker:sedentary-time
- type: secondary_biomarker
  target: biomarker:walking-bout-minutes
- type: secondary_biomarker
  target: biomarker:walking-cadence
- type: secondary_biomarker
  target: biomarker:moderate-to-vigorous-activity-minutes
- type: secondary_biomarker
  target: biomarker:musculoskeletal-pain
- type: secondary_biomarker
  target: biomarker:walking-safety-events
- type: secondary_biomarker
  target: biomarker:resting-heart-rate
- type: secondary_biomarker
  target: biomarker:morning-blood-pressure
- type: secondary_biomarker
  target: biomarker:estimated-vo2max
- type: secondary_biomarker
  target: biomarker:sleep-efficiency
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
  - 'Pick one source of truth: phone, watch, wearable, or pedometer. Keep the same device, placement, and carry/wear rule through baseline and intervention.'
  - Observe baseline for 7–14 days before raising the target. If baseline activity is low, pain is present, the user is recovering from injury or acute illness, is pregnant/postpartum, frail, or has cardiopulmonary symptoms, start with baseline-only observation, a lower floor, or clinician-guided adaptation before any increase.
  - Choose the floor before day 1 of the intervention. Acceptable tiers are baseline-only observation, baseline plus 1,000–2,000 steps, a fixed 6,000/8,000/10,000/12,000-step floor, or a custom ramp that is still expressed as total daily steps; treat these as commitment tiers rather than evidence-equivalent thresholds.
  - 'Choose a fallback rule for poor sleep, acute illness, pain, hazardous weather, travel, or life disruption: reduce to baseline, reduce by a preset amount, or pause and log the safety reason.'
  - 'Plan safe ways to fill the step gap: errands, indoor laps, short breaks, commute walking, or an easy planned walk. Avoid traffic, heat, unsafe surfaces, and routes that increase fall risk.'
  - Accumulate steps however fits the day. Do not require a cadence threshold unless this is deliberately forked into a cadence or MVPA-bout variant.
  - Each evening, log daily steps, selected floor, whether the floor was hit, device gaps or device changes, intentional walking or exercise, pain, safety symptoms, fatigue/recovery, sleep disruption, illness, injury/recovery status, footwear, terrain, occupational walking, and other major confounders.
  - Review weekly. Keep the floor only if steps rise or stay meaningfully higher without worsening pain, recovery, safety symptoms, sleep, or life friction; otherwise lower the floor, slow the ramp, or stop the experiment.
  tips:
  - Make the first floor repeatable rather than heroic; a smaller repeatable floor is more informative than a large number that requires pushing through symptoms.
  - Use a weekly median or average plus floor-hit days; do not overinterpret one unusually active or unusually inactive day.
  - Keep the device source stable. If you switch devices or stop carrying the phone, flag the day instead of treating the number as comparable.
  - Separate “I walked more” from “I hit a public guideline.” The canonical experiment tests total daily steps, not cadence, MVPA, or training intensity.
  - Keep concurrent changes stable where feasible, especially new exercise programs, major diet or weight-loss efforts, medication changes, travel, illness, pain flares, and unusual work demands.
  safetyNotes:
  - 'For low baseline activity, frailty, injury recovery, pregnancy/postpartum status, acute illness, pain, or cardiopulmonary symptoms, use baseline-only observation, a lower floor, a slower ramp, or clinician-guided adaptation rather than forcing a fixed public target. Source keys: source_artifact:pmid-29961442; source_artifact:healthgov-physical-activity-guidelines-americans-2018-11-12; source_artifact:govuk-physical-activity-guidelines-2019-09-07; source_artifact:who-physical-activity-guidelines-2020-11-25.'
  keepInMind:
  - A 10,000-step floor is an example, not the default requirement or a universal threshold.
  - 'Baseline-plus, 8,000, 10,000+, and other fixed floors are commitment tiers, not evidence-equivalent thresholds; interpret them through baseline capacity, safety limits, and burden. Source keys: source_artifact:pmid-14715035; source_artifact:pmid-21798044; source_artifact:pmid-35247352; source_artifact:pmid-40713949.'
  - Step-count gains are the primary expected signal; blood pressure, glucose, weight, mood, sleep, resting heart rate, and wearable fitness estimates are exploratory and confounded.
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
  primaryBiomarkerKey: biomarker:daily-step-count
  secondaryBiomarkerKeys:
  - biomarker:step-floor-days
  - biomarker:sedentary-time
  - biomarker:walking-bout-minutes
  - biomarker:walking-cadence
  - biomarker:moderate-to-vigorous-activity-minutes
  - biomarker:resting-heart-rate
  - biomarker:morning-blood-pressure
  - biomarker:estimated-vo2max
  - biomarker:sleep-efficiency
  - biomarker:musculoskeletal-pain
  safetyOutcomeKeys:
  - biomarker:walking-safety-events
  - biomarker:musculoskeletal-pain
  minimumAdherenceSessions: 21
  targetAdherenceSessions: 28
  notes:
  - Use the same device and carry/wear rule during baseline and intervention.
  - Primary readout is change in daily step count plus floor-hit days; secondary outcomes are exploratory and confounded.
  - Flag device gaps, illness, travel, weather/heat, pain, route risk, and concurrent exercise or rehab.
  - Do not count a high step total as success if safety symptoms, pain, recovery debt, or life friction worsened.
expectedSignalDescriptions:
- biomarkerKey: biomarker:daily-step-count
  expected: up_or_stable
  protocolProminence: focus
  description: 'The main expected signal is a higher daily step-count trend compared with baseline when the floor is achievable and measured consistently. Source keys: source_artifact:pmid-18029834; source_artifact:pmid-19791652; source_artifact:pmid-33036635.'
- biomarkerKey: biomarker:step-floor-days
  expected: up_or_stable
  protocolProminence: focus
  description: 'Floor-hit days show adherence to the chosen target, but high adherence with pain or safety events is not a good result. Source keys: source_artifact:pmid-22429600; source_artifact:pmid-26150019; source_artifact:10000steps-setting-step-goal-2026-04-26.'
- biomarkerKey: biomarker:walking-safety-events
  expected: down_or_stable
  protocolProminence: focus
  description: 'Safety events should stay at zero or decrease; any concerning symptom overrides step-count success. Source keys: source_artifact:pmid-15921486; source_artifact:daily-step-floor-pmid-17521443; source_artifact:pmid-26289360; source_artifact:doi-10.1016-j.bjpt.2023.100500.'
- biomarkerKey: biomarker:walking-cadence
  expected: mixed_or_contextual
  protocolProminence: context
  description: 'Cadence helps interpret intensity but is not part of the canonical dose. Source keys: source_artifact:pmid-28459099; source_artifact:pmid-30654810; source_artifact:pmid-33168018.'
experimentOnboarding:
  schemaVersion: murph.commons.experiment-onboarding.v1
  startIntent:
    displayPrompt: Hey Murph, I want to explore a Daily Step Floor experiment.
    intentSummary: Explore Daily Step Floor
  contextReview:
    vaultChecks:
    - id: active_experiments
      label: Active experiments
      reason: Avoid stacking meaningful experiments unless the user explicitly accepts the interpretation tradeoff.
      readHints:
      - experiment list --status active --format json
    - id: recent_step_baseline
      label: Recent step baseline
      reason: Estimate the user’s current daily step distribution before choosing a floor.
      freshnessDays: 21
      readHints:
      - wearables day-range <YYYY-MM-DD> <YYYY-MM-DD> --metrics steps --format json
      - activity summary --last 21d --format json
    - id: wearable_or_phone_sources
      label: Step-count sources
      reason: Confirm one consistent source of truth and detect device switching.
      freshnessDays: 14
      readHints:
      - wearables sources list --format json
      - wearables day <YYYY-MM-DD> --format json
    - id: mobility_pain_and_falls
      label: Mobility, pain, and falls
      reason: Screen for pain, gait, balance, or fall-risk contexts that may need a lower floor or clinician guidance.
      freshnessDays: 90
      readHints:
      - notes search mobility pain falls walking --format json
      - symptom logs --last 90d --format json
    - id: cardiopulmonary_symptoms
      label: Cardiopulmonary symptoms
      reason: Identify red flags before unsupervised step escalation.
      freshnessDays: 180
      readHints:
      - notes search chest pain shortness breath dizziness fainting palpitations --format json
    - id: diabetes_foot_or_neuropathy_context
      label: Diabetes foot or neuropathy context
      reason: Generic step floors may be inappropriate with active foot wounds, neuropathy, offloading, or ulcer-risk restrictions.
      freshnessDays: 180
      readHints:
      - notes search diabetes neuropathy foot ulcer wound offloading --format json
    - id: pregnancy_postpartum_or_clinician_restrictions
      label: Pregnancy, postpartum, or clinician restrictions
      reason: Special-population or clinician restrictions should shape whether a generic floor is appropriate.
      freshnessDays: 180
      readHints:
      - notes search pregnancy postpartum activity restriction clinician guidance --format json
    - id: route_weather_heat_context
      label: Route, weather, and heat context
      reason: Unsafe route, heat, traffic, and terrain risks can turn a step target into a safety problem.
      freshnessDays: 14
      readHints:
      - location weather risk --last 14d --format json
      - notes search route heat traffic terrain --format json
    notes:
    - Generated source-index.json was absent from the supplied snapshot; onboarding should preserve source-key boundaries rather than inventing clinical clearance.
  safetyScreen:
    cautionLevel: moderate
    mode: ask_compact_then_expand_if_positive
    dispositionIfAnyPositive: clinician_guidance_before_unsupervised_start
    mustAsk:
    - id: cardiopulmonary_red_flags
      prompt: Any chest pain or pressure, syncope or near-syncope, severe dizziness, severe unusual shortness of breath, palpitations with symptoms, or known unstable heart/lung condition that could make more walking unsafe?
      ifPositive: clinician_guidance_before_unsupervised_start
      why: Cardiopulmonary red flags override an unsupervised step-floor increase.
    - id: movement_pain_falls_risk
      prompt: Any current injury or injury recovery, foot/ankle/knee/hip/back pain worsened by walking, recent falls or near-falls, balance limitation, frailty, gait aid change, or unsafe route constraint?
      ifPositive: clinician_guidance_before_unsupervised_start
      why: A step floor should not require pushing through pain, unsafe gait, or fall risk.
    - id: special_contexts
      prompt: Any active foot wound or diabetic neuropathy/ulcer risk, pregnancy or early postpartum context, frailty or very low baseline activity, acute illness or fever, heat-illness risk, or clinician-imposed activity restriction?
      ifPositive: clinician_guidance_before_unsupervised_start
      why: These contexts can require population-specific or clinician-specific guidance rather than a generic step floor.
    stopIf:
      inheritFromProtocolSafety: true
      additionalConditions:
      - new or worsening pain that changes gait
      - fall or repeated near-fall
      - foot wound or skin breakdown
      - chest pain, syncope or near-syncope, severe dizziness, severe unusual shortness of breath
      - heat illness, fever, or acute illness
    notes:
    - Safety screening is conservative because extracted evidence supports step-count behavior change more strongly than universal safety or disease-treatment claims.
  setupSlots:
  - id: step_source
    label: Step source of truth
    purpose: measurement_fidelity
    valueType: enum
    askPolicy: always
    required: true
    question: Which source should be treated as the source of truth for daily steps?
    options:
    - phone
    - watch_or_wearable
    - pedometer
    target:
      object: protocol
      field: stepSource
  - id: baseline_window
    label: Baseline window
    purpose: personalization
    valueType: enum
    askPolicy: ask_if_unknown
    required: true
    question: Use a 7-day or 14-day baseline before setting the floor?
    options:
    - seven_days
    - fourteen_days
    target:
      object: analysisPlan
      field: baselineWindow
  - id: floor_tier
    label: Step-floor tier
    purpose: personalization
    valueType: enum
    askPolicy: always
    required: true
    question: Which floor tier should the experiment use?
    options:
    - baseline_observation
    - baseline_plus_1000
    - baseline_plus_2000
    - fixed_6000
    - fixed_8000
    - fixed_10000
    - fixed_12000
    - custom_ramp
    target:
      object: protocol
      field: floorTier
  - id: custom_ramp_rule
    label: Custom ramp rule
    purpose: personalization
    valueType: free_text
    askPolicy: ask_if_unknown
    required: false
    question: If using a custom ramp, what exact daily floor or weekly ramp rule should Murph record?
    target:
      object: protocol
      field: customRampRule
  - id: fallback_rule
    label: Fallback rule
    purpose: safety
    valueType: enum
    askPolicy: always
    required: true
    question: What should happen on pain, illness, poor sleep, travel, heat, or hazardous-route days?
    options:
    - reduce_to_baseline
    - reduce_by_2000
    - rest_and_log_safety
    - custom_recovery_floor
    target:
      object: protocol
      field: fallbackRule
  - id: route_weather_constraints
    label: Route and weather constraints
    purpose: safety
    valueType: free_text
    askPolicy: ask_if_unknown
    required: false
    question: Any route, traffic, terrain, heat, or weather constraints that should shape walking plans?
    target:
      object: onboardingCapture
      field: routeWeatherConstraints
  - id: reminder_preference
    label: Reminder preference
    purpose: assistant_support
    valueType: reminder_policy
    askPolicy: ask_at_confirmation
    required: false
    question: Would reminders help, and when should Murph avoid nudging?
    target:
      object: assistantSupport
      field: reminderPreference
  planDefaults:
    testPlanId: wearable-step-floor-42d
    baselineDays: 14
    interventionDays: 28
    sessionsPerWeek: 7
    targetSessions: 28
    minimumUsefulSessions: 21
    firstSessionGuidance: Start with a conservative floor chosen from baseline. The first week is for repeatability and safety, not maximal steps; low baseline activity, frailty, injury recovery, pregnancy/postpartum status, pain, acute illness, or cardiopulmonary symptoms should push the plan toward baseline-only, a lower floor, a slower ramp, or clinician-guided adaptation.
  logging:
    sessionFields:
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
    confounders:
    - device_change
    - phone_not_carried
    - watch_off_time
    - unusual_work_or_occupational_walking
    - travel
    - illness_or_fever
    - sleep_disruption
    - injury_or_recovery_status
    - injury_or_pain
    - weather_or_heat
    - footwear_change
    - terrain_change
    - intentional_exercise_program
    - concurrent_training
    - diet_or_weight_loss_change
    - medication_change
  assistantPolicy:
    askBeforeCreatingAutomations: true
    missedLogFollowup: opt_in_only
    reminderOptions:
    - none
    - morning_plan
    - afternoon_gap_check
    - evening_log_prompt
    weeklyDigestDefault: true
    missedLogFollowupCopy: Would you like to log yesterday’s steps and whether anything affected walking or device data?
    confirmationPrompt: Create a 42-day Daily Step Floor experiment with a 14-day baseline, 28-day intervention, one source of truth for steps, conservative fallback rules, and safety stop conditions?
whyItWorks:
- 'A daily floor turns walking into a simple self-monitoring loop: one visible number, one daily target, and one repeatability check. Direct pedometer, app, and tracker evidence supports step-count behavior change more strongly than downstream health promises. Source keys: source_artifact:pmid-18029834; source_artifact:pmid-19791652; source_artifact:pmid-33036635.'
- 'A baseline-responsive floor makes the dose fit the person. Fixed public targets can be useful examples, but the extracted cut-point and observational evidence does not make 10,000 steps a universal threshold. Source keys: source_artifact:pmid-14715035; source_artifact:pmid-21798044; source_artifact:pmid-35247352; source_artifact:pmid-40713949.'
- 'Keeping one device and placement rule reduces measurement noise, which matters because consumer step counts differ across devices, placements, gait, and activity settings. Source keys: source_artifact:pmid-33361276; source_artifact:pmid-33953288; source_artifact:doi-10.1186-s13102-024-00943-0; source_artifact:doi-10.1123-jmpb.2022-0022.'
- 'Safety-first fallback rules make the protocol easier to interpret: if the floor requires pushing through pain, cardiopulmonary symptoms, falls, foot problems, heat illness, or poor recovery, the result is not a successful dose. Source keys: source_artifact:pmid-15921486; source_artifact:daily-step-floor-pmid-17521443; source_artifact:pmid-26289360; source_artifact:doi-10.1016-j.bjpt.2023.100500.'
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
  - id: chronic-pain-walking
    label: Chronic-pain and pain-flare boundaries
    stance: safety_boundary
    summary: Walking can be feasible in some pain contexts, but pain flares and musculoskeletal symptoms should drive downshifts, pauses, or clinician-guided adaptation.
    sourceKeys:
    - source_artifact:pmid-23446066
    - source_artifact:pmid-23969029
    - source_artifact:pmid-25012720
    - source_artifact:pmid-33607979
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
  - active foot wound, diabetic-foot risk, neuropathy, or offloading requirement
  - unstable or unexplained cardiopulmonary symptoms
  - recent falls, serious balance limitation, or unsafe gait change
  - pregnancy, early postpartum, or clinician activity restriction
  - low baseline activity, frailty, injury recovery, or deconditioning that makes a step increase hard to repeat safely
  - acute illness, fever, heat-illness risk, or dehydration concern
  - new or worsening musculoskeletal pain that changes gait or persists
  stopIf:
  - chest pain or pressure, syncope or near-syncope, severe dizziness, confusion, severe unusual shortness of breath, or neurologic symptoms
  - fall, repeated near-fall, or unsafe balance change
  - new or worsening foot wound, skin breakdown, severe blistering, or concerning foot symptoms
  - pain in the foot, ankle, knee, hip, shin, or back that worsens across days or changes gait
  - heat-illness symptoms, fever, acute illness, or recovery debt that makes the floor require pushing through symptoms
  notes:
  - 'Safety claims use extracted safety and clinical-boundary sources conservatively: source_artifact:pmid-15921486; source_artifact:daily-step-floor-pmid-17521443; source_artifact:pmid-26289360; source_artifact:pmid-18801859; source_artifact:doi-10.1016-j.bjpt.2023.100500; source_artifact:doi-10.1016-j.diabres.2021.108733; source_artifact:pmid-29961442; source_artifact:healthgov-physical-activity-guidelines-americans-2018-11-12; source_artifact:govuk-physical-activity-guidelines-2019-09-07; source_artifact:who-physical-activity-guidelines-2020-11-25.'
  - Batch 012 guideline and special-population records are preserved as metadata-only stubs because extraction artifacts were missing; do not invent detailed adverse-event rates from them.
  - A lower floor, slower ramp, time-based substitution, indoor route, or pause is preferred over forcing the number when low baseline capacity, frailty, injury recovery, safety, recovery, or life obligations make the floor brittle.
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

The primary outcome is daily step count plus floor-hit days. A good result means the step trend rises or stays meaningfully above baseline **and** safety, pain, recovery, sleep, and life friction stay acceptable. Blood pressure, glucose, weight, wearable fitness estimates, mood, sleep, and sedentary-time changes are secondary and exploratory because the extracted evidence is mixed, population-specific, or indirect for those endpoints [source_artifact:pmid-16979410; source_artifact:pmid-21453540; source_artifact:pmid-30127487; source_artifact:pmid-33036635; source_artifact:doi-10.1136-bmjopen-2024-088524].

## Measurement rule

Pick one source of truth and keep it stable. Phone-not-carried days, watch-off time, device switching, gait changes, and placement changes can all distort interpretation, so they should be logged rather than silently treated as equivalent data [source_artifact:pmid-33361276; source_artifact:pmid-33953288; source_artifact:doi-10.1186-s13102-024-00943-0; source_artifact:doi-10.1123-jmpb.2022-0022; source_artifact:doi-10.3390-s20216293].

## Safety posture

This is not a “push through the number” challenge. Very low baseline activity, frailty, injury recovery, pain, cardiopulmonary symptoms, falls or near-falls, foot or skin problems, heat illness, acute illness, pregnancy/postpartum restrictions, diabetes-foot risk, or clinician limits should override the floor. When in doubt, downshift, slow the ramp, pause, or seek appropriate guidance rather than trying to preserve adherence [source_artifact:pmid-15921486; source_artifact:daily-step-floor-pmid-17521443; source_artifact:pmid-26289360; source_artifact:pmid-18801859; source_artifact:doi-10.1016-j.bjpt.2023.100500; source_artifact:doi-10.1016-j.diabres.2021.108733; source_artifact:pmid-29961442; source_artifact:healthgov-physical-activity-guidelines-americans-2018-11-12; source_artifact:govuk-physical-activity-guidelines-2019-09-07; source_artifact:who-physical-activity-guidelines-2020-11-25].
