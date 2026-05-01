---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
slug: protocols/caffeine-timing/caffeine-curfew-dose-reset
title: Caffeine Curfew
summary: All caffeine before late morning or 8 hours before bed, where less residual caffeine near bedtime lets adenosine — the brain's built-up sleep-pressure signal — work without interference.
status: draft
quality: usable
aliases:
- caffeine curfew dose reset
- no caffeine after 10am
- no caffeine after 11am
- 8-hour caffeine cutoff
- morning-only caffeine reset
- caffeine source audit before sleep
- late morning caffeine curfew
- no caffeine within 8 hours of bedtime
categories:
- sleep
- caffeine
- circadian
- behavior-change
- wearable-measured
- murph-canonical
relations:
- type: parent_family
  target: experiment_family:caffeine-timing
- type: primary_biomarker
  target: biomarker:sleep-onset-latency
- type: secondary_biomarker
  target: biomarker:sleep-efficiency
- type: secondary_biomarker
  target: biomarker:deep-sleep-minutes
- type: secondary_biomarker
  target: biomarker:resting-heart-rate
- type: secondary_biomarker
  target: biomarker:morning-blood-pressure
- type: secondary_biomarker
  target: biomarker:hrv-rmssd
- type: cites
  target: source_artifact:caffeine-timing-bibliography
lineage:
  relationship: root
  rationale: Murph canonical adult wellness self-experiment for testing whether late or high-dose all-source caffeine exposure is affecting sleep, while preserving abstinence, clinical, pregnancy, shift-work, and performance variants as separate protocols.
attribution:
  ownerType: murph
media:
- kind: image
  relativePath: design-assets/hero-caffeine-curfew.jpeg
  mediaType: image/jpeg
protocol:
  doseSignature: Daily · 14 intervention days after optional 7-day baseline · all caffeine before 10–11am or ≥8h before bedtime, whichever is earlier
  target: 'all caffeine sources: coffee, tea, energy products, supplements, decaf, chocolate/cocoa, and caffeine-containing medicines'
  frequency:
    sessionsPerWeek: 7
  interventionSessionsMinimum: 10
  interventionSessionsTarget: 12
  steps:
  - 'Run a 7-day baseline if possible: keep caffeine habits unchanged and log every caffeine source, serving size, approximate milligrams, and time consumed.'
  - Choose an intended bedtime anchor and calculate the daily cutoff as the earlier of 10–11am or 8 hours before that bedtime.
  - For 14 intervention days, keep all ordinary caffeine sources before the cutoff and log every source. Do not use caffeine pills, pure caffeine powder, liquid caffeine concentrate, energy shots, or pre-workout products to front-load the morning dose. Do not skip prescribed or needed medicines to meet the curfew; check medication labels and get pharmacist or clinician guidance if a medicine contains caffeine or may alter caffeine metabolism.
  - Keep total daily caffeine and the largest single serving stable or lower than baseline. Do not compensate by stacking the day’s caffeine into one large early dose. If baseline intake is high, reduction causes functional impairment, or you rely on caffeine for safety-critical alertness, stop the ordinary experiment and use a slower taper or clinician-guided plan instead.
  - Log curfew adherence, total estimated caffeine milligrams, sleep timing, sleep-onset estimate, sleep quality, wearable sleep metrics when available, and withdrawal or excess-caffeine symptoms each day.
  - Review the result against your own baseline, using adherent days only and checking alcohol, illness, stress, travel, late exercise, schedule changes, and new medications or supplements before calling it a signal.
  tips:
  - Use product labels or trusted tables for milligram estimates; cup counts alone are too crude for this experiment.
  - The protocol is easier if the first caffeine of the day is deliberate and measured rather than automatic refills.
  - If 10am is unrealistic, use 11am for the first test but keep the 8-hour bedtime buffer; caffeine-sensitive users may need an earlier or lower-dose variant.
  - Keep bedtime, wake time, alcohol, late exercise, sleep supplements, and screen/lighting habits as stable as practical during the test.
  - A small accidental exposure should be logged as a curfew miss rather than treated as a failed experiment.
  keepInMind:
  - The exact 14-day 10–11am-or-8-hour rule has not been directly tested as a complete protocol.
  - The strongest direct evidence is for acute or short repeated dose/timing challenges, especially 200–400 mg caffeine near the sleep window.
  - Dose reset is not the same as total abstinence, caffeine-dependence treatment, insomnia treatment, or athletic performance caffeine timing.
  - Some users will see no sleep improvement, especially if baseline caffeine is already low, early, or stable.
  - Withdrawal can obscure the first few days; interpret early fatigue, headache, mood, and sleepiness separately from sleep improvement.
  logFields:
  - intended bedtime
  - caffeine cutoff time
  - caffeine source
  - caffeine amount mg
  - last caffeine time
  - curfew miss yes/no
  - sleep onset latency
  - sleep efficiency
  - total sleep time
  - wake after sleep onset if available
  - deep sleep minutes
  - resting heart rate
  - HRV RMSSD
  - sleep quality
  - withdrawal symptoms
  - headache or migraine symptoms
  - anxiety or palpitations
  - morning blood pressure if relevant
  - alcohol
  - late exercise
  - illness, travel, or unusual stress
  stopConditions:
  - Stop the experiment and return to a previously tolerated pattern, or taper with guidance, if headache, fatigue, low mood, sleepiness, or concentration problems become severe or impair driving, work, caregiving, or safety-critical tasks.
  - Do not drive, operate machinery, provide safety-critical care, or do other high-risk tasks when withdrawal, sleepiness, anxiety, or poor sleep is impairing alertness.
  - Stop and seek urgent medical guidance for chest pain, fainting, rapid or erratic heartbeat, severe palpitations, seizure, severe vomiting or diarrhea, confusion, disorientation, neurologic symptoms, thunderclap headache, or suspected caffeine overdose.
  - Do not run this as an unsupervised experiment during pregnancy, while trying to conceive, during lactation, for children or adolescents, or when managing persistent insomnia, suspected sleep apnea, or another sleep disorder without clinician guidance.
  - Pause and get clinician or pharmacist guidance if panic symptoms, severe anxiety, mania or hypomania symptoms, uncontrolled hypertension, arrhythmia, concerning blood-pressure readings, lithium treatment, fluvoxamine, ciprofloxacin or other quinolone antibiotics, caffeine-containing medicines, or other medication interactions are present.
  - Pause or end the experiment if sleep is clearly worsening after the initial withdrawal period, if symptoms are impairing daytime safety or functioning, or if tracking caffeine creates distress or rumination.
  - If a clinician-guided lactation variant is being used, pause and get guidance if the infant develops unusual fussiness, jitteriness, or poor sleep.
