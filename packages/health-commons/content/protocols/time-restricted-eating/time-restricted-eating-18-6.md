---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:time-restricted-eating/time-restricted-eating-18-6
slug: protocols/time-restricted-eating/time-restricted-eating-18-6
title: Intermittent Fasting
summary: All calories inside a 6-hour window each day, where a longer overnight fast lets insulin and blood sugar drop and aligns eating with the hours when the body handles fuel most efficiently.
status: field-testing
quality: usable
aliases:
- 18:6 TRE
- 18-hour fast 6-hour eating window
- six-hour time-restricted eating
categories:
- nutrition
- metabolic-health
- circadian
- weight-management
media:
- kind: image
  relativePath: design-assets/hero-intermittent-fasting.jpg
  mediaType: image/jpeg
  caption: Intermittent Fasting
relations:
- type: parent_family
  target: experiment_family:time-restricted-eating
- type: primary_biomarker
  target: biomarker:body-weight
- type: secondary_biomarker
  target: biomarker:blood-glucose
- type: secondary_biomarker
  target: biomarker:morning-blood-pressure
- type: secondary_biomarker
  target: biomarker:waist-circumference
- type: secondary_biomarker
  target: biomarker:sleep-efficiency
  note: Safety and quality context; not an expected efficacy gain.
- type: cites
  target: source_artifact:pmid-32673591
- type: cites
  target: source_artifact:pmid-29754952
- type: cites
  target: source_artifact:pmid-36034217
- type: cites
  target: source_artifact:pmid-33759620
- type: cites
  target: source_artifact:pmid-32986097
- type: cites
  target: source_artifact:pmid-35443107
- type: cites
  target: source_artifact:pmid-35939311
- type: cites
  target: source_artifact:pmid-37889487
- type: cites
  target: source_artifact:pmid-39348690
- type: cites
  target: source_artifact:pmid-31813824
- type: cites
  target: source_artifact:pmid-31151228
- type: cites
  target: source_artifact:pmid-31339000
- type: cites
  target: source_artifact:pmid-36241590
- type: cites
  target: source_artifact:pmid-41010536
- type: cites
  target: source_artifact:pmid-41818195
- type: cites
  target: source_artifact:pmid-32480126
- type: cites
  target: source_artifact:pmid-35820237
- type: cites
  target: source_artifact:pmid-26411343
- type: cites
  target: source_artifact:pmid-39614235
- type: cites
  target: source_artifact:doi-10.1093-cdn-nzab039_002
- type: cites
  target: source_artifact:pmid-34201442
- type: cites
  target: source_artifact:pmid-36712501
- type: cites
  target: source_artifact:pmid-37242218
- type: cites
  target: source_artifact:pmid-38639542
- type: cites
  target: source_artifact:pmid-39973006
- type: cites
  target: source_artifact:pmid-36930148
- type: cites
  target: source_artifact:pmid-38357669
- type: cites
  target: source_artifact:pmid-40298934
- type: cites
  target: source_artifact:pmid-41692034
- type: cites
  target: source_artifact:pmid-35934114
- type: cites
  target: source_artifact:pmid-39894958
- type: cites
  target: source_artifact:pmid-40318250
- type: cites
  target: source_artifact:pmid-36610542
- type: cites
  target: source_artifact:pmid-40117066
- type: cites
  target: source_artifact:pmid-38987755
- type: cites
  target: source_artifact:pmid-31003482
- type: cites
  target: source_artifact:pmid-15451892
- type: cites
  target: source_artifact:ncbi-bookshelf-diabetes-management-ramadan-2022-03-04
- type: cites
  target: source_artifact:pmid-39785103
- type: cites
  target: source_artifact:pmid-28654225
- type: cites
  target: source_artifact:pmid-19025239
- type: cites
  target: source_artifact:pmid-37752011
- type: cites
  target: source_artifact:pmid-17127188
- type: cites
  target: source_artifact:pmid-40849219
- type: cites
  target: source_artifact:heart-org-time-restricted-eating-cvd-death-2024-03-18
lineage:
  relationship: derived
  forkOf: experiment_family:time-restricted-eating
  rationale: Protocol variant separated from adjacent TRE windows, calorie-restricted protocols, and clinical protocols because direct 18:6 evidence and safety boundaries do not transfer cleanly across variants.
