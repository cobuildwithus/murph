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
  sessionShape:
    label: Caffeine cutoff window
    segments:
    - label: caffeine-free buffer
      kind: stimulus
      durationMinutes: 480
    - label: bedtime
      kind: transition
      durationMinutes: 5
    ticks:
    - label: cutoff
      offsetMinutes: 0
    - label: "8 h / bedtime"
      offsetMinutes: 485
  interventionSessionsMinimum: 10
  interventionSessionsTarget: 12
  steps:
    - "Run a 7-day baseline when possible; keep caffeine unchanged and log source, serving size, estimated mg, and time."
    - "Choose bedtime anchor; set cutoff as earlier of 10–11 AM or 8h before bed."
    - "For 14 days, keep all caffeine before cutoff; log coffee, tea, energy products, decaf, chocolate, supplements, and medicines."
    - "Keep total caffeine stable or lower; do not stack one large early dose or use pills, powders, shots, or pre-workout."
    - "Track cutoff adherence, total mg, sleep timing, sleep onset, sleep quality, and withdrawal or excess-caffeine symptoms daily."
    - "Review adherent days against baseline; flag alcohol, illness, stress, travel, late exercise, schedule shifts, and medication changes."
  tips:
  - "Run baseline first: log source, milligrams, last caffeine time, bedtime, and sleep onset for 7 days."
  - "Set cutoff as the earlier of 10–11am or 8 hours before intended bedtime."
  - "Make morning caffeine measured: coffee, tea, decaf, chocolate, pre-workout, supplements, and medicines all count."
  - "Avoid front-loading: skip pills, powders, energy shots, pre-workout, or one giant early dose."
  - "Keep bedtime, wake time, alcohol, late exercise, light, and screen habits unchanged during the test."
  - "Log small misses honestly; separate withdrawal headaches and fatigue from sleep gains in the first days."
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
  sessionFieldIds:
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
  stopConditions:
  - Stop or taper if withdrawal symptoms impair driving, work, caregiving, or safety-critical tasks; do not drive or operate machinery while impaired.
  - Stop and seek urgent care for chest pain, fainting, seizure, severe palpitations, confusion, neurologic symptoms, thunderclap headache, or suspected caffeine overdose.
  - Do not run unsupervised during pregnancy, lactation, for children, or with persistent insomnia or sleep apnea without clinician guidance.
  - Pause for clinician guidance if panic, mania, hypertension, arrhythmia, or medication interactions are present.
  - End the experiment if sleep worsens after the withdrawal period, daytime function is impaired, or tracking creates distress.
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
  expectedDirection: up
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
  schemaVersion: "murph.commons.experiment-onboarding.v2"
  startIntent:
    displayPrompt: "Hey Murph, I want to test a caffeine curfew and dose reset."
    intentSummary: "Explore Caffeine Curfew + Dose Reset"
  safetyScreen:
    dispositionIfAnyPositive: "clinician_guidance_before_unsupervised_start"
    mustAsk:
      - id: "pregnancy_lactation_trying_to_conceive_or_youth"
        prompt: "pregnancy, trying to conceive, lactation, or the protocol is for a child or adolescent"
      - id: "cardiovascular_bp_or_syncope"
        prompt: "uncontrolled high blood pressure, arrhythmia, chest pain history, fainting/syncope, severe palpitations, concerning blood-pressure readings, or clinician advice to limit caffeine"
      - id: "panic_anxiety_bipolar_lithium_or_mood_instability"
        prompt: "panic disorder, severe anxiety, caffeine-triggered anxiety, bipolar disorder, recent mania or hypomania, severe mood instability, lithium treatment, or a recent lithium dose change"
      - id: "headache_withdrawal_dependence_or_heavy_use"
        prompt: "migraine vulnerability, severe headaches, prior thunderclap headache, prior difficult caffeine withdrawal, heavy caffeine use, caffeine dependence concerns, or inability to cut down despite distress or impairment"
      - id: "sleep_disorder_or_operational_alertness"
        prompt: "diagnosed or persistent insomnia, suspected sleep apnea, shift-work sleep disorder, rotating shifts, professional driving, heavy machinery, clinical/on-call work, overnight caregiving, or other safety-critical alertness requirements"
      - id: "medication_interactions_or_hidden_caffeine"
        prompt: "fluvoxamine, ciprofloxacin or other quinolone antibiotics, caffeine-containing pain relievers or medicines, psychiatric medicines, supplements/pre-workouts, or any clinician/pharmacist warning about caffeine interactions"
      - id: "concentrated_or_high_dose_caffeine_products"
        prompt: "pure caffeine powder, liquid caffeine concentrate, caffeine tablets, energy shots, pre-workout products, guarana/yerba mate products, or frequent energy-drink use"
  setupSlots:
    - id: "bedtime_anchor"
      label: "Bedtime anchor"
      question: "What intended bedtime should Murph use to calculate the 8-hour caffeine buffer?"
      constraints:
        askWhen: "if_unknown_or_stale"
      target:
        object: "experimentRun"
        field: "bedtimeAnchor"
    - id: "curfew_choice"
      label: "Late-morning curfew"
      question: "Should the late-morning curfew be 10am or 11am for this first run?"
      options:
        - "ten_am"
        - "eleven_am"
      constraints:
        default: "eleven_am"
        sensitiveOrSleepReactiveDefault: "ten_am"
      target:
        object: "experimentRun"
        field: "curfewChoice"
    - id: "baseline_caffeine_dose"
      label: "Baseline caffeine dose"
      question: "About how many milligrams of caffeine do you usually have per day?"
      constraints:
        optional: true
        unit: "mg_per_day"
        useApproximateIfUnknown: true
      target:
        object: "onboardingCapture"
        field: "baselineCaffeineMg"
    - id: "last_caffeine_time"
      label: "Usual last caffeine time"
      question: "What time do you usually have your last caffeine?"
      constraints:
        optional: true
      target:
        object: "onboardingCapture"
        field: "usualLastCaffeineTime"
    - id: "source_audit"
      label: "All-source caffeine audit"
      question: "Which caffeine sources should Murph watch for in your logs?"
      options:
        - "coffee_only"
        - "coffee_tea"
        - "energy_preworkout"
        - "medications_or_supplements"
        - "all_sources_or_unsure"
      target:
        object: "onboardingCapture"
        field: "caffeineSourcePattern"
    - id: "largest_single_caffeine_serving"
      label: "Largest single caffeine serving"
      question: "About how many milligrams are in your largest usual single caffeine serving?"
      constraints:
        optional: true
        unit: "mg"
        useApproximateIfUnknown: true
      target:
        object: "onboardingCapture"
        field: "largestSingleCaffeineServingMg"
    - id: "metabolism_modifiers"
      label: "Caffeine metabolism modifiers"
      question: "Any oral contraceptive or hormone therapy use, pregnancy/trying/lactation status, smoking/nicotine status change, or medication that might alter caffeine metabolism?"
      options:
        - "none_known"
        - "oral_contraceptive_or_hormone_therapy"
        - "pregnancy_trying_or_lactation"
        - "smoking_or_nicotine_status_change"
        - "interacting_medication_possible"
        - "unsure"
      constraints:
        optional: true
        askWhen: "if_unknown_or_stale"
      target:
        object: "onboardingCapture"
        field: "caffeineMetabolismModifiers"
    - id: "taper_need"
      label: "Taper need"
      question: "Do you expect headaches, fatigue, or functional impairment if you suddenly reduce or move caffeine earlier?"
      options:
        - "unlikely"
        - "possible"
        - "likely_or_prior_withdrawal"
        - "unsure"
      target:
        object: "experimentRun"
        field: "taperNeed"
    - id: "reminder_policy"
      label: "Reminder policy"
      question: "Do you want a pre-curfew reminder, a next-morning missing-log check, both, or neither?"
      options:
        - "none"
        - "pre_curfew"
        - "next_morning_missing_log_check"
        - "pre_curfew_plus_next_morning_check"
      constraints:
        askWhen: "at_confirmation"
      target:
        object: "assistantSupport"
        field: "reminderPolicy"
  planDefaults:
    testPlanId: "caffeine-curfew-21d"
    firstSessionGuidance: "Start by moving the last planned caffeine before the cutoff; do not add a new sleep supplement, new bedtime, or screen curfew during the same test."
  trackingHints:
    confounderFields:
      - "alcohol_last_24h"
      - "late_exercise"
      - "illness_or_fever"
      - "travel_or_timezone_shift"
      - "unusual_stress"
      - "new_medication_or_supplement"
      - "major_bedtime_shift"
      - "screen_or_light_change"
      - "largest_single_caffeine_serving_mg"
      - "first_caffeine_time"
      - "caffeine_tablet_powder_or_concentrate_exposure"
      - "energy_drink_shot_or_preworkout_exposure"
      - "guarana_yerba_mate_or_stimulant_blend"
      - "caffeine_containing_medication"
      - "interacting_medication_or_antibiotic"
      - "lithium_or_psychiatric_medication_change"
      - "oral_contraceptive_or_hormone_context"
      - "pregnancy_trying_to_conceive_or_lactation_context"
      - "safety_critical_alertness_demand"
      - "withdrawal_symptom_severity"
      - "rescue_headache_or_migraine_medication"
      - "blood_pressure_reading_context_if_relevant"
      - "smoking_or_nicotine_status_change"
    notes:
      - "Ask for all caffeine sources, including decaf residual caffeine and OTC medication caffeine, not just coffee."
  supportHints:
    missedLogFollowupCopy: "Did you end up having any caffeine after your cutoff yesterday? Totally fine either way—I just want the experiment record to be accurate."