testPlans:
- planId: caffeine-curfew-21d
  durationDays: 21
  baselineDays: 7
  interventionDays: 14
  primaryBiomarkerKey: biomarker:sleep-onset-latency
  secondaryBiomarkerKeys:
  - biomarker:sleep-efficiency
  - biomarker:deep-sleep-minutes
  - biomarker:resting-heart-rate
  - biomarker:morning-blood-pressure
  - biomarker:hrv-rmssd
  minimumAdherenceSessions: 10
  targetAdherenceSessions: 12
  notes:
  - Use a 7-day baseline when available; otherwise, treat the first run as weaker attribution.
  - Score only days where all caffeine was logged and the cutoff was met or clearly marked as missed.
  - Pair wearable sleep metrics with subjective sleep onset, sleep quality, withdrawal symptoms, and curfew adherence.
  - Anchor interpretation in sleep onset and sleep continuity; use deep-sleep staging, resting heart rate, blood pressure, and HRV as supporting same-device trends.
expectedSignalDescriptions:
- biomarkerKey: biomarker:sleep-onset-latency
  description: "Moving caffeine earlier reduces residual adenosine blockade and stimulant arousal near bedtime, letting sleep pressure appear sooner."
  expected: May shorten
  estimatedChange:
    kind: absolute
    low: -15
    high: -5
    unit: minutes
    window: 14 intervention days
    confidence: moderate
    basis: Caffeine sleep meta-analyses and 400 mg timing trials report roughly 8-9 minutes longer sleep-onset latency with caffeine challenges; this protocol estimates the regain for users whose baseline included late or high-dose caffeine.
  protocolProminence: focus
- biomarkerKey: biomarker:sleep-efficiency
  description: "Less residual caffeine reduces quiet wakefulness and overnight fragmentation, turning more time in bed into sleep."
  expected: Could improve
  estimatedChange:
    kind: absolute
    low: 2
    high: 7
    unit: "%"
    window: 14 intervention days
    confidence: moderate
    basis: Quantitative caffeine sleep syntheses report about 5-7 percentage-point lower sleep efficiency after caffeine challenges; athlete late-caffeine synthesis reported about 4.9 points lower with sensitivity limitations.
  protocolProminence: focus
- biomarkerKey: biomarker:deep-sleep-minutes
  description: "Lower nighttime caffeine exposure allows deeper NREM sleep to return when late caffeine was keeping sleep lighter."
  expected: Could increase
  estimatedChange:
    kind: absolute
    low: 5
    high: 12
    unit: minutes
    window: 14 intervention days
    confidence: low
    basis: A caffeine sleep meta-analysis reported about 11.4 fewer deep-sleep minutes after caffeine; consumer wearables estimate stages indirectly, so use same-device trends beside duration and efficiency.
  protocolProminence: focus
- biomarkerKey: biomarker:resting-heart-rate
  description: "Lower nighttime stimulation and smoother sleep reduce sympathetic load, lowering overnight resting pulse."
  expected: Could trend lower
  estimatedChange:
    kind: absolute
    low: -2
    high: 0
    unit: bpm
    window: 14 intervention days
    confidence: low
    basis: Direct caffeine-curfew resting-heart-rate trials were not extracted; this is an indirect autonomic and sleep-continuity estimate for users whose late caffeine was causing nighttime arousal.
  protocolProminence: context
- biomarkerKey: biomarker:morning-blood-pressure
  description: "Less residual caffeine lowers vascular tone in sensitive users, reducing morning pressure after late-dose exposure."
  expected: Could trend lower
  estimatedChange:
    kind: absolute
    low: -4
    high: 0
    unit: mmHg systolic
    window: 14 intervention days
    confidence: low
    basis: Blood-pressure effects are acute and user-specific; no direct 14-day curfew blood-pressure trial was extracted, so this range is a safety-context estimate for sensitive or late-dosing users.
  protocolProminence: context
- biomarkerKey: biomarker:hrv-rmssd
  description: "Smoother sleep supports parasympathetic recovery; withdrawal or excess caffeine keeps autonomic stress unsettled."
  expected: Could stabilize
  estimatedChange:
    kind: mixed_or_contextual
    window: 14 intervention days
    confidence: low
    basis: Caffeine-HRV evidence is heterogeneous, and overnight RMSSD depends on sleep stage, illness, alcohol, stress, and device window.
  protocolProminence: context