attribution:
  ownerType: murph
  note: Direct efficacy claims are limited to extracted 6-hour eating-window studies, which are short-term and mostly selected-population evidence. Graded starter windows are Murph implementation scaffolding. Adjacent 8-hour, 10-hour, 16:8, calorie-restricted, clinical-population, mechanistic, observational, registry, protocol-only, and safety-only sources are context and must be labeled as such.
protocol:
  doseSignature: 18-hour fast / 6-hour eating window after a graded starter-window ramp
  target: All calories inside one consistent 6-hour window on target days; water during the fasting interval. Other zero-calorie beverage rules are product-policy choices unless an underlying source explicitly verifies them.
  frequency:
    sessionsPerWeek: 5
  sessionShape:
    label: Target day
    segments:
    - label: fasting window
      kind: context
      durationMinutes: 1080
    - label: eating window
      kind: stimulus
      durationMinutes: 360
    ticks:
    - label: "0"
      offsetMinutes: 0
    - label: "18 h"
      offsetMinutes: 1080
    - label: "24 h"
      offsetMinutes: 1440
  interventionSessionsMinimum: 16
  interventionSessionsTarget: 20
  steps:
    - "Baseline 14 days: log normal first/last calorie times, weight, hunger, energy, mood, symptoms, sleep, training, meds, and intake estimates."
    - "Pick the earliest repeatable 6h window; record actual first-calorie and last-calorie times."
    - "Ramp 12:12 for 4 days, 14:10 for 4 days, 16:8 for 6 days, then target 18:6."
    - "Stay at the last tolerable tier if symptoms, binge/restrict patterns, sleep disruption, headaches, missed days, or life friction appear."
    - "Use 5–7 logged target-window days/week after ramp; 4 days/week is the minimum analyzable exposure."
    - "Keep food quality, protein, fiber, training load, caffeine, alcohol, and sleep schedule stable."
    - "Use water during fasting; log missed days and context instead of compensating with longer fasts."
  safetyNotes:
  - Potentially reasonable only as a safety-screened self-experiment for medically stable adults, with rollback rules.
  - Safety gating should take priority over efficacy interpretation.
  - People with diabetes or glucose-lowering medication, pregnancy or breastfeeding, current underweight, unexplained weight loss, eating-disorder history, adolescent status, athlete low-energy-availability risk, CKD/frailty, gallbladder-risk symptoms, or clinician-directed meal timing should not start self-directed 18:6 without clinician guidance.
  tips:
  - "Baseline 14 days: log first calories, last calories, weight, hunger, sleep, training, caffeine, and alcohol."
  - "Pick the earliest repeatable 6-hour window; repeatable beats ideal when work, family, or sleep suffer."
  - "Ramp 12:12, 14:10, 16:8, then 18:6; stay at the last easy tier."
  - "First meal: protein, fiber, fluids, familiar carbs. No giant catch-up meal or celebratory refeed."
  - "Skip sauna, hard training, alcohol binges, late caffeine, and long travel during target-window weeks."
  - "Do not extend fasts for ketones, scale drops, or willpower; log the planned window."
  keepInMind:
  - The direct 6-hour evidence base is relevant but small, short-term, and selected-population; adjacent evidence should remain adjacent rather than being promoted to direct 18:6 proof.
  - Early 6-hour windows have the clearest direct timing-specific rationale, but later 6-hour windows may still affect weight and are not proven ineffective.
  - Do not expect a reliable sleep improvement, energy-expenditure boost, or superiority over calorie restriction; track total intake, protein/fiber, diet quality, adherence, and body composition where possible.
  - RHR and HRV may be logged as optional personal context only. They are not evidence-backed safety biomarkers for this protocol in the landed source set.
  - Observational cardiovascular-duration signals are noncausal context and should be used to avoid long-term safety or longevity overclaims.
  logFields:
  - first-calorie time
  - last-calorie time
  - eating-window hours
  - fasting-window hours
  - target-window adherence
  - hunger rating
  - energy rating
  - mood rating
  - headache or dizziness
  - hypoglycemia symptoms
  - binge-restrict urges
  - sleep duration and quality
  - body weight
  - waist circumference
  - fasting glucose if available
  - blood pressure if available
  - calories if tracked
  - protein if tracked
  - meal timing
  - caffeine and alcohol
  - training load
  - medication changes
  - menstrual cycle where relevant
  - illness or travel context
  - weight change
  stopConditions:
  - Hypoglycemia symptoms, measured low glucose, syncope, near-syncope, repeated dizziness, or unsafe weakness.
  - Binge-restrict cycling, purging, obsessive food preoccupation, escalating distress about eating, or clinically meaningful mood worsening.
  - Sleep disruption, headache, training underfueling, recovery deterioration, or repeated inability to eat enough calories or protein inside the window.
  - Unexplained or rapid weight loss, current underweight status, new pregnancy, acute illness, dehydration, or medication changes that affect glucose, blood pressure, hydration, or required meal timing.
  - Right-upper-quadrant or severe abdominal pain, gallbladder-risk symptoms, or any clinician advice to stop fasting or follow a different meal schedule.