whyItWorks:
  - "## Caffeine blocks sleep pressure\n\nAdenosine builds across the day; caffeine blocks that signal. Late caffeine keeps the brain chemically less ready for sleep even when the clock says bedtime."
  - "## Earlier cutoff clears the blockade\n\nMoving caffeine earlier gives clearance time. Less residual stimulant load means sleep pressure, melatonin timing, and quiet wakefulness stop fighting as hard."
  - "## Dose reset exposes the driver\n\nLogging all sources separates timing from total intake. Coffee, tea, energy drinks, decaf, chocolate, and medicines all count because the nervous system sees caffeine, not categories."
mechanismChain:
  -
    label: "Daily rule"
    content: "All caffeine before late morning or ≥8h before bed"
  -
    label: "Acute effect"
    content: "Less adenosine blockade; less stimulant arousal near bedtime"
  -
    label: "Repeated signal"
    content: "Stronger sleep pressure · fewer night wake signals · lower arousal"
  -
    label: "Adaptation"
    content: "Sleep onset shortens · sleep continuity improves · overnight pulse settles"
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
    - source_artifact:pmid-25759402
    - source_artifact:doi-10.1016-j.jarlif.2025.100005
    - source_artifact:pmid-1475567
    - source_artifact:pmid-30573997
    - source_artifact:pmid-22454948
    - source_artifact:doi-10.1002-sici-1099-1077-199605-11-3-185-aid-hup786-3.0.co-2-m
    - source_artifact:pmid-21531247
    - source_artifact:anzctr-actrn12621001625864-2021-11-29
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
    - source_artifact:pmid-15696321
    - source_artifact:pmid-11057520
    - source_artifact:clinicaltrials-nct01376882-caffeine-abstinence-maintenance-2026-04-26
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
    - source_artifact:pmid-12519715
    - source_artifact:pmid-28603504
    - source_artifact:doi-10.2903-j.efsa.2015.4102
    - source_artifact:pmid-39125266
    - source_artifact:pmid-16620542
    - source_artifact:pmid-30678328
    - source_artifact:pmid-17412475
    - source_artifact:pmid-17676317
    - source_artifact:pmid-19007524
    - source_artifact:pmid-22963537
    - source_artifact:pmid-25818465
    - source_artifact:pmid-36297100
    - source_artifact:pmid-35057494
    - source_artifact:usda-fooddata-central-caffeine-2026-04-26
    - source_artifact:pmid-37444212
    - source_artifact:pmid-11296156
    - source_artifact:pmid-23303430
    - source_artifact:pmid-24189158
    - source_artifact:pmid-30580203
    - source_artifact:pmid-33388079
    - source_artifact:pmid-36862943
    - source_artifact:pmid-38262632
    - source_artifact:doi-10.1111-j.1365-2621.1980.tb02603.x
    - source_artifact:pmid-34509583
    - source_artifact:pmid-32723415
    - source_artifact:pmid-28605236
    - source_artifact:pmid-30445721
    - source_artifact:pmid-8603790
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
    - source_artifact:pmid-4029248
    - source_artifact:pmid-38221756
    - source_artifact:pmid-23368828
    - source_artifact:pmid-15257305
    - source_artifact:pmid-31817803
    - source_artifact:pmid-6101960
    - source_artifact:pmid-39686012
    - source_artifact:pmid-6124991
    - source_artifact:pmid-41622288
    - source_artifact:pmid-28323455
    - source_artifact:pmid-29367845
    - source_artifact:pmid-14592218
    - source_artifact:pmid-15588154
    - source_artifact:pmid-35575450
    - source_artifact:pmid-6734698
    - source_artifact:ncbi-bookshelf-caffeine-cns-behavioral-effects-2026-04-26
    - source_artifact:pmid-39438936
    - source_artifact:pmid-22754033
    - source_artifact:pmid-6687705
    - source_artifact:pmid-30387917
    - source_artifact:pmid-3608349
    - source_artifact:pmid-8738764
    - source_artifact:pmid-10233211
    - source_artifact:pmid-10376760
    - source_artifact:pmid-10233204
    - source_artifact:pmid-37269785
    - source_artifact:clinicaltrials-nct03855774-2019-02-28
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
    - source_artifact:pmid-16184581
    - source_artifact:pmid-29991438
    - source_artifact:pmid-39460013
    - source_artifact:pmid-31154154
    - source_artifact:pmid-40834291
    - source_artifact:doi-10.1038-s41598-025-93774-z
    - source_artifact:pmid-31778122
    - source_artifact:pmid-31641776
    - source_artifact:pmid-38499793
    - source_artifact:pmid-31901524
    - source_artifact:pmid-38557808
    - source_artifact:pmid-30789439
    - source_artifact:pmid-34063579
    - source_artifact:pmid-29668452
    - source_artifact:pmid-31739855
    - source_artifact:pmid-21447050
    - source_artifact:pmid-36879665
    - source_artifact:pmid-18274276
    - source_artifact:pmid-38090797
    - source_artifact:pmid-27164110
    - source_artifact:pmid-21237680
    - source_artifact:pmid-14592388
    - source_artifact:pmid-17520797
    - source_artifact:pmid-20374444
    - source_artifact:pmid-29235907
    - source_artifact:pmid-26969518
    - source_artifact:pmid-38131698
    - source_artifact:doi-10.1089-jcr.2013.0009
    - source_artifact:pmid-29034226
    - source_artifact:pmid-33134038
    - source_artifact:doi-10.3389-fnins.2014.00402
    - source_artifact:pmid-20663071
    - source_artifact:pmid-21658979
    - source_artifact:pmid-24137133
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
    - source_artifact:pmid-39458438
    - source_artifact:ncbi-bookshelf-caffeine-withdrawal-2026-04-26
    - source_artifact:pmid-10672630
    - source_artifact:pmid-16541243
    - source_artifact:pmid-12601503
    - source_artifact:pmid-17950009
    - source_artifact:pmid-16001109
    - source_artifact:pmid-9701720
    - source_artifact:pmid-19342294
    - source_artifact:pmid-31866308
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
    - source_artifact:pmid-22341956
    - source_artifact:pmid-12204389
    - source_artifact:pmid-9695448
    - source_artifact:pmid-26933153
    defaultOpen: false
  - id: clinical-safety-cardiovascular-anxiety-pregnancy
    label: Clinical safety boundaries
    stance: safety_boundary
    summary: Safety sources support caution around withdrawal, migraine or severe headache, hypertension or cardiovascular symptoms, pregnancy or lactation, panic or severe anxiety, drug interactions, caffeine-use disorder, and suspected sleep disorders.
    sourceKeys:
    - source_artifact:pmid-21880846
    - source_artifact:pmid-20664420
    - source_artifact:ncbi-lactmed-caffeine-2025-09-15
    - source_artifact:pmid-34871964
    - source_artifact:pmid-38016484
    - source_artifact:pmid-24761279
    - source_artifact:dailymed-ciprofloxacin-caffeine-2022-06-01
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
    - source_artifact:pmid-11503005
    - source_artifact:pmid-25179792
    - source_artifact:pmid-25238871
    - source_artifact:pmid-26329421
    - source_artifact:pmid-26358647
    - source_artifact:pmid-6954898
    - source_artifact:pmid-38362247
    - source_artifact:pmid-15834273
    - source_artifact:pmid-20164571
    - source_artifact:pmid-22369218
    - source_artifact:pmid-24009307
    - source_artifact:doi-10.1001-jamanetworkopen.2021.3238
    - source_artifact:pmid-20844077
    - source_artifact:pmid-32843532
    - source_artifact:pmid-36833216
    - source_artifact:pmid-28756014
    - source_artifact:pmid-36947466
    - source_artifact:pmid-20532872
    - source_artifact:pmid-37029915
    - source_artifact:pmid-10024321
    - source_artifact:pmid-24680173
    - source_artifact:pmid-41206802
    - source_artifact:pmid-3768258
    - source_artifact:pmid-30257492
    - source_artifact:pmid-28609150
    - source_artifact:pmid-3131789
    - source_artifact:clinicaltrials-nct01951872-caffeine-dependence-2026-04-26
    - source_artifact:pmid-10073894
    - source_artifact:pmid-25089257
    - source_artifact:pmid-34000324
    - source_artifact:pmid-26501499
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
    - source_artifact:pmid-29431593
    - source_artifact:clinicaltrials-nct07090421-2026-04-26
    - source_artifact:hubermanlab-improve-your-sleep-2026-04-26
    - source_artifact:hubermanlab-toolkit-for-sleep-2021-09-20
    - source_artifact:pmid-10713298
    - source_artifact:pmid-10823400
    - source_artifact:pmid-11683484
    - source_artifact:pmid-16313140
    - source_artifact:pmid-16936703
    - source_artifact:pmid-24682207
    - source_artifact:pmid-25527035
    - source_artifact:pmid-33401238
    - source_artifact:pmid-34132880
    - source_artifact:pmid-34340214
    - source_artifact:pmid-41477315
    - source_artifact:pmid-19351801
    - source_artifact:pmid-15887055
    - source_artifact:pmid-35894958
    - source_artifact:pmid-39551351
    - source_artifact:pmid-40579619
    - source_artifact:pmid-24859426
    - source_artifact:pmid-33364521
    - source_artifact:pmid-19088794
    - source_artifact:pmid-29876876
    - source_artifact:pmid-30977054
    - source_artifact:pmid-30926628
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
    - source_artifact:doi-10.1186-s41606-026-00175-w
    - source_artifact:pmid-31386152
    - source_artifact:pmid-34710040
    - source_artifact:pmid-7636092
    - source_artifact:pmid-35010906
    - source_artifact:pmid-38201961
    - source_artifact:pmid-27377580
    - source_artifact:pmid-41792005
    - source_artifact:pmid-27527212
    - source_artifact:pmid-28265249
    - source_artifact:aasm-scoring-manual-v3-2023-06-03
    - source_artifact:pmid-8438665
    - source_artifact:sleephealthfoundation-caffeine-and-sleep-2024-01-12
    - source_artifact:va-cbti-sleep-hygiene-2025-02-01
    - source_artifact:sleepeducation-healthy-sleep-habits-2021-04-02
    - source_artifact:health-10-3-2-1-0-sleep-rule-2026-03-29
    - source_artifact:timesofindia-10-3-2-1-sleep-rule-2025-11-24
    - source_artifact:pmid-12927121
    - source_artifact:pmid-25454674
    defaultOpen: false
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
  - pregnancy_trying_to_conceive_or_lactation
  - children_or_adolescents
  - persistent_insomnia_or_sleep_apnea
  - uncontrolled_blood_pressure
  - arrhythmia_or_cardiovascular_symptoms
  - panic_disorder_or_caffeine_anxiety
  - bipolar_disorder_or_lithium_treatment
  - migraine_or_thunderclap_headache
  - neurologic_red_flags
  - difficult_caffeine_withdrawal_history
  - heavy_problematic_caffeine_use
  - shift_work_or_safety_critical_duties
  - caffeine_interacting_medicines
  - caffeine_containing_supplements
  - energy_drinks_or_stimulant_blends
  - pure_or_concentrated_caffeine_products
  stopIf:
  - chest_pain_fainting_seizure_or_neurologic_symptoms
  - severe_vomiting_or_suspected_caffeine_overdose
  - severe_withdrawal_or_unsafe_daytime_sleepiness
  - panic_severe_anxiety_mania_or_unstable_mood
  - blood_pressure_concern_or_medication_interaction
  - sleep_worsens_or_daytime_function_impaired
  - tracking_anxiety_or_rumination
  notes:
  - Wellness experiment — not treatment for insomnia, sleep apnea, or caffeine dependence.
  - Pure caffeine powder, concentrate, pills, energy shots, and pre-workouts are excluded.
  - Keep total daily caffeine stable — do not front-load into one large morning bolus.
  - Do not skip needed medicines to meet the curfew — check labels with a pharmacist.
  - High baseline or safety-critical alertness needs? Taper or get clinician guidance first.
  - 'A null result is useful — it may show timing is not a major sleep lever for this user.'
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