experimentOnboarding:
  schemaVersion: murph.commons.experiment-onboarding.v1
  startIntent:
    displayPrompt: Hey Murph, I want to test a caffeine curfew and dose reset.
    intentSummary: Explore Caffeine Curfew + Dose Reset
  contextReview:
    vaultChecks:
    - id: active_experiments
      label: Active experiments
      reason: Avoid stacking another behavior-change experiment that would weaken attribution.
      readHints:
      - experiment list --status active
    - id: sleep_baseline
      label: Sleep baseline
      reason: Check whether sleep-onset, sleep-efficiency, total sleep, deep-sleep, resting-heart-rate, HRV, or blood-pressure trends are available before intervention.
      freshnessDays: 14
      readHints:
      - wearables sources list
      - wearables day
      - sleep summary
    - id: caffeine_pattern
      label: Current caffeine pattern
      reason: Identify usual source, dose, last-caffeine timing, hidden caffeine, high-dose products, and whether tapering is safer than abrupt change.
      freshnessDays: 30
      readHints:
      - memory show
      - search query "coffee caffeine energy drink preworkout tea decaf caffeine medication"
      - journal show
    - id: safety_context
      label: Safety and medication context
      reason: Screen for pregnancy/lactation, cardiovascular or blood-pressure concerns, panic/anxiety vulnerability, diagnosed sleep disorders, migraine/severe headaches, and interacting medications.
      freshnessDays: 90
      readHints:
      - memory show
      - search query "pregnancy lactation hypertension arrhythmia panic anxiety migraine headache insomnia sleep apnea medication ciprofloxacin fluvoxamine caffeine"
    notes:
    - Prefer recent logged caffeine and wearable sleep data, but allow a baseline week if the vault is sparse.
    - Do not re-ask stable context the vault already answers unless it affects safety, tapering, or measurement fidelity.
  safetyScreen:
    cautionLevel: moderate
    mode: ask_compact_then_expand_if_positive
    dispositionIfAnyPositive: clinician_guidance_before_unsupervised_start
    mustAsk:
    - id: pregnancy_lactation_trying_to_conceive_or_youth
      prompt: pregnancy, trying to conceive, lactation, or the protocol is for a child or adolescent
      why: Dose limits, fetal/infant considerations, and pediatric boundaries differ from general adult wellness experiments.
    - id: cardiovascular_bp_or_syncope
      prompt: uncontrolled high blood pressure, arrhythmia, chest pain history, fainting/syncope, severe palpitations, concerning blood-pressure readings, or clinician advice to limit caffeine
      why: Caffeine exposure and high-dose products can affect symptoms and blood pressure in vulnerable users, while arrhythmia evidence needs clinician-specific interpretation.
    - id: panic_anxiety_bipolar_lithium_or_mood_instability
      prompt: panic disorder, severe anxiety, caffeine-triggered anxiety, bipolar disorder, recent mania or hypomania, severe mood instability, lithium treatment, or a recent lithium dose change
      why: Caffeine exposure and caffeine reduction can affect anxiety, sleep, mood, and lithium-related clinical management.
    - id: headache_withdrawal_dependence_or_heavy_use
      prompt: migraine vulnerability, severe headaches, prior thunderclap headache, prior difficult caffeine withdrawal, heavy caffeine use, caffeine dependence concerns, or inability to cut down despite distress or impairment
      why: A taper or clinician-guided plan may be safer than an abrupt timing reset.
    - id: sleep_disorder_or_operational_alertness
      prompt: diagnosed or persistent insomnia, suspected sleep apnea, shift-work sleep disorder, rotating shifts, professional driving, heavy machinery, clinical/on-call work, overnight caregiving, or other safety-critical alertness requirements
      why: This protocol is not diagnostic or treatment for sleep disorders, and withdrawal-related sleepiness can create safety risk.
    - id: medication_interactions_or_hidden_caffeine
      prompt: fluvoxamine, ciprofloxacin or other quinolone antibiotics, caffeine-containing pain relievers or medicines, psychiatric medicines, supplements/pre-workouts, or any clinician/pharmacist warning about caffeine interactions
      why: Some medicines contain caffeine or can change caffeine clearance and residual exposure.
    - id: concentrated_or_high_dose_caffeine_products
      prompt: pure caffeine powder, liquid caffeine concentrate, caffeine tablets, energy shots, pre-workout products, guarana/yerba mate products, or frequent energy-drink use
      why: These products can make dose estimation and adverse-event risk very different from ordinary coffee or tea.
    stopIf:
      inheritFromProtocolSafety: true
    notes:
    - A positive screen does not diagnose a problem; it means Murph should avoid launching this as a simple unsupervised experiment without a lower-risk plan or clinician input.
  setupSlots:
  - id: bedtime_anchor
    label: Bedtime anchor
    purpose: logistics
    valueType: local_time
    askPolicy: ask_if_unknown_or_stale
    required: true
    question: What intended bedtime should Murph use to calculate the 8-hour caffeine buffer?
    target:
      object: experimentRun
      field: bedtimeAnchor
  - id: curfew_choice
    label: Late-morning curfew
    purpose: logistics
    valueType: enum
    askPolicy: ask_if_unknown
    required: true
    question: Should the late-morning curfew be 10am or 11am for this first run?
    options:
    - ten_am
    - eleven_am
    constraints:
      default: eleven_am
      sensitiveOrSleepReactiveDefault: ten_am
    target:
      object: experimentRun
      field: curfewChoice
  - id: baseline_caffeine_dose
    label: Baseline caffeine dose
    purpose: measurement_fidelity
    valueType: integer
    askPolicy: ask_if_unknown
    required: false
    question: About how many milligrams of caffeine do you usually have per day?
    constraints:
      unit: mg_per_day
      useApproximateIfUnknown: true
    target:
      object: onboardingCapture
      field: baselineCaffeineMg
  - id: last_caffeine_time
    label: Usual last caffeine time
    purpose: measurement_fidelity
    valueType: local_time
    askPolicy: ask_if_unknown
    required: false
    question: What time do you usually have your last caffeine?
    target:
      object: onboardingCapture
      field: usualLastCaffeineTime
  - id: source_audit
    label: All-source caffeine audit
    purpose: measurement_fidelity
    valueType: enum
    askPolicy: ask_if_unknown
    required: true
    question: Which caffeine sources should Murph watch for in your logs?
    options:
    - coffee_only
    - coffee_tea
    - energy_preworkout
    - medications_or_supplements
    - all_sources_or_unsure
    target:
      object: onboardingCapture
      field: caffeineSourcePattern
  - id: largest_single_caffeine_serving
    label: Largest single caffeine serving
    purpose: safety
    valueType: integer
    askPolicy: ask_if_unknown
    required: false
    question: About how many milligrams are in your largest usual single caffeine serving?
    constraints:
      unit: mg
      useApproximateIfUnknown: true
    target:
      object: onboardingCapture
      field: largestSingleCaffeineServingMg
  - id: metabolism_modifiers
    label: Caffeine metabolism modifiers
    purpose: safety
    valueType: enum
    askPolicy: ask_if_unknown_or_stale
    required: false
    question: Any oral contraceptive or hormone therapy use, pregnancy/trying/lactation status, smoking/nicotine status change, or medication that might alter caffeine metabolism?
    options:
    - none_known
    - oral_contraceptive_or_hormone_therapy
    - pregnancy_trying_or_lactation
    - smoking_or_nicotine_status_change
    - interacting_medication_possible
    - unsure
    target:
      object: onboardingCapture
      field: caffeineMetabolismModifiers
  - id: taper_need
    label: Taper need
    purpose: safety
    valueType: enum
    askPolicy: ask_if_unknown
    required: true
    question: Do you expect headaches, fatigue, or functional impairment if you suddenly reduce or move caffeine earlier?
    options:
    - unlikely
    - possible
    - likely_or_prior_withdrawal
    - unsure
    target:
      object: experimentRun
      field: taperNeed
  - id: reminder_policy
    label: Reminder policy
    purpose: assistant_support
    valueType: reminder_policy
    askPolicy: ask_at_confirmation
    required: true
    question: Do you want a pre-curfew reminder, a next-morning missing-log check, both, or neither?
    options:
    - none
    - pre_curfew
    - next_morning_missing_log_check
    - pre_curfew_plus_next_morning_check
    target:
      object: assistantSupport
      field: reminderPolicy
  planDefaults:
    testPlanId: caffeine-curfew-21d
    baselineDays: 7
    interventionDays: 14
    sessionsPerWeek: 7
    targetSessions: 12
    minimumUsefulSessions: 10
    firstSessionGuidance: Start by moving the last planned caffeine before the cutoff; do not add a new sleep supplement, new bedtime, or screen curfew during the same test.
  logging:
    sessionFields:
    - caffeine_source
    - caffeine_mg
    - last_caffeine_time
    - curfew_met
    - intended_bedtime
    - actual_bedtime
    - sleep_onset_latency_minutes
    - sleep_quality_rating
    - withdrawal_symptoms
    - headache_or_migraine
    - anxiety_or_palpitations
    confounders:
    - alcohol_last_24h
    - late_exercise
    - illness_or_fever
    - travel_or_timezone_shift
    - unusual_stress
    - new_medication_or_supplement
    - major_bedtime_shift
    - screen_or_light_change
    - largest_single_caffeine_serving_mg
    - first_caffeine_time
    - caffeine_tablet_powder_or_concentrate_exposure
    - energy_drink_shot_or_preworkout_exposure
    - guarana_yerba_mate_or_stimulant_blend
    - caffeine_containing_medication
    - interacting_medication_or_antibiotic
    - lithium_or_psychiatric_medication_change
    - oral_contraceptive_or_hormone_context
    - pregnancy_trying_to_conceive_or_lactation_context
    - safety_critical_alertness_demand
    - withdrawal_symptom_severity
    - rescue_headache_or_migraine_medication
    - blood_pressure_reading_context_if_relevant
    - smoking_or_nicotine_status_change
    notes:
    - Ask for all caffeine sources, including decaf residual caffeine and OTC medication caffeine, not just coffee.
  assistantPolicy:
    maxSetupQuestionsPerTurn: 2
    askBeforeCreatingAutomations: true
    missedLogFollowup: opt_in_only
    reminderOptions:
    - none
    - pre_curfew
    - next_morning_missing_log_check
    - pre_curfew_plus_next_morning_check
    weeklyDigestDefault: true
    missedLogFollowupCopy: Did you end up having any caffeine after your cutoff yesterday? Totally fine either way—I just want the experiment record to be accurate.
    confirmationPrompt: Show the safety outcome, bedtime anchor, curfew choice, 8-hour buffer, all-source logging plan, taper/off-ramp language, stop conditions, and reminder policy before creating the active experiment or automations.