testPlans:
- planId: tre-18-6-baseline-ramp-target
  durationDays: 56
  baselineDays: 14
  interventionDays: 42
  primaryBiomarkerKey: biomarker:body-weight
  secondaryBiomarkerKeys:
  - biomarker:blood-glucose
  - biomarker:morning-blood-pressure
  - biomarker:waist-circumference
  - biomarker:sleep-efficiency
  safetyOutcomeKeys:
  - safety:hypoglycemia-symptoms
  - safety:dizziness-syncope
  - safety:binge-restrict-cycling
  - safety:sleep-disruption
  - safety:training-underfueling
  - safety:mood-worsening
  minimumAdherenceSessions: 16
  targetAdherenceSessions: 20
  notes:
  - Use 14 baseline days, 14 graded ramp days, then 28 target-window days. Count at least 4 logged target-window days per week after the ramp as the minimum analyzable exposure; this is a Murph analysis rule, not an evidence-derived optimal dose.
  - Calories, protein, meal timing, caffeine/alcohol, training load, sleep, medications, menstrual cycle where relevant, and weight change should be logged as confounders.
  - Resting heart rate and HRV can be optional personal context, but they are not evidence-backed safety biomarkers for the landed 18:6 TRE source set.
expectedSignalDescriptions:
- biomarkerKey: biomarker:body-weight
  expected: down_or_stable
  protocolProminence: focus
  description: "A 6-hour eating window reduces eating opportunity and late calories, creating an energy gap that lowers weekly scale averages when intake falls."
  displayValue: "Down 1-3%"
  estimatedChange:
    kind: relative_percent
    low: -3
    high: -1
    unit: "%"
    window: 8 weeks
    confidence: low
    basis: Direct 6-hour trials report about 3% loss or comparable 8-week loss in adults with overweight or obesity; calorie-controlled and synthesis evidence points to smaller or intake-dependent effects.
- biomarkerKey: biomarker:blood-glucose
  expected: down_or_stable
  protocolProminence: focus
  description: "Earlier, shorter eating shifts calories into higher insulin sensitivity and leaves a longer overnight interval for glucose clearance."
  displayValue: "Up to 5 mg/dL lower"
  estimatedChange:
    kind: absolute
    low: -5
    high: 0
    unit: mg/dL
    window: 4 days to 8 weeks
    confidence: low
    basis: Early 6-hour studies lowered 24-hour or mean glucose by a few mg/dL, while fasting-glucose, later-window, isocaloric, and adjacent-window results are weaker or null.
- biomarkerKey: biomarker:morning-blood-pressure
  expected: down_or_stable
  expectedDirection: down
  protocolProminence: focus
  description: "Earlier calories and a longer overnight fast lower insulin exposure and support daytime salt and vascular rhythm handling."
  displayValue: "2-6 mmHg lower"
  estimatedChange:
    kind: absolute
    low: -6
    high: -2
    unit: mmHg SBP
    window: 5 to 8 weeks
    confidence: low
    basis: Small early-window 6-hour trials reported larger systolic drops, and broader TRE synthesis suggests an average systolic reduction of roughly 4 mmHg; diastolic effects are less consistent.
- biomarkerKey: biomarker:waist-circumference
  expected: down_or_stable
  protocolProminence: context
  description: "Real fat loss reduces abdominal tissue over time, shrinking tape-measured waist alongside weight."
  displayValue: "Up to 4 cm smaller"
  estimatedChange:
    kind: absolute
    low: -4
    high: 0
    unit: cm
    window: 8 to 12 weeks
    confidence: low
    basis: Waist reduction is supported mainly by adjacent TRE trials and syntheses rather than direct 18:6 evidence, so it belongs behind weight, glucose, and blood pressure.
- biomarkerKey: biomarker:sleep-efficiency
  expected: stable
  expectedDirection: mixed_or_contextual
  protocolProminence: context
  description: "Less late eating reduces nighttime digestion, while hunger, underfueling, and caffeine compensation fragment sleep."
  estimatedChange:
    kind: absolute
    low: -2
    high: 2
    unit: "%"
    window: 8 weeks
    confidence: low
    basis: The closest 6-hour sleep analysis found no clear change in sleep quality, timing, duration, latency, insomnia severity, or sleep-apnea symptoms.
whyItWorks:
  - "## Fasting extends low-insulin time\n\nAn 18h fast removes incoming calories long enough for insulin to drop and stored fuel to cover the gap. The body spends more of the day outside fed metabolism."
  - "## Eating window changes timing\n\nA 6h window concentrates food into fewer circadian hours. Fuel handling improves when intake lands earlier and stays consistent."
  - "## Intake decides weight signal\n\nWeight and glucose shift when the window reduces total energy or late eating. Cramming the same calories into 6h blunts the effect."
mechanismChain:
  -
    label: "Daily rule"
    content: "18h fast · 6h eating window · stable timing"
  -
    label: "Fasted block"
    content: "Insulin falls; liver covers glucose; stored fuel use rises"
  -
    label: "Repeated signal"
    content: "Longer low-insulin blocks and earlier fuel handling repeat"
  -
    label: "Adaptation"
    content: "Glucose excursions flatten · weight drops if intake falls · hunger rhythm shifts"
claims:
- claimId: direct-six-hour-weight
  type: intervention_result
  text: A 6-hour daily eating window may produce modest short-term body-weight reduction in some adults with overweight or obesity, but effects are not guaranteed and may reflect reduced energy intake and adherence as much as timing.
  strength: low
  sourceKeys:
  - source_artifact:pmid-32673591
  - source_artifact:pmid-36034217
  - source_artifact:pmid-40298934
  caveats:
  - Direct trials were short and selected-population; calorie-control and body-composition evidence should be used to avoid interpreting weight change as a pure timing effect.
- claimId: early-window-metabolic-signals
  type: mechanistic
  text: Early 6-hour eating windows have the clearest direct timing-specific rationale for glucose, insulin, appetite, and blood-pressure signals; later 6-hour windows may still affect weight, but metabolic findings are more mixed.
  strength: low
  sourceKeys:
  - source_artifact:pmid-29754952
  - source_artifact:pmid-36034217
  - source_artifact:pmid-31151228
  - source_artifact:pmid-31339000
  caveats:
  - The strongest timing-specific evidence includes small, acute, supervised, young-adult, or prediabetes samples and does not prove that every user should choose the earliest possible window.
- claimId: not-superior-to-calorie-restriction
  type: mixed_evidence
  text: Do not claim 18:6 or TRE reliably outperforms calorie restriction, isocaloric controls, or usual-timing controls; adjacent and calorie-controlled evidence includes null, mixed, and calorie-confounded results.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-32986097
  - source_artifact:pmid-35443107
  - source_artifact:pmid-38639542
  - source_artifact:pmid-39973006
  - source_artifact:pmid-36930148
  - source_artifact:pmid-40298934
  - source_artifact:pmid-41692034
  caveats:
  - Some adjacent studies are positive, but comparator design, calorie intake, adherence, protein/diet quality, and body composition can drive or obscure effects.
- claimId: sleep-not-primary-benefit
  type: mixed_evidence
  text: A direct 6-hour TRF sleep analysis did not show a clear sleep-quality or sleep-duration advantage, so sleep should be monitored as a safety and quality signal rather than promised as a benefit.
  strength: low
  sourceKeys:
  - source_artifact:pmid-33759620
  caveats:
  - Sleep evidence was a secondary self-reported analysis in adults with obesity and was not powered for rare sleep-related adverse events.
- claimId: graded-ramp-is-murph-scaffold
  type: design_guardrail
  text: The 12:12 to 14:10 to 16:8 to 18:6 ramp and the 4-target-day minimum analyzable exposure are Murph operational and analysis scaffolds, not evidence-derived optimal doses.
  strength: high
  sourceKeys:
  - source_artifact:pmid-39614235
  - source_artifact:pmid-26411343
  - source_artifact:pmid-35934114
  - source_artifact:pmid-37242218
  - source_artifact:pmid-40117066
  caveats:
  - Implementation sources support adherence and barrier tracking, but no extracted trial validates this exact ramp as superior.