whyItWorks:
- Caffeine blocks adenosine signaling, and moving caffeine earlier can reduce the chance that sleep-relevant residual caffeine remains near bedtime, especially after larger doses or in slower-clearance users. This is a rationale for a personal timing test, not proof that an 8-hour buffer is sufficient for everyone.
- 'The dose reset is a measurement move as much as an intervention: by counting all sources and limiting late exposure, the user can distinguish “caffeine was probably not the driver” from “late or high-dose caffeine may be part of the sleep pattern.”'
- The 8-hour buffer is deliberately cautious because caffeine response and clearance vary across people. Some users may need a stricter variant, while others may find the protocol burdensome with little sleep signal.
- Withdrawal can temporarily worsen headache, fatigue, sleepiness, mood, or perceived performance. That is why tapering, symptom tracking, and a first-few-days interpretation buffer matter.
claims:
- claimId: direct-protocol-definition-all-source-eight-hour-late-morning
  type: evidence_scope
  text: 'Define this protocol as a 14-day all-source caffeine timing and dose-reset experiment: no caffeine after 10–11am and no caffeine within 8 hours of intended bedtime, whichever is earlier, with daily logging of caffeine source, approximate milligrams, timing, sleep timing, and withdrawal symptoms.'
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-39377163
  - source_artifact:pmid-24235903
  - source_artifact:fda-caffeine-too-much-2024-08-28
  - source_artifact:healthcanada-caffeine-in-foods-2025-04-02
  - source_artifact:pmid-22341956
  caveats:
  - No extracted study directly tested this exact 10–11am or 8-hour rule for 14 days.
  - The strongest direct sleep-disruption evidence is mostly acute dose/timing challenge evidence, especially at 200–400 mg doses.
- claimId: controlled-dose-timing-supports-curfew-rationale
  type: intervention_result
  text: 'Controlled human dose/timing studies support the caffeine-curfew rationale most clearly for moderate-to-high doses: 400 mg caffeine disrupted sleep even when taken 6 hours before bedtime, a newer dose-by-timing crossover trial found 400 mg effects on sleep initiation and architecture within 12 hours and fragmentation or sleep-efficiency outcomes within 8 hours, and 200 mg evening caffeine challenged PSG sleep in moderate consumers. The same newer trial found no significant sleep effect from 100 mg up to 4 hours before bedtime in the extracted population, so this evidence should not be generalized to small incidental exposures.'
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-24235903
  - source_artifact:pmid-39377163
  - source_artifact:pmid-16704567
  caveats:
  - These are not 14-day free-living behavior-change trials.
  - Dose matters; the claim is strongest for 200–400 mg challenges and weaker for small incidental exposures.
  - Several direct sources are small, acute, older, or population-limited.
- claimId: dose-reset-not-total-abstinence-or-guaranteed-sleep-fix
  type: mixed_evidence
  text: The dose-reset portion should be framed as personal exposure standardization, not proof that caffeine abstinence reliably improves sleep; abstinence studies and repeated daily-caffeine studies show mixed, null, or endpoint-specific results.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-19120728
  - source_artifact:pmid-32374052
  - source_artifact:pmid-23218455
  - source_artifact:pmid-33633278
  - source_artifact:pmid-34024173
  - source_artifact:pmid-35187019
  - source_artifact:pmid-24868491
  caveats:
  - Mixed abstinence evidence should not be used to dismiss late-caffeine effects; it limits dose-reset claims.
  - Abstinence, bedtime dosing, repeated daytime dosing, and morning curfew are adjacent but not identical interventions.
- claimId: all-source-caffeine-audit-is-required
  type: design_guardrail
  text: 'All caffeine sources are in scope for logging and safety triage, not just coffee: ordinary coffee, tea, decaf, chocolate or cocoa, cola, energy drinks or shots, pre-workout or stimulant blends, caffeine tablets or powders, supplements, and caffeine-containing medicines can affect adherence, dose interpretation, and risk. Pure or highly concentrated caffeine products are not implementation tools for this protocol.'
  strength: high
  sourceKeys:
  - source_artifact:fda-caffeine-too-much-2024-08-28
  - source_artifact:healthcanada-caffeine-in-foods-2025-04-02
  - source_artifact:ods-dietary-supplements-exercise-athletic-performance-2024-04-01
  - source_artifact:healthcanada-caffeinated-energy-drinks-2024-05-02
  - source_artifact:pmid-14607010
  - source_artifact:pmid-17132260
  - source_artifact:pmid-30196576
  - source_artifact:dailymed-acetaminophen-aspirin-caffeine-label-2026-01-10
  - source_artifact:pmid-7636092
  - source_artifact:pmid-18809264
  - source_artifact:pmid-25560302
  - source_artifact:pmid-31317857
  - source_artifact:pmid-33211984
  caveats:
  - Product-content and label sources support implementation and safety triage, not sleep efficacy.
  - Exact caffeine content varies by product, serving size, brewing method, and jurisdiction.
  - Mixed-ingredient products, pills, powders, concentrates, and caffeine-containing medicines require exclusion or clinician/pharmacist review rather than routine morning front-loading.
- claimId: fixed-cutoff-needs-personalization
  type: mechanistic
  text: The 8-hour cutoff should be treated as a default boundary that may need an earlier or lower-dose variant for caffeine-sensitive users, sleep-reactive users, middle-aged or older users, and slower-clearance contexts such as oral-contraceptive use or other pharmacokinetic modifiers.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-35280254
  - source_artifact:pmid-29514871
  - source_artifact:pmid-17329997
  - source_artifact:pmid-16996309
  - source_artifact:pmid-25759402
  - source_artifact:pmid-7359014
  - source_artifact:pmid-657717
  caveats:
  - Mechanistic and pharmacokinetic variability does not prove one exact earlier cutoff improves outcomes.
  - Smoking-status evidence is a clearance modifier, not a recommendation to use nicotine or smoking.
- claimId: withdrawal-taper-and-offramp-boundary
  type: safety
  text: Meaningful caffeine reduction can produce headache, fatigue, low alertness, sleepiness, mood or concentration symptoms, and functional impairment, so the protocol should include symptom-severity tracking, taper/off-ramp language, and clinician-guided reduction for heavy use, migraine vulnerability, severe headache or neurologic symptoms, safety-critical alertness needs, or inability to reduce despite distress or impairment.
  strength: high
  sourceKeys:
  - source_artifact:pmid-15448977
  - source_artifact:pmid-10087016
  - source_artifact:pmid-1528206
  - source_artifact:pmid-33013662
  - source_artifact:pmid-24761279
  - source_artifact:pmid-22341956
  - source_artifact:pmid-27699780
  - source_artifact:pmid-28480791
  - source_artifact:pmid-31822176
  - source_artifact:pmid-34000324
  - source_artifact:pmid-15887055
  caveats:
  - Withdrawal safety evidence is boundary-setting, not evidence that the curfew improves sleep.
  - Taper pace should be personalized when functional impairment or severe symptoms occur.
- claimId: clinical-safety-boundaries-are-separate-from-efficacy
  type: safety
  text: Pregnancy, trying to conceive, lactation, children or adolescents, hypertension or cardiovascular symptoms, panic or severe anxiety, bipolar disorder or lithium treatment, drug interactions, caffeine-containing medicines, caffeine-use disorder, persistent insomnia, suspected sleep apnea, and mixed-ingredient/high-dose caffeine products require separate guidance rather than a simple adult self-experiment.
  strength: high
  sourceKeys:
  - source_artifact:doi-10.2903-j.efsa.2015.4102
  - source_artifact:pmid-20664420
  - source_artifact:who-caffeine-pregnancy-2023-08-09
  - source_artifact:ncbi-lactmed-caffeine-2025-09-15
  - source_artifact:pmid-6954898
  - source_artifact:pmid-11503005
  - source_artifact:pmid-26358647
  - source_artifact:pmid-28438661
  - source_artifact:pmid-38350307
  - source_artifact:pmid-9695448
  - source_artifact:pmid-36833216
  - source_artifact:pmid-34710040
  - source_artifact:pmid-35010906
  - source_artifact:pmid-21880846
  - source_artifact:pmid-15834273
  - source_artifact:pmid-10024321
  - source_artifact:pmid-24009307
  - source_artifact:pmid-24680173
  - source_artifact:pmid-41206802
  - source_artifact:pmid-36947466
  - source_artifact:pmid-28756014
  - source_artifact:pmid-34871964
  - source_artifact:pmid-38362247
  - source_artifact:pmid-12825092
  - source_artifact:pmid-18305461
  - source_artifact:pmid-20164571
  - source_artifact:pmid-38016484
  - source_artifact:pmid-28162150
  - source_artifact:pmid-32949106
  - source_artifact:pmid-8807660
  - source_artifact:pmid-16236038
  - source_artifact:pmid-2729942
  - source_artifact:dailymed-ciprofloxacin-caffeine-2022-06-01
  - source_artifact:pmid-7888295
  - source_artifact:dailymed-acetaminophen-aspirin-caffeine-label-2026-01-10
  caveats:
  - These sources support safety screening and boundaries, not claims that the protocol treats those conditions.
  - Cardiovascular evidence is mixed and should not be framed as caffeine being uniformly harmful for all users.
  - Prescription-stimulant or ADHD-medication co-use remains a generic medication-review prompt unless a source-owned finding is extracted for a specific claim.
- claimId: consumer-sleep-metrics-are-trends-not-diagnoses
  type: design_guardrail
  text: Wearable sleep duration, sleep efficiency, sleep-stage, HRV/RMSSD, withdrawal, and subjective sleep-quality signals should be treated as trend/context measures, not diagnostic proof that the protocol treated insomnia, sleep apnea, or another sleep disorder.
  strength: high
  sourceKeys:
  - source_artifact:pmid-29734997
  - source_artifact:pmid-24179309
  - source_artifact:doi-10.1093-sleepadvances-zpaf021
  - source_artifact:pmid-28265249
  - source_artifact:pmid-22341956
  caveats:
  - Measurement sources do not test caffeine curfews.
  - Consumer devices may under-detect wake after sleep onset or misclassify sleep stages.
- claimId: daytime-function-and-performance-tradeoffs
  type: mixed_evidence
  text: Cutting or moving caffeine earlier can trade potential sleep protection for short-term alertness, fatigue, or performance costs, especially during withdrawal, sleep restriction, athletic contexts, or habituated use.
  strength: moderate
  sourceKeys:
  - source_artifact:doi-10.3390-app12199957
  - source_artifact:pmid-21178933
  - source_artifact:pmid-25115507
  - source_artifact:pmid-25700100
  - source_artifact:pmid-29029309
  - source_artifact:pmid-31480553
  - source_artifact:pmid-15448977
  caveats:
  - Performance evidence should not override safety or sleep-disorder evaluation.
  - This protocol is not an athletic caffeine-periodization plan.
- claimId: concentrated-caffeine-toxicity-hard-exclusion
  type: safety
  text: Pure or highly concentrated caffeine powders or liquid concentrates are a hard exclusion for this ordinary wellness protocol, and severe red flags such as rapid or erratic heartbeat, seizure, severe gastrointestinal symptoms, confusion, disorientation, stupor, or suspected overdose require urgent guidance.
  strength: high
  sourceKeys:
  - source_artifact:fda-pure-highly-concentrated-caffeine-2023-03-06
  - source_artifact:fda-highly-concentrated-caffeine-guidance-2018-04-13
  - source_artifact:fda-pure-highly-concentrated-caffeine-2018-04-13
  - source_artifact:pmid-30422505
  - source_artifact:pmid-30505695
  caveats:
  - These are toxicity and safety-boundary sources, not evidence that a caffeine curfew improves sleep.
  - The ordinary protocol should not use pills, powders, concentrates, energy shots, or pre-workouts as a way to move dose earlier.
- claimId: external-cutoff-guidance-is-context-not-proof
  type: evidence_scope
  text: External sleep-hygiene and caffeine-cutoff guidance can explain why users recognize an afternoon/evening caffeine boundary, but it should not be used as primary proof that this exact Murph protocol works.
  strength: moderate
  sourceKeys:
  - source_artifact:aasm-sleep-and-caffeine-2026-04-26
  - source_artifact:sleepfoundation-caffeine-sleep-problems-2025-07-16
  - source_artifact:nhlbi-healthy-sleep-habits-2022-03-24
  - source_artifact:cdc-about-sleep-2024-05-15
  - source_artifact:harvardhealth-sleep-hygiene-2025-01-31
  - source_artifact:medlineplus-healthy-sleep-2025-12-09
  caveats:
  - Guideline-like sources are context and safety support, not direct causal evidence for the 14-day experiment.