- claimId: clinical-and-safety-boundaries
  type: safety
  text: Safety gating should take priority over efficacy interpretation for people with diabetes or hypoglycemia-relevant medications, pregnancy or breastfeeding, eating-disorder vulnerability, current underweight or unexplained weight loss, youth, frailty, athlete low-energy-availability risk, CKD, gallbladder-risk symptoms, active treatment, or clinician-directed meal timing.
  strength: high
  sourceKeys:
  - source_artifact:pmid-31003482
  - source_artifact:pmid-15451892
  - source_artifact:ncbi-bookshelf-diabetes-management-ramadan-2022-03-04
  - source_artifact:pmid-39785103
  - source_artifact:pmid-28654225
  - source_artifact:pmid-19025239
  - source_artifact:pmid-37752011
  - source_artifact:pmid-17127188
  - source_artifact:pmid-38987755
  caveats:
  - These are boundary sources, not evidence that 18:6 is safe or effective in those groups.
- claimId: observational-cvd-signal-is-noncausal
  type: association_not_causation
  text: Observational cardiovascular-mortality signals for short eating duration should be treated as noncausal context that blocks long-term safety and longevity overclaims, not as proof that a monitored short 18:6 experiment causes cardiovascular harm.
  strength: low
  sourceKeys:
  - source_artifact:pmid-40849219
  - source_artifact:heart-org-time-restricted-eating-cvd-death-2024-03-18
  caveats:
  - The sources are observational or preliminary public-report context with residual-confounding concerns, not completed intervention trials.
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
  - pregnancy_or_trying_to_conceive
  - breastfeeding
  - adolescent
  - older_frail_adult
  - clinically_underweight
  - unexplained_or_unintended_weight_loss
  - active_or_recent_eating_disorder
  - purging_or_binge_restrict_cycling
  - obsessive_food_preoccupation
  - diabetes
  - recurrent_hypoglycemia
  - insulin_or_sulfonylurea_use
  - glp1_plus_restricted_intake
  - ckd_dialysis_or_transplant
  - electrolyte_or_fluid_restriction
  - active_medical_treatment_or_surgery
  - clinician_directed_meal_timing
  - athlete_low_energy_or_red_s_risk
  - high_training_load_with_underfueling
  - gallbladder_disease_history
  - right_upper_quadrant_abdominal_pain
  - rapid_weight_loss_risk
  stopIf:
  - Hypoglycemia symptoms, measured low glucose, dizziness, fainting, near-fainting, or unsafe weakness.
  - Binge-restrict cycling, purging, obsessive food preoccupation, or clinically meaningful mood worsening.
  - Sleep disruption, repeated headaches, training underfueling, recovery deterioration, or inability to eat enough calories or protein.
  - Unexplained or rapid weight loss, acute illness, dehydration, new pregnancy, medication changes requiring food, or clinician advice to stop.
  - Severe abdominal pain or gallbladder-risk symptoms.
  notes:
  - Safety-screened self-experiment for stable adults only — not ordinary wellness for pregnancy, eating disorder, underweight, youth, frailty, or hypoglycemia-medication contexts.
  - 'Log confounders: calories, protein, meal timing, caffeine/alcohol, training, sleep, meds, cycle, and weight change.'
  - RHR and HRV are optional personal context — not evidence-backed TRE safety biomarkers here.
  - Water is the evidence-safe fasting default — other zero-cal beverage rules are product-policy choices.