researchLandscape:
  bottomLine: 'Best read as a bounded caffeine-timing self-experiment: direct dose/timing evidence supports avoiding later and higher-dose caffeine, but the exact 14-day 10–11am-or-8-hour rule is a practical test rather than a proven universal cutoff.'
  confidenceLabel: mixed
  primaryClaim: This protocol may help users identify whether late, high-dose, or hidden caffeine is worsening sleep onset or sleep continuity, especially when baseline caffeine extends into the afternoon or evening.
  mainCaveat: Abstinence and repeated-caffeine evidence is mixed, individual clearance varies, withdrawal can obscure the first days, and consumer sleep tools are trend proxies rather than clinical diagnostics.
  groups:
  - id: direct-dose-timing-evidence
    label: Direct dose/timing evidence
    stance: supports
    summary: Controlled trials and sleep-focused syntheses are the strongest rationale for testing a caffeine buffer, especially for 200–400 mg caffeine and for higher-dose caffeine taken near or within the longer pre-bed window. They support a dose-sensitive self-experiment, not a universal 10–11am cutoff or a proven 14-day efficacy rule.
    sourceKeys:
    - source_artifact:pmid-24235903
    - source_artifact:pmid-39377163
    - source_artifact:pmid-16704567
    - source_artifact:pmid-186223
    - source_artifact:pmid-7796154
    - source_artifact:pmid-36870101
    - source_artifact:pmid-26899133
    - source_artifact:pmid-41124973
    defaultOpen: true
  - id: mixed-reset-and-abstinence
    label: Mixed reset and abstinence evidence
    stance: mixed
    summary: Abstinence, reset, and repeated daily-caffeine sources preserve the null and mixed side of the evidence base, including low/moderate abstinence studies, poor-sleeper abstinence data, repeated daytime caffeine, bedtime repeated exposure, and recovery-context evidence. The page should frame dose reset as personal exposure standardization, not guaranteed sleep improvement.
    sourceKeys:
    - source_artifact:pmid-19120728
    - source_artifact:pmid-23218455
    - source_artifact:pmid-32374052
    - source_artifact:pmid-24868491
    - source_artifact:pmid-33633278
    - source_artifact:pmid-34024173
    - source_artifact:pmid-35187019
    defaultOpen: true
  - id: all-source-dose-audit
    label: All-source caffeine audit
    stance: supports
    summary: Dose-audit sources support logging all caffeine sources and not treating coffee cups as the only exposure. They inform implementation and safety, not efficacy.
    sourceKeys:
    - source_artifact:fda-caffeine-too-much-2024-08-28
    - source_artifact:healthcanada-caffeine-in-foods-2025-04-02
    - source_artifact:doi-10.7205-milmed-d-15-00459
    - source_artifact:ods-dietary-supplements-exercise-athletic-performance-2024-04-01
    - source_artifact:dailymed-acetaminophen-aspirin-caffeine-label-2026-01-10
    - source_artifact:pmid-14607010
    - source_artifact:pmid-17132260
    - source_artifact:pmid-30196576
    - source_artifact:healthcanada-caffeinated-energy-drinks-2024-05-02
    - source_artifact:pmid-18809264
    - source_artifact:pmid-25560302
    - source_artifact:pmid-31317857
    - source_artifact:pmid-33211984
    defaultOpen: false
  - id: pharmacology-individual-differences
    label: Pharmacology and individual differences
    stance: supports
    summary: Caffeine half-life, sensitivity, age, genetics, sex-hormone context, oral-contraceptive use, pregnancy, smoking status, and habitual dose can make the same cutoff too strict for some users and insufficient for others.
    sourceKeys:
    - source_artifact:pmid-29514871
    - source_artifact:pmid-35280254
    - source_artifact:pmid-8619015
    - source_artifact:pmid-17329997
    - source_artifact:pmid-28215251
    - source_artifact:pmid-7359014
    - source_artifact:pmid-657717
    - source_artifact:sleepfoundation-caffeine-wear-off-2025-07-16
    - source_artifact:pmid-26378246
    - source_artifact:pmid-22754043
    - source_artifact:pmid-6851408
    - source_artifact:pmid-7612156
    - source_artifact:pmid-3838675
    - source_artifact:pmid-16996309
    defaultOpen: false
  - id: measurement-wearables-psg-actigraphy
    label: Sleep measurement, PSG, actigraphy, and wearables
    stance: context_only
    summary: Measurement sources support sleep duration, sleep efficiency, WASO, sleep stages, and wearable outputs as trend signals while avoiding diagnostic or single-night overinterpretation.
    sourceKeys:
    - source_artifact:pmid-8598068
    - source_artifact:pmid-29991437
    - source_artifact:doi-10.1093-sleepadvances-zpaf021
    - source_artifact:pmid-33378539
    - source_artifact:pmid-36016077
    - source_artifact:pmid-24179309
    - source_artifact:pmid-37917155
    - source_artifact:pmid-38276327
    defaultOpen: false
  - id: consumer-sleep-tools-not-diagnostics
    label: Consumer sleep tools are not clinical diagnostics
    stance: safety_boundary
    summary: Consumer sleep technology and diagnostic-boundary sources support clear language that this experiment does not diagnose or treat insomnia, sleep apnea, or another sleep disorder.
    sourceKeys:
    - source_artifact:pmid-29734997
    - source_artifact:pmid-28162150
    defaultOpen: false
  - id: tolerance-withdrawal-reversal
    label: Tolerance, withdrawal, and sensitivity reset context
    stance: mixed
    summary: Tolerance and withdrawal sources support the idea that caffeine response can change after reduction or abstinence, but they do not justify promising a predictable 14-day sensitivity reset.
    sourceKeys:
    - source_artifact:pmid-12424547
    - source_artifact:pmid-23108937
    - source_artifact:pmid-19241060
    - source_artifact:pmid-15678363
    defaultOpen: false
  - id: withdrawal-offramp-and-tapering
    label: Withdrawal off-ramp and tapering
    stance: supports
    summary: Withdrawal sources support an off-ramp or taper option for users who develop headaches, fatigue, low alertness, mood symptoms, or functional impairment during the reset.
    sourceKeys:
    - source_artifact:pmid-10087016
    - source_artifact:pmid-1528206
    - source_artifact:pmid-2262896
    - source_artifact:pmid-10586387
    - source_artifact:pmid-9402612
    - source_artifact:pmid-15448977
    - source_artifact:pmid-33013662
    - source_artifact:pmid-27699780
    - source_artifact:pmid-28480791
    - source_artifact:pmid-31822176
    defaultOpen: false
  - id: clinical-safety-cardiovascular-anxiety-pregnancy
    label: Clinical safety boundaries
    stance: safety_boundary
    summary: Safety sources support caution around withdrawal, migraine or severe headache, hypertension or cardiovascular symptoms, pregnancy or lactation, panic or severe anxiety, drug interactions, caffeine-use disorder, and suspected sleep disorders.
    sourceKeys:
    - source_artifact:pmid-15448977
    - source_artifact:pmid-21880846
    - source_artifact:pmid-20664420
    - source_artifact:ncbi-lactmed-caffeine-2025-09-15
    - source_artifact:pmid-34871964
    - source_artifact:pmid-38016484
    - source_artifact:pmid-24761279
    - source_artifact:dailymed-ciprofloxacin-caffeine-2022-06-01
    - source_artifact:pmid-28162150
    - source_artifact:doi-10.2903-j.efsa.2015.4102
    - source_artifact:who-caffeine-pregnancy-2023-08-09
    - source_artifact:pmid-28438661
    - source_artifact:pmid-38350307
    - source_artifact:pmid-32949106
    - source_artifact:pmid-8807660
    - source_artifact:pmid-16236038
    - source_artifact:pmid-2729942
    - source_artifact:pmid-7888295
    - source_artifact:pmid-12825092
    - source_artifact:pmid-18305461
    - source_artifact:pmid-33069664
    - source_artifact:pmid-20520601
    defaultOpen: false
  - id: toxicity-concentrated-product-boundary
    label: Caffeine toxicity and concentrated-product boundary
    stance: safety_boundary
    summary: Toxicity sources support strong warnings against pure or highly concentrated caffeine products and urgent-care language for severe overdose symptoms.
    sourceKeys:
    - source_artifact:fda-highly-concentrated-caffeine-guidance-2018-04-16
    - source_artifact:fda-highly-concentrated-caffeine-guidance-2018-04-13
    - source_artifact:fda-pure-highly-concentrated-caffeine-2018-04-13
    - source_artifact:fda-pure-highly-concentrated-caffeine-2023-03-06
    - source_artifact:pmid-30422505
    - source_artifact:pmid-30505695
    defaultOpen: false
  - id: daytime-function-performance-tradeoffs
    label: Daytime performance and recovery tradeoffs
    stance: mixed
    summary: Performance sources support acknowledging that caffeine reduction may trade sleep protection for short-term alertness or performance costs, especially during withdrawal, sleep restriction, athletic performance contexts, or habituated use.
    sourceKeys:
    - source_artifact:doi-10.3390-app12199957
    - source_artifact:pmid-21178933
    - source_artifact:pmid-25115507
    - source_artifact:pmid-25700100
    - source_artifact:pmid-29029309
    - source_artifact:pmid-31480553
    - source_artifact:pmid-41003623
    defaultOpen: false
  - id: external-guidelines-and-protocol-claims
    label: External sleep-hygiene and caffeine-cutoff guidance
    stance: context_only
    summary: External protocol and guideline-like sources contextualize common caffeine-cutoff advice, but they should not be used as primary proof that this exact protocol works.
    sourceKeys:
    - source_artifact:aasm-sleep-and-caffeine-2026-04-26
    - source_artifact:sleepfoundation-caffeine-sleep-problems-2025-07-16
    - source_artifact:nhlbi-healthy-sleep-habits-2022-03-24
    - source_artifact:cdc-about-sleep-2024-05-15
    - source_artifact:harvardhealth-sleep-hygiene-2025-01-31
    - source_artifact:medlineplus-healthy-sleep-2025-12-09
    defaultOpen: false
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
  - pregnancy_trying_to_conceive_or_lactation
  - children_or_adolescents
  - persistent_insomnia_suspected_sleep_apnea_or_other_sleep_disorder
  - uncontrolled_hypertension_or_concerning_blood_pressure
  - cardiovascular_symptoms_arrhythmia_chest_pain_or_fainting_history
  - panic_disorder_severe_anxiety_or_caffeine_triggered_anxiety
  - bipolar_disorder_recent_mania_hypomania_or_lithium_treatment
  - migraine_severe_headache_prior_thunderclap_headache_or_neurologic_red_flags
  - history_of_difficult_caffeine_withdrawal
  - heavy_or_problematic_caffeine_use_or_inability_to_cut_down_despite_distress
  - shift_work_operational_alertness_or_safety_critical_duties
  - fluvoxamine_ciprofloxacin_quinolones_or_other_caffeine_interacting_medicines
  - caffeine_containing_medicines_or_supplements
  - energy_drinks_energy_shots_preworkout_or_stimulant_blends_as_primary_source
  - pure_or_highly_concentrated_caffeine_products
  stopIf:
  - chest_pain_fainting_rapid_or_erratic_heartbeat_or_severe_palpitations
  - seizure_confusion_disorientation_or_stupor
  - severe_vomiting_or_diarrhea_after_caffeine_or_suspected_overdose
  - thunderclap_headache_or_neurologic_symptoms
  - severe_or_impairing_withdrawal_symptoms
  - unsafe_daytime_sleepiness_or_safety_critical_alertness_impairment
  - panic_symptoms_or_severe_anxiety
  - new_or_worsening_mania_hypomania_agitation_or_unusually_elevated_mood
  - blood_pressure_symptoms_or_readings_outside_user_specific_safe_range
  - medication_interaction_or_new_caffeine_containing_medicine
  - sleep_clearly_worsens_after_initial_withdrawal_period_or_daytime_function_is_impaired
  - persistent_insomnia_worsening_with_daytime_impairment
  - experiment_creates_tracking_anxiety_or_rumination
  notes:
  - This is a bounded adult wellness self-experiment, not treatment for insomnia, sleep apnea, anxiety, hypertension, arrhythmia, pregnancy-related risk, lactation concerns, bipolar disorder, lithium management, medication interactions, caffeine dependence, or caffeine overdose.
  - Pure or highly concentrated caffeine powder or liquid concentrate is a hard exclusion. Do not use caffeine pills, energy shots, pre-workout products, or stimulant blends to move dose earlier.
  - Do not front-load caffeine into a large morning bolus. Keep total daily caffeine and the largest single serving stable or lower than baseline.
  - Do not skip prescribed or needed medicines to satisfy the curfew. Check labels and get clinician or pharmacist guidance when medicines contain caffeine or may alter caffeine metabolism.
  - If baseline intake is high, withdrawal is likely, or alertness is needed for safety-critical tasks, tapering or clinician-guided planning is safer than abrupt reduction.
  - 'A null result is useful: it may show caffeine timing is not a major sleep lever for that user under current conditions.'
researchCoverage:
  bibliographyKey: source_artifact:caffeine-timing-bibliography
  auditCutoff: '2026-04-27'
  corpusStats:
    canonicalSourceRecords: 303
    draftSourcePagesFound: 290
    uniqueExtractedEvidenceAppraisals: 294
    generatedNewSourcePages: 266
    existingOrResolvedSourceKeys: 30
  backboneSourceKeys:
  - source_artifact:pmid-24235903
  - source_artifact:pmid-39377163
  - source_artifact:pmid-16704567
  - source_artifact:pmid-26378246
  - source_artifact:pmid-32374052
  - source_artifact:fda-caffeine-too-much-2024-08-28
  - source_artifact:healthcanada-caffeine-in-foods-2025-04-02
  - source_artifact:pmid-15448977
  - source_artifact:pmid-35280254
  - source_artifact:pmid-29734997
  - source_artifact:pmid-38016484
nightlyLoggingFields:
- caffeine_source
- caffeine_mg
- last_caffeine_time
- curfew_met
- intended_bedtime
- actual_bedtime
- sleep_onset_latency_minutes
- sleep_efficiency
- total_sleep_time
- wake_after_sleep_onset_minutes
- deep_sleep_minutes
- resting_heart_rate
- hrv_rmssd
- sleep_quality_rating
- withdrawal_symptoms
- headache_or_migraine
- anxiety_or_palpitations
- morning_blood_pressure_if_relevant
confoundersToTrack:
- alcohol_last_24h
- late_exercise
- illness_or_fever
- travel_or_timezone_shift
- unusual_stress
- major_bedtime_change
- major_wake_time_change
- new_medication_or_supplement
- screen_or_evening_light_change
- sleep_supplement_change
- unusual_work_or_caregiving_schedule
- largest_single_caffeine_serving_mg
- first_caffeine_time
- caffeine_tablet_powder_or_concentrate_exposure
- energy_drink_shot_or_preworkout_exposure
- guarana_yerba_mate_or_stimulant_blend
- caffeine_containing_medication
- interacting_medication_or_antibiotic
- lithium_or_psychiatric_medication_change
- oral_contraceptive_or_hormone_context
- smoking_or_nicotine_status_change
- pregnancy_trying_to_conceive_or_lactation_context
- safety_critical_alertness_demand
- withdrawal_symptom_severity
- rescue_headache_or_migraine_medication
- blood_pressure_reading_context_if_relevant
---