researchLandscape:
  bottomLine: The direct 6-hour evidence base is relevant but small, short-term, and selected-population. Adjacent-window, calorie-confounding, behavioral, clinical, safety-only, mechanistic, observational, registry, and protocol-only sources should remain separate evidence groups so the page does not convert context into direct 18:6 proof.
  confidenceLabel: limited
  primaryClaim: 18:6 TRE with graded starter windows is best framed as a safety-screened personal experiment for medically stable adults, testing weight, glucose, blood pressure, waist, hunger, energy, and tolerability while logging adherence as interpretation context.
  mainCaveat: Many sources are adjacent variants or safety/context records. Effects may depend on total energy intake, protein/fiber, diet quality, adherence, body composition, timing, clinical population, and medication status.
  groups:
  - id: direct-18-6-six-hour-intervention-evidence
    label: Direct and near-direct six-hour evidence
    stance: mixed
    summary: Direct 6-hour studies are relevant for this 18:6 target, but they are short-term and include selected, supervised, young-adult, overweight, obesity, or prediabetes populations. They support possible short-term weight or selected metabolic signals while also preserving sleep-null and mechanistic boundaries.
    defaultOpen: true
    sourceKeys:
    - source_artifact:pmid-32673591
    - source_artifact:pmid-29754952
    - source_artifact:pmid-36034217
    - source_artifact:pmid-33759620
    - source_artifact:pmid-31151228
    - source_artifact:pmid-31339000
    - source_artifact:pmid-36241590
    - source_artifact:pmid-41010536
  - id: graded-window-implementation-context
    label: Starter-window and implementation context
    stance: context_only
    summary: Starter windows, adherence tracking, and real-world barriers are implementation context. The 12:12 to 14:10 to 16:8 to 18:6 ramp and the 4-target-day analysis threshold are Murph operational scaffolds, not evidence-derived optimal dosing.
    sourceKeys:
    - source_artifact:pmid-32480126
    - source_artifact:pmid-35820237
    - source_artifact:pmid-26411343
    - source_artifact:pmid-39614235
    - source_artifact:doi-10.1093-cdn-nzab039_002
    - source_artifact:pmid-34201442
    - source_artifact:pmid-36712501
    - source_artifact:pmid-37242218
  - id: adjacent-null-mixed-calorie-confounding
    label: Adjacent null, mixed, and calorie-confounding evidence
    stance: mixed
    summary: Adjacent 8-hour, 16:8, calorie-restricted, isocaloric, NAFLD, synthesis, and calorie-confounding sources prevent overclaiming. They support expectation-setting that TRE may not outperform calorie restriction, usual timing, or calorie-controlled comparators.
    sourceKeys:
    - source_artifact:pmid-32986097
    - source_artifact:pmid-35443107
    - source_artifact:pmid-35939311
    - source_artifact:pmid-38639542
    - source_artifact:pmid-39973006
    - source_artifact:pmid-36930148
    - source_artifact:pmid-38357669
    - source_artifact:pmid-40298934
    - source_artifact:pmid-41692034
  - id: behavioral-tolerability-and-off-ramps
    label: Behavioral tolerability and off-ramps
    stance: safety_boundary
    summary: Qualitative, appetite, and behavioral sources support tracking hunger, social disruption, binge-restrict patterns, adherence burden, and reasons to step back to a wider eating window.
    sourceKeys:
    - source_artifact:pmid-35934114
    - source_artifact:pmid-39894958
    - source_artifact:pmid-40318250
    - source_artifact:pmid-36610542
    - source_artifact:pmid-40117066
  - id: clinical-context-and-medication-boundaries
    label: Clinical context and medication boundaries
    stance: safety_boundary
    summary: Type 2 diabetes, metabolic syndrome, Ramadan diabetes guidance, and hypoglycemia sources are clinical-context and medication-safety boundaries. They should not be used as general consumer 18:6 efficacy or broad safety proof.
    sourceKeys:
    - source_artifact:pmid-37889487
    - source_artifact:pmid-39348690
    - source_artifact:pmid-31813824
    - source_artifact:pmid-31003482
    - source_artifact:pmid-15451892
    - source_artifact:ncbi-bookshelf-diabetes-management-ramadan-2022-03-04
  - id: special-population-safety-boundaries
    label: Special-population safety boundaries
    stance: safety_boundary
    summary: Pregnancy, eating-disorder vulnerability, youth, athlete low-energy availability, gallbladder-risk, and broad adverse-event sources support clinician-guidance or exclusion language rather than claims of safety in those groups.
    sourceKeys:
    - source_artifact:pmid-38987755
    - source_artifact:pmid-39785103
    - source_artifact:pmid-28654225
    - source_artifact:pmid-19025239
    - source_artifact:pmid-37752011
    - source_artifact:pmid-17127188
  - id: observational-and-protocol-only-context
    label: Observational and protocol-only context
    stance: context_only
    summary: Protocol-only, registry, and observational cardiovascular sources are context. They should be used to avoid long-term safety or longevity overclaims and not as causal evidence for or against a monitored short self-experiment.
    sourceKeys:
    - source_artifact:pmid-41818195
    - source_artifact:pmid-40849219
    - source_artifact:heart-org-time-restricted-eating-cvd-death-2024-03-18