## Question this experiment answers

After a stable baseline, does moving all caffeine before a strict late-morning or 8-hour bedtime cutoff make sleep onset, sleep continuity, or next-morning recovery look better for this user?

## Simple version

Run a 21-day test when possible:

- **7 baseline days** logging usual caffeine without changing it
- **14 intervention days** with all caffeine before the earlier of **10–11am** or **8 hours before intended bedtime**
- **12 target adherent days**, with **10 days** as the minimum useful first read
- all-source caffeine logging, including coffee, tea, decaf, chocolate/cocoa, cola, energy drinks or shots, pre-workout or stimulant blends, caffeine tablets or powders, and caffeine-containing medicines, with high-dose or concentrated products treated as safety flags rather than implementation tools

Use the simplest version first. The point is not to prove that caffeine is bad. The point is to test whether late, high-dose, or hidden caffeine exposure is a meaningful sleep lever for this person.

## Before starting

Use this ordinary version only as an adult wellness experiment. Do not start it unsupervised if you are pregnant, trying to conceive, lactating, a child or adolescent, managing persistent insomnia or suspected sleep apnea, working shifts or safety-critical duties, taking lithium, fluvoxamine, ciprofloxacin or another quinolone antibiotic, caffeine-containing medicines, or any medicine a clinician or pharmacist says may interact with caffeine.

Do not use caffeine pills, pure caffeine powder, liquid caffeine concentrate, energy shots, pre-workout products, or stimulant blends to move the dose earlier. The goal is not to cram the same or a larger dose into the morning.

Stop the experiment and seek urgent guidance for chest pain, fainting, rapid or erratic heartbeat, severe palpitations, seizure, severe vomiting or diarrhea, confusion, disorientation, thunderclap headache, neurologic symptoms, or suspected caffeine overdose. Do not drive, operate machinery, or do safety-critical work when withdrawal or sleepiness is impairing alertness.

## What could change

Primary signal:

- **Sleep-onset latency:** less residual caffeine near bedtime means adenosine pressure is less blocked; affected users may fall asleep about **5-15 minutes faster** on adherent nights.

Useful objective signals:

- **Sleep efficiency:** less stimulant arousal can turn more time in bed into sleep; same-device or diary efficiency may rise about **2-7 percentage points**.
- **Total sleep time or wake after sleep onset:** less fragmentation can add about **20-45 minutes** of sleep or cut overnight wake time by about **5-12 minutes** when late or high-dose caffeine was the driver.
- **Deep sleep minutes:** caffeine can keep sleep lighter and suppress slow-wave sleep; same-device deep sleep may rise roughly **5-12 minutes** when late or high-dose caffeine was the driver.
- **Resting heart rate:** smoother, less stimulated nights can lower overnight strain; wearable RHR may be **stable to 2 bpm lower**.
- **Morning blood pressure, when relevant:** less residual stimulation can trim sensitive users' home-cuff readings by about **0-4 mmHg systolic**.
- **HRV/RMSSD:** smoother sleep can support parasympathetic recovery, but caffeine and withdrawal move RMSSD inconsistently; use same-device HRV as recoverability context.

Subjective sleep quality, next-morning energy, headache, anxiety, palpitations, and withdrawal notes explain the objective pattern and safety burden. They are not the outcome win by themselves.

Call it a signal when the pattern repeats across adherent nights and the same nights are not dominated by alcohol, illness, travel, stress, large bedtime shifts, hard late training, a new supplement or medicine, or a new screen/light routine.

## Implementation notes

The curfew has two parts: a **clock boundary** and a **bedtime buffer**. Use the earlier one each day. For most users with a normal bedtime, the 10–11am boundary will be stricter than the 8-hour bedtime buffer. For an unusually early bedtime, the 8-hour buffer may become stricter.

Do not compensate by taking a much larger early dose. That would change the dose question and may create safety or withdrawal problems later in the day. If the baseline dose is high, if reduction causes functional impairment, or if caffeine is needed for safety-critical alertness, stop the ordinary experiment and use a slower taper or clinician-guided plan rather than forcing an abrupt drop.

## Off-ramp

At the end of the test, use the plainest conclusion:

1. **Worth repeating** if sleep onset or sleep continuity improved on adherent days with low burden and no concerning symptoms.
2. **Probably noise** if only one or two days moved, or the signal was confounded by schedule, alcohol, illness, stress, travel, or routine changes.
3. **Not worth it** if withdrawal, daytime fatigue, headache, anxiety, safety issues, or tracking burden outweighed any sleep signal.