---
# Intermittent Fasting

Use a gradually narrowed eating window to test whether a consistent 18-hour fast and 6-hour eating window produces a personal signal in weight, glucose, blood pressure, waist, hunger, or energy without worsening sleep, symptoms, recovery, or safety.

## What this protocol is

This is a safety-screened self-experiment for medically stable adults. Direct efficacy claims are limited to extracted 6-hour eating-window studies, which are short-term and mostly selected-population evidence. Graded starter windows are Murph implementation scaffolding. Adjacent 8-hour, 10-hour, 16:8, calorie-restricted, clinical-population, mechanistic, observational, registry, protocol-only, and safety-only sources are context and must stay labeled as context.

## How to run it

1. **Baseline for 14 days.** Log normal first-calorie and last-calorie times, weight trend, hunger, energy, mood, symptoms, sleep, training, medication changes, and any calorie or protein estimates before narrowing the window.
2. **Choose the target window.** Pick the earliest realistic 6-hour window you can repeat most target days, and record actual first-calorie and last-calorie times. Early 6-hour windows have the clearest timing-specific metabolic rationale in small or selected studies, while later 6-hour windows may still affect weight and are not proven ineffective.
3. **Ramp gradually.** Ramp as Murph implementation scaffolding: 12:12 for 4 days, 14:10 for 4 days, 16:8 for 6 days, then target 18:6. No extracted trial validates this exact ramp as superior; stay at or return to the last tolerable tier if symptoms, binge-restrict patterns, sleep disruption, headache, repeated missed days, or major work/family/social disruption appear.
4. **Target phase.** Use the Murph operational target of 5-7 logged target-window days per week; the minimum analyzable exposure is 4 logged target-window days per week after the ramp. This is an analysis threshold, not an evidence-derived optimal dose.
5. **Keep the comparison clean.** Keep food quality, protein, fiber, training load, caffeine, alcohol, and sleep schedule as stable as possible. During the fasting interval, use water as the default; other zero-calorie beverage rules are product-policy choices unless explicitly verified.

## Why it might work

The protocol tests whether a narrower daily eating window changes eating opportunity, total intake, and clock-time exposure. Direct 6-hour studies support possible short-term weight or selected metabolic signals, but effects are not universal and may depend on energy intake, adherence, clinical population, and whether the window is early or later in the day.

Early 6-hour eating windows have the clearest direct timing-specific rationale for glucose, insulin, appetite, and blood-pressure signals; later 6-hour windows may still affect weight, but metabolic findings are more mixed.

## What not to expect

Do not expect 18:6 to reliably outperform calorie restriction or usual timing, to improve sleep, to raise energy expenditure, or to work independently of total intake, protein/fiber, diet quality, adherence, and body-composition context. Adjacent trials and syntheses include null, mixed, and calorie-confounded findings.

RHR and HRV may be logged as optional personal context only. They are not evidence-backed safety biomarkers for this protocol in the landed source set.

## Safety posture

Safety gating should take priority over efficacy interpretation. People with diabetes or glucose-lowering medication, pregnancy or breastfeeding, current underweight, unexplained weight loss, eating-disorder history, adolescent status, athlete low-energy-availability risk, CKD/frailty, gallbladder-risk symptoms, or clinician-directed meal timing should not start self-directed 18:6 without clinician guidance. These are boundary sources, not evidence that 18:6 is safe or effective in those groups.

Stop or step down for hypoglycemia symptoms, dizziness or syncope, binge/restrict cycling, sleep disruption, training underfueling, clinically meaningful mood worsening, repeated headaches, inability to eat enough calories or protein, rapid or unexplained weight loss, dehydration, severe abdominal pain, gallbladder-risk symptoms, or medication changes that require food.

Log confounders: calories, protein, meal timing, caffeine/alcohol, training load, sleep, medications, menstrual cycle where relevant, and weight change.

## Evidence map

The research landscape keeps direct evidence, starter-window implementation, adjacent null and mixed evidence, behavioral off-ramps, clinical medication boundaries, special-population safety boundaries, and observational/protocol-only context separate. The appraisal records in `packages/health-commons/content/evidence-appraisals/time-restricted-eating/time-restricted-eating-18-6.jsonl` use the same group IDs as the protocol research landscape.
