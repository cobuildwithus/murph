---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:evening-light-reduction/red-light-glasses-before-bed
slug: protocols/evening-light-reduction/red-light-glasses-before-bed
title: Red Light Glasses Before Bed
summary: Bedtime light-filtering glasses, where less blue-green light reaches the retina so the brain gets a weaker signal to stay alert and delay melatonin.
status: draft
quality: usable
sortRank: 30
aliases:
- red light glasses before bed
- amber glasses before bed
- orange glasses before bed
- blue-blocking glasses before bed
- blue light blocking glasses for sleep
- evening light filtering glasses
categories:
- sleep
- circadian
- evening-light
- wearable-measured
- murph-canonical
media:
- kind: image
  relativePath: design-assets/hero-red-light-glasses-before-bed.jpeg
  mediaType: image/jpeg
  caption: Red Light Glasses Before Bed
relations:
- type: parent_family
  target: experiment_family:evening-light-reduction
- type: primary_biomarker
  target: biomarker:sleep-onset-latency
- type: secondary_biomarker
  target: biomarker:sleep-efficiency
- type: secondary_biomarker
  target: biomarker:resting-heart-rate
- type: secondary_biomarker
  target: biomarker:hrv-rmssd
- type: secondary_biomarker
  target: biomarker:deep-sleep-minutes
lineage:
  relationship: root
  rationale: Murph canonical adult evening-light-reduction self-experiment; not a named external clinical protocol.
attribution:
  ownerType: murph
  note: Drafted from the 2026-04-27 Red Light Glasses Before Bed research restart package.
protocol:
  doseSignature: Nightly · 90–120 min before intended bedtime · high-filtering amber/red/orange glasses · 14-night intervention after 7-day baseline
  target: high-filtering amber, red, or orange evening glasses with spectral data when available
  frequency:
    sessionsPerWeek: 7
  durationMinutes:
    min: 90
    max: 120
  sessionShape:
    label: Evening window
    segments:
    - label: glasses on
      kind: stimulus
      durationMinutes: 120
    - label: bedtime
      kind: transition
      durationMinutes: 5
    ticks:
    - "−120 min"
    - bedtime
  interventionSessionsMinimum: 10
  interventionSessionsTarget: 12
  steps:
    - "Choose high-filtering amber, red, or orange glasses; prefer spectral, melanopic, alpha-opic, or mDFD data when available."
    - "Baseline 7 days: no glasses; keep bedtime, screens, room light, caffeine, alcohol, supplements, and exercise timing stable."
    - "On intervention nights, wear glasses 90–120 min before intended bedtime during usual indoor wind-down."
    - "Keep room lighting and screen habits stable unless testing broader light or screen reduction."
    - "Remove glasses before sleep and before driving, stairs, cooking, tools, low-light navigation, or color/contrast/motion-critical tasks."
    - "Next morning, log use, timing, sleep onset, wiredness/sleepiness, screen/room-light context, lens confidence, and symptoms."
  safetyNotes:
  - Remove the glasses before driving, cycling, cooking with visual hazards, using tools, navigating stairs or unfamiliar low-light spaces, or doing color-, contrast-, or motion-critical work. Cycling, cooking, tools, stairs, and falls were not directly tested; this is a conservative extrapolation from visual-performance and low-light evidence [source_artifact:pmid-35227699; source_artifact:pmid-31369054; source_artifact:pmid-32830377; source_artifact:pmid-34475483; source_artifact:pmid-18954312; source_artifact:pmid-12322929; source_artifact:pmid-4564949; source_artifact:pmid-31696535].
  - This is a bounded adult wellness self-experiment about filtering ocular evening light; it is not eye care, insomnia treatment, bipolar or depression treatment, delayed-sleep-phase treatment, pregnancy guidance, pediatric guidance, shift-work adaptation, or a photobiomodulation protocol [source_artifact:evening-light-reduction-pmid-37593770; source_artifact:evening-light-reduction-pmid-31752544; source_artifact:evening-light-reduction-pmid-27226262; source_artifact:evening-light-reduction-pmid-41421618; source_artifact:evening-light-reduction-pmid-35024497; source_artifact:evening-light-reduction-pmid-35089982; source_artifact:doi-10.1001-jamapediatrics.2026.0976; source_artifact:pmid-33588653].
  tips:
  - Before baseline, keep screens and room lights unchanged; do not pre-dim the environment early.
  - Choose dark amber/red wraparound glasses; write down brand, lens color, specs, and fit.
  - Schedule the wear window after driving, cooking, tools, stairs, and color-critical tasks are done.
  - Put glasses on 90–120 minutes before intended bedtime; wear during usual wind-down, not new screen curfew.
  - Do not add melatonin, sleep supplements, new bulbs, or bedtime shifts during the run.
  - Log glasses-on time, leaks/removals, pre-bed wiredness, sleep onset, and next-day sleepiness; ignore single-night sleep-stage swings.
  keepInMind:
  - Direct adult glasses evidence is small and mixed; the most practical first read is repeated subjective sleep-onset ease plus pre-bed wiredness or sleepiness, not sleep-stage improvement [source_artifact:evening-light-reduction-pmid-26730983; source_artifact:evening-light-reduction-pmid-29101797; source_artifact:pmid-33707105; source_artifact:evening-light-reduction-pmid-41341515].
  - A wearable sleep-onset estimate is useful context, but pair it with a subjective estimate because quiet wakefulness can be misclassified [source_artifact:evening-light-reduction-pmid-12749556; source_artifact:evening-light-reduction-pmid-29991437; source_artifact:evening-light-reduction-pmid-40300398].
  - If you also add a screen curfew, change room lights, start melatonin, or shift bedtime during the test, attribution becomes weaker [source_artifact:evening-light-reduction-pmid-30410784; source_artifact:evening-light-reduction-pmid-31752544; source_artifact:pmid-36508661].
  logFields:
  - glasses worn
  - glasses on time
  - glasses off time
  - intended bedtime
  - actual bedtime
  - wake time
  - estimated time to fall asleep
  - perceived ease of sleep onset
  - pre-bed wiredness or sleepiness rating
  - subjective sleep quality
  - lens model, spectral/transmittance/melanopic specs, lens color, and filter-confidence category
  - fit/leakage/coverage, wraparound versus ordinary frame, and whether glasses were removed during the wear window
  - screen use last 2 hours, device type, brightness, night mode/filter settings, content arousal, and any new screen curfew
  - room-light brightness last 2 hours, spectrum/warmth, dimmers, bulbs, lamp versus overhead use, and any room-light redesign
  - caffeine after noon
  - alcohol last 24 hours
  - hard training or late exercise
  - naps, late work, travel, time-zone shift, or unusual schedule change
  - illness, fever, or unusual stress
  - melatonin, timed light therapy, sleep supplements, sedatives, stimulants, antidepressants, psychiatric-medication changes, or other medication changes
  - driving, cycling, cooking hazards, tools, stairs, unfamiliar low-light navigation, color-critical work, near-falls, falls, bumping into objects, or removing glasses for safety
  - headache, migraine-like symptoms, photophobia, eye pain, visual discomfort, blurred or double vision, dizziness, nausea, malaise, anxiety, depressive mood, elevated/agitated mood, or mood instability
  - extra sleep-score checking, rumination, or spending more time in bed to improve scores
  sessionFieldIds:
  - glasses_worn
  - glasses_on_time
  - glasses_off_time
  - intended_bedtime
  - actual_bedtime
  - estimated_time_to_fall_asleep_minutes
  - pre_bed_wiredness_rating
  - subjective_sleep_quality
  - felt_less_wired_before_bed
  - headache_or_visual_discomfort
  - unsafe_low_light_navigation
  - mood_change
  - lens_model_or_specs
  - lens_color
  - lens_filter_confidence
  - fit_leakage_coverage
  - removed_glasses_during_wear_window
  - pre_bed_sleepiness_rating
  - perceived_ease_of_sleep_onset
  - visual_symptoms_blurred_or_double_vision
  - near_fall_fall_or_bumped_object
  - safety_critical_task_arose
  - anxiety_or_depressive_mood
  - elevated_or_agitated_mood
  stopConditions:
  - Remove the glasses immediately and stop that night’s session if any driving, cycling, cooking hazard, tool use, stair navigation, unfamiliar low-light navigation, or color-, contrast-, or motion-critical task arises while the glasses are on.
  - Stop immediately for new visual symptoms, blurred or double vision, migraine-like headache, photophobia, eye pain, or visual discomfort.
  - Stop immediately after a trip, near-fall, fall, bumping into objects, or any unsafe navigation while wearing the glasses.
  - Stop and reassess if anxiety, depressive mood, unusual agitation, unusually elevated mood, unusually low mood, or mood instability appears or worsens.
  - Stop sooner than three nights if sleep worsening is severe, creates next-day impairment, or makes driving, work, or ordinary tasks unsafe.
  - End the experiment if tracking creates anxiety, rumination, extra sleep-score checking, or friction that outweighs any benefit.
testPlans:
- planId: sol-wiredness-21d
  durationDays: 21
  baselineDays: 7
  interventionDays: 14
  primaryBiomarkerKey: biomarker:sleep-onset-latency
  secondaryBiomarkerKeys:
  - biomarker:sleep-efficiency
  - biomarker:resting-heart-rate
  - biomarker:hrv-rmssd
  - biomarker:deep-sleep-minutes
  minimumAdherenceSessions: 10
  targetAdherenceSessions: 12
  notes:
  - Compare the 14-night intervention window with the user’s own 7-night baseline rather than highlighting single-night changes.
  - Use sleep-onset latency and sleep efficiency as the main measurable read; subjective sleep-onset ease and pre-bed wiredness help interpret quiet-wakefulness errors.
  - Treat resting heart rate, HRV, and deep-sleep minutes as exploratory downstream checks because direct eyewear evidence does not establish them as primary effects.
  - Mark attribution as weak if the user also changes screen curfew, room-light setup, melatonin, supplements, bedtime, or timed light therapy during the same test.
expectedSignalDescriptions:
- biomarkerKey: biomarker:sleep-onset-latency
  description: "Filtering blue-green evening light weakens retinal alerting and melatonin suppression, letting the brain shift toward sleep sooner."
  expected: down_or_stable
  expectedDirection: down_or_stable
  estimatedChange:
    kind: absolute
    low: -10
    high: 0
    unit: min
    window: baseline vs 7-14 intervention nights
    confidence: mixed
    basis: Pooled actigraphy across three crossover RCTs estimated SOL MD -4.86 min with a wide CI crossing zero; a small adult device-use eyewear trial reported significantly better sleep latency, while healthy-adult evidence was null or subgroup-limited [source_artifact:evening-light-reduction-pmid-41341515; source_artifact:evening-light-reduction-pmid-26730983; source_artifact:pmid-33707105].
  protocolProminence: focus
- biomarkerKey: biomarker:sleep-efficiency
  description: "Earlier sleep onset reduces awake time in bed when time in bed stays stable."
  expected: up_or_stable
  expectedDirection: mixed_or_contextual
  estimatedChange:
    kind: absolute
    low: -1
    high: 2
    unit: "%"
    window: baseline vs 7-14 intervention nights
    confidence: mixed
    basis: A small adult device-use eyewear trial reported significantly better sleep efficiency; pooled actigraphy across three crossover RCTs estimated SE MD -0.61 percentage points with a wide CI crossing zero [source_artifact:evening-light-reduction-pmid-26730983; source_artifact:evening-light-reduction-pmid-41341515].
  protocolProminence: context
- biomarkerKey: biomarker:resting-heart-rate
  description: "Lower late circadian alerting reduces nighttime strain after sleep begins, lowering resting pulse."
  expected: down_or_stable
  expectedDirection: down_or_stable
  estimatedChange:
    kind: absolute
    low: -2
    high: 0
    unit: bpm
    window: baseline vs 7-14 intervention nights
    confidence: low
    basis: Low-confidence downstream estimate from sleep-onset, sleep-efficiency, and total-sleep-time signals; the direct eyewear trials and actigraphy meta-analysis did not measure resting heart rate [source_artifact:evening-light-reduction-pmid-26730983; source_artifact:evening-light-reduction-pmid-29101797; source_artifact:evening-light-reduction-pmid-41341515].
  protocolProminence: context
- biomarkerKey: biomarker:hrv-rmssd
  description: "Less late-light signaling reduces pre-bed alertness, supporting parasympathetic recovery during less fragmented sleep."
  expected: up_or_stable
  expectedDirection: up_or_stable
  estimatedChange:
    kind: relative_percent
    low: 0
    high: 5
    unit: "%"
    window: baseline vs 7-14 intervention nights
    confidence: low
    basis: Low-confidence downstream estimate from improved sleep continuity rather than direct eyewear HRV data; direct sources measured melatonin, sleep latency, sleep efficiency, insomnia ratings, total sleep time, and actigraphy outcomes, not RMSSD [source_artifact:evening-light-reduction-pmid-26730983; source_artifact:evening-light-reduction-pmid-29101797; source_artifact:evening-light-reduction-pmid-41341515].
  protocolProminence: context
- biomarkerKey: biomarker:deep-sleep-minutes
  description: "Reduced evening alerting improves sleep continuity first; deeper sleep changes follow only when fragmentation drops."
  expected: mixed_or_contextual
  expectedDirection: mixed_or_contextual
  estimatedChange:
    kind: mixed_or_contextual
    window: baseline vs 7-14 intervention nights
    confidence: low
    basis: Direct eyewear evidence centers on melatonin, sleep latency, sleep efficiency, insomnia ratings, and actigraphy total sleep time; it does not establish N3/deep-sleep effects, and consumer sleep-stage estimates are weaker than sleep/wake trends [source_artifact:evening-light-reduction-pmid-26730983; source_artifact:evening-light-reduction-pmid-29101797; source_artifact:evening-light-reduction-pmid-40300398].
  protocolProminence: context
- biomarkerKey: biomarker:rem-sleep-minutes
  description: "Evening light reduction may improve circadian timing and sleep opportunity; REM changes are most plausible when the final sleep cycles become less curtailed."
  expected: up_or_stable
  expectedDirection: up_or_stable
  estimatedChange:
    kind: mixed_or_contextual
    window: baseline vs 7-14 intervention nights
    confidence: low
    basis: Direct eyewear evidence centers on melatonin, sleep latency, sleep efficiency, insomnia ratings, and actigraphy total sleep time; it does not establish a reliable REM-minutes effect.
  protocolProminence: context
- biomarkerKey: biomarker:blood-oxygen-spo2
  description: "Evening light reduction may improve sleep timing or continuity, but it does not treat sleep apnea or hypoxemia; SpO2 should remain stable."
  expected: stable
  expectedDirection: stable
  estimatedChange:
    kind: mixed_or_contextual
    window: baseline vs 7-14 intervention nights
    confidence: low
    basis: SpO2 is a safety-context signal here; repeated overnight drops should not be interpreted as protocol success or failure without sleep-disordered-breathing context.
  protocolProminence: context
- biomarkerKey: biomarker:blood-glucose
  description: "Evening light reduction may improve sleep timing or circadian regularity, which can indirectly matter for glucose interpretation, but it is not a glucose intervention."
  expected: mixed_or_contextual
  expectedDirection: mixed_or_contextual
  estimatedChange:
    kind: mixed_or_contextual
    window: baseline vs 7-14 intervention nights
    confidence: low
    basis: The direct consumer eyewear evidence does not establish glucose lowering; use glucose only as context if sleep timing changes materially.
  protocolProminence: context
experimentOnboarding:
  schemaVersion: "murph.commons.experiment-onboarding.v2"
  startIntent:
    displayPrompt: "Hey Murph, I want to explore wearing red-light glasses before bed."
    intentSummary: "Explore Red Light Glasses Before Bed"
  safetyScreen:
    dispositionIfAnyPositive: "do_not_start_unsupervised"
    mustAsk:
      - id: "eye_or_light_sensitivity"
        prompt: "Do you have eye disease, recent eye surgery, new visual symptoms, migraine/photosensitivity, visually triggered seizures, or a history of tinted-lens discomfort?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "mood_or_sleep_phase_risk"
        prompt: "Do you have bipolar disorder, recent mania or hypomania, major depression, severe or unstable mood symptoms, delayed sleep phase, severe insomnia, or current timed light or melatonin therapy?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "pregnancy_pediatric_shift_or_clinical_variant"
        prompt: "Are you pregnant or postpartum, setting this up for a child or adolescent, working nights or rotating shifts, planning overnight wakefulness, or recovering in hospital/after major surgery or an acute neurologic or cardiac event?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "safety_critical_evening_tasks"
        prompt: "Would you need to drive, cycle, cook with visual hazards, use tools, navigate stairs or unfamiliar low-light spaces, or do color-, contrast-, or motion-critical work while the glasses would be on?"
        ifPositive: "do_not_start_unsupervised"
  setupSlots:
    - id: "glasses_available"
      label: "Glasses available"
      question: "Do you already have amber, red, or orange blue-light-filtering glasses you can wear before bed?"
      target:
        object: "onboardingCapture"
        field: "answers.glassesAvailable"
    - id: "lens_filter_confidence"
      label: "Lens filter confidence"
      question: "How confident are you that the lenses strongly filter blue-green or melanopic light: published specs, visibly dark amber or red, or unsure?"
      options:
        - "published_specs"
        - "visibly_dark"
        - "unsure"
      target:
        object: "experimentRun"
        field: "lensFilterConfidence"
    - id: "lens_model_or_specs"
      label: "Lens model or spectral specs"
      question: "Do you know the lens model, brand, or any spectral/melanopic filtering specs?"
      constraints:
        optional: true
      target:
        object: "experimentRun"
        field: "lensModelOrSpecs"
    - id: "wear_window"
      label: "Wear window before bed"
      question: "Can you realistically wear them for the last 90 to 120 minutes before bed on experiment nights?"
      options:
        - "ninety_minutes"
        - "one_hundred_twenty_minutes"
        - "shorter_or_inconsistent"
      constraints:
        targetMinutes: 90
        preferredMinutes: 120
      target:
        object: "experimentRun"
        field: "wearWindow"
    - id: "bedtime_anchor"
      label: "Bedtime anchor"
      question: "What bedtime should Murph anchor the glasses reminder to?"
      constraints:
        askWhen: "if_unknown_or_stale"
      target:
        object: "experimentRun"
        field: "bedtimeAnchor"
    - id: "evening_light_stability"
      label: "Evening light stability"
      question: "Should we keep your current evening screen and room-light habits stable so the glasses are the main change?"
      options:
        - "keep_existing_habits_stable"
        - "also_reduce_screens_or_room_light_weaker_attribution"
      constraints:
        optional: true
      target:
        object: "analysisPlan"
        field: "eveningLightAttributionPolicy"
    - id: "reminder_policy"
      label: "Reminder policy"
      question: "Do you want a reminder before the wear window, and if nothing is logged by the next morning should Murph ask once or leave it alone?"
      options:
        - "none"
        - "pre_window"
        - "pre_window_plus_next_morning_missing_log_check"
      constraints:
        askWhen: "at_confirmation"
      target:
        object: "assistantSupport"
        field: "reminderPolicy"
  planDefaults:
    testPlanId: "sol-wiredness-21d"
    firstSessionGuidance: "Keep the first night simple. Wear the glasses during the usual pre-bed routine and do not add another new sleep intervention at the same time."
  trackingHints:
    confounderFields:
      - "screen_use_last_2h"
      - "room_light_brightness_last_2h"
      - "caffeine_after_noon"
      - "alcohol_last_24h"
      - "hard_training_last_24h"
      - "late_exercise"
      - "travel_or_timezone_shift"
      - "illness_or_fever"
      - "unusual_stress"
      - "new_supplement_or_medication_change"
      - "melatonin_or_timed_light_change"
      - "screen_device_type"
      - "screen_brightness_last_2h"
      - "night_mode_or_screen_filter_settings"
      - "content_arousal_last_2h"
      - "new_screen_curfew_added"
      - "room_light_spectrum_or_warmth"
      - "dimmers_bulbs_lamps_vs_overhead"
      - "room_light_redesign_added"
      - "wake_time"
      - "naps"
      - "late_work_or_unusual_schedule_change"
      - "sleep_supplement_or_sedative_change"
      - "stimulant_or_antidepressant_or_psychiatric_medication_change"
      - "safety_task_or_navigation_event"
      - "extra_sleep_score_checking_or_rumination"
  supportHints:
    missedLogFollowupCopy: "Did you end up wearing the glasses before bed last night? Totally fine either way; I just want the experiment record to be accurate."
whyItWorks:
  - "## Blue-green light signals daytime\n\nEvening short-wavelength light hits melanopsin pathways and tells the clock to stay alert. Melatonin suppression is the signal glasses are trying to reduce."
  - "## Lens blocks retinal input\n\nAmber or red lenses work only when they meaningfully reduce melanopic light reaching the eye. Color alone is not dose; spectrum and fit matter."
  - "## Sleep onset changes when light was the driver\n\nThe glasses help when late light is keeping the system awake. If the room is already dim, screen arousal or stress may dominate instead."
mechanismChain:
  -
    label: "Session"
    content: "Amber/red glasses · 90–120 min pre-bed"
  -
    label: "Retinal signal"
    content: "Melanopic light falls; melatonin suppression drops"
  -
    label: "Repeated signal"
    content: "Evening clock input stays dim while routine continues"
  -
    label: "Adaptation"
    content: "Pre-bed alerting falls · sleep onset eases · efficiency improves secondarily"
claims:
- claimId: adult-prebed-filtering-glasses-scope
  type: evidence_scope
  text: This protocol is an adult nocturnal pre-bed wearable-eyewear experiment that attenuates short-wavelength or melanopic light reaching the eyes; it should not be broadened into all evening light-management behaviors, light-emitting red/near-infrared protocols, all-day blue-light avoidance, or disease treatment.
  strength: high
  sourceKeys:
  - source_artifact:evening-light-reduction-pmid-26730983
  - source_artifact:evening-light-reduction-pmid-29101797
  - source_artifact:evening-light-reduction-pmid-20030543
  - source_artifact:evening-light-reduction-pmid-30410784
  - source_artifact:evening-light-reduction-pmid-30427265
  - source_artifact:pmid-30890197
  - source_artifact:pmid-33707105
  - source_artifact:evening-light-reduction-pmid-41341515
  caveats:
  - Scope is not a benefit guarantee.
  - Direct adult trials are small and heterogeneous.
- claimId: direct-evidence-small-mixed-objective-uncertain
  type: mixed_evidence
  text: 'Direct adult bedtime-eyewear evidence is small and mixed: small trials report subjective sleep, insomnia-rating, melatonin, feasibility, or actigraphy total-sleep-time signals, while the extracted adult actigraphy synthesis found no statistically significant pooled improvements in sleep onset latency, total sleep time, sleep efficiency, or wake after sleep onset.'
  strength: moderate
  sourceKeys:
  - source_artifact:evening-light-reduction-pmid-26730983
  - source_artifact:evening-light-reduction-pmid-29101797
  - source_artifact:evening-light-reduction-pmid-20030543
  - source_artifact:evening-light-reduction-pmid-30410784
  - source_artifact:evening-light-reduction-pmid-30427265
  - source_artifact:pmid-30890197
  - source_artifact:pmid-33707105
  - source_artifact:evening-light-reduction-pmid-34030534
  - source_artifact:evening-light-reduction-pmid-41341515
  caveats:
  - Positive findings should be phrased as a reason to test personal response, not as insomnia treatment.
  - The pooled actigraphy base was small.
- claimId: healthy-adult-benefit-not-confirmed
  type: mixed_evidence
  text: Healthy adults with already-stable sleep may see little or no measurable benefit; the extracted healthy-adult crossover trial did not show an overall objective or subjective sleep-time or sleep-quality advantage.
  strength: low
  sourceKeys:
  - source_artifact:pmid-33707105
  caveats:
  - This does not prove that no individual healthy adult can benefit.
- claimId: lens-dose-fidelity-matters
  type: design_guardrail
  text: Lens color and marketing labels are not enough to define dose; published spectral transmittance, melanopic or alpha-opic measures, fit, leakage, screen brightness, and room-light level can change whether the glasses actually reduce evening retinal light input.
  strength: high
  sourceKeys:
  - source_artifact:evening-light-reduction-pmid-40728371
  - source_artifact:evening-light-reduction-doi-10.25039-s026.2018
  - source_artifact:evening-light-reduction-pmid-35298459
  - source_artifact:evening-light-reduction-pmid-16842544
  - source_artifact:evening-light-reduction-pmid-24287308
  - source_artifact:pmid-31441122
  - source_artifact:pmid-33779493
  - source_artifact:pmid-34983271
  - source_artifact:pmid-39259700
  - source_artifact:pmid-32864077
  - source_artifact:doi-10.21273-horttech05673-25
  - source_artifact:pmid-31696535
  caveats:
  - The extraction did not identify a validated numeric pass/fail threshold for this protocol.
- claimId: timing-window-practical-not-proven-optimal
  type: design_guardrail
  text: A 90–120 minute pre-bed wear window is a practical first-test anchor, but extracted protocols used multiple timing windows and no extracted source proves one optimal duration.
  strength: moderate
  sourceKeys:
  - source_artifact:evening-light-reduction-pmid-26730983
  - source_artifact:evening-light-reduction-pmid-29101797
  - source_artifact:evening-light-reduction-pmid-20030543
  - source_artifact:evening-light-reduction-pmid-30410784
  - source_artifact:evening-light-reduction-pmid-31752544
  - source_artifact:pmid-33707105
  - source_artifact:pmid-30890197
  - source_artifact:iovs-narrow-blue-blocker-eyewear-2026-04-27
  - source_artifact:evening-light-reduction-pmid-35298459
  - source_artifact:pmid-20463367
  - source_artifact:pmid-36508661
  caveats:
  - The 90-minute and longer-window sources include adjacent or co-intervention contexts.
- claimId: subjective-first-wearable-second
  type: design_guardrail
  text: The primary practical read should be subjective sleep-onset latency, perceived ease of sleep onset, and a pre-bed wiredness or sleepiness rating, paired with wearable trends when available, because subjective and objective sleep signals can diverge and wearable or actigraphy sleep onset can misclassify quiet wakefulness.
  strength: high
  sourceKeys:
  - source_artifact:evening-light-reduction-pmid-26730983
  - source_artifact:evening-light-reduction-pmid-20030543
  - source_artifact:evening-light-reduction-pmid-30427265
  - source_artifact:pmid-33707105
  - source_artifact:evening-light-reduction-pmid-41341515
  - source_artifact:pmid-19103508
  - source_artifact:pmid-31901524
  - source_artifact:evening-light-reduction-pmid-29991437
  caveats:
  - Subjective benefit can reflect expectation, routine stability, or reduced screen arousal.
- claimId: eye-health-claims-out-of-scope
  type: safety
  text: Bedtime red-light glasses should not be presented as eye-strain treatment, retinal protection, AMD prevention, macular-health support, or a substitute for eye care.
  strength: high
  sourceKeys:
  - source_artifact:evening-light-reduction-pmid-37593770
  - source_artifact:aao-digital-devices-eyes-2025-12-05
  - source_artifact:aop-visible-blue-light-2023-01-03
  - source_artifact:college-optometrists-blue-blocking-spectacle-lenses-position-2026-04-27
  - source_artifact:evening-light-reduction-pmid-33587901
  - source_artifact:pmid-29786830
  - source_artifact:pmid-30789642
  - source_artifact:pmid-36808601
  - source_artifact:pmid-41602785
  - source_artifact:pmid-32007978
  - source_artifact:pmid-35057697
  - source_artifact:pmid-33001489
  caveats:
  - Users with persistent eye symptoms should seek eye-care guidance rather than using this protocol as treatment.
- claimId: strong-filters-unsafe-for-visual-critical-tasks
  type: safety
  text: Strong filtering glasses should come off before driving, cycling, tools, cooking hazards, stairs or unfamiliar low-light navigation, and color-, contrast-, or motion-critical tasks because extracted visual-performance evidence supports caution around low-light visibility, color discrimination, blue-color contrast, motion perception, and night-driving detection.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-35227699
  - source_artifact:pmid-31369054
  - source_artifact:pmid-32830377
  - source_artifact:pmid-34475483
  - source_artifact:pmid-18954312
  - source_artifact:pmid-12322929
  - source_artifact:pmid-4564949
  - source_artifact:pmid-31696535
  - source_artifact:doi-10.21273-horttech05673-25
  caveats:
  - Cycling, cooking, tools, stairs, and household falls were not directly tested; this is extrapolated from visual-performance and low-light evidence.
- claimId: adjacent-clinical-variants-separated
  type: design_guardrail
  text: Delayed sleep phase, shift work or planned overnight wakefulness, pregnancy or postpartum use, pediatric or adolescent use, severe insomnia care, depression, bipolar or mania virtual-darkness protocols, psychiatric ward lighting, hospital recovery, and current timed melatonin or light therapy are adjacent variants or clinician-guided contexts, not evidence that the default adult bedtime-glasses experiment works.
  strength: high
  sourceKeys:
  - source_artifact:evening-light-reduction-pmid-31752544
  - source_artifact:evening-light-reduction-pmid-32658494
  - source_artifact:evening-light-reduction-pmid-35024497
  - source_artifact:evening-light-reduction-pmid-35089982
  - source_artifact:evening-light-reduction-pmid-15713707
  - source_artifact:evening-light-reduction-pmid-25287985
  - source_artifact:evening-light-reduction-pmid-27322730
  - source_artifact:evening-light-reduction-pmid-27226262
  - source_artifact:evening-light-reduction-pmid-31967375
  - source_artifact:evening-light-reduction-pmid-32276301
  - source_artifact:evening-light-reduction-pmid-35268469
  - source_artifact:evening-light-reduction-pmid-41421618
  - source_artifact:evening-light-reduction-pmid-26414986
  - source_artifact:pmid-33588653
  - source_artifact:pmid-19637050
  - source_artifact:pmid-23834705
  - source_artifact:doi-10.1001-jamapediatrics.2026.0976
  - source_artifact:evening-light-reduction-pmid-41166315
  - source_artifact:evening-light-reduction-pmid-39642162
  - source_artifact:evening-light-reduction-pmid-28488943
  - source_artifact:pmid-19329259
  - source_artifact:clinicaltrials-nct04578249-2026-04-27
  caveats:
  - These populations may need different timing, supervision, outcomes, and safety framing.
researchLandscape:
  bottomLine: "Best treated as a low-burden, safety-bounded evening-light self-experiment only after a negative safety screen and a visually safe, task-free wear window: the mechanism is plausible and some small trials show signals, but direct adult glasses evidence is small, mixed, and weakest for objective wearable outcomes."
  confidenceLabel: mixed
  primaryClaim: "High-filtering amber, red, or orange glasses are a reasonable mechanism-based test for some users whose pre-bed routine includes enough screen or room light to plausibly matter; this is not a direct subgroup finding for specific room-light or screen contexts."
  mainCaveat: "Do not promise insomnia treatment, objective wearable improvement, sleep-stage gains, eye-strain relief, retinal protection, or benefits in clinical/special populations."
  groups:
  - id: direct_adult_bedtime_eyewear_trials
    label: "Direct adult bedtime eyewear trials"
    stance: mixed
    summary: "Small direct trials justify a personal test of pre-bed wiredness, perceived sleep onset, subjective sleep quality, and sometimes actigraphy total sleep time; they do not justify promising broad objective wearable gains."
    sourceKeys:
    - source_artifact:evening-light-reduction-pmid-26730983
    - source_artifact:evening-light-reduction-pmid-29101797
    - source_artifact:evening-light-reduction-pmid-20030543
    - source_artifact:evening-light-reduction-pmid-30410784
    - source_artifact:evening-light-reduction-pmid-30427265
    - source_artifact:pmid-30890197
    - source_artifact:pmid-20030543
    - source_artifact:pmid-26730983
    - source_artifact:pmid-29101797
    - source_artifact:pmid-30410784
    - source_artifact:pmid-30427265
    - source_artifact:pmid-31752544
    - source_artifact:pmid-32658494
    defaultOpen: true
  - id: direct_eyewear_evidence_synthesis
    label: "Review-level eyewear sleep evidence"
    stance: mixed
    summary: "Review-level evidence sets cautious expectations: a broad review reported promising but heterogeneous sleep-onset evidence, an abstract-only meta-analysis was mixed, and the extracted adult actigraphy meta-analysis found no statistically significant pooled benefit for sleep onset latency, total sleep time, sleep efficiency, or WASO."
    sourceKeys:
    - source_artifact:evening-light-reduction-pmid-34030534
    - source_artifact:evening-light-reduction-pmid-41341515
    - source_artifact:doi-10.1093-sleep-zsaa056.170
    - source_artifact:pmid-34030534
    - source_artifact:pmid-37192881
    - source_artifact:pmid-41341515
    defaultOpen: true
  - id: healthy_adult_mixed_null_trials
    label: "Healthy-adult null or mixed boundary"
    stance: does_not_confirm
    summary: "The healthy-adult crossover trial did not find overall objective or subjective sleep-time or sleep-quality improvement, so null results are expected for some stable sleepers; low evening light is a mechanism-based reason to expect a smaller signal, not a directly extracted subgroup result."
    sourceKeys:
    - source_artifact:pmid-33707105
    defaultOpen: false
  - id: lens_dose_and_implementation_guardrails
    label: "Lens dose and implementation guardrails"
    stance: mixed
    summary: "Commercial lens performance varies; spectral filtering, melanopic/alpha-opic measures, fit, leakage, screens, and room light determine whether the intervention meaningfully lowers evening retinal light input."
    sourceKeys:
    - source_artifact:evening-light-reduction-pmid-40728371
    - source_artifact:evening-light-reduction-doi-10.25039-s026.2018
    - source_artifact:evening-light-reduction-pmid-35298459
    - source_artifact:evening-light-reduction-pmid-16842544
    - source_artifact:evening-light-reduction-pmid-24287308
    - source_artifact:pmid-31441122
    - source_artifact:pmid-33779493
    - source_artifact:pmid-34983271
    - source_artifact:pmid-39259700
    - source_artifact:pmid-32864077
    - source_artifact:doi-10.21273-horttech05673-25
    - source_artifact:doi-10.1177-1477153515584979
    - source_artifact:evening-light-reduction-pmid-15713707
    - source_artifact:pmid-20463367
    - source_artifact:pmid-28656675
    - source_artifact:pmid-36412580
    - source_artifact:pmid-36508661
    - source_artifact:doi-10.17617-1.4a6s-ec74
    - source_artifact:pmid-16842544
    - source_artifact:pmid-21193540
    - source_artifact:pmid-25535358
    - source_artifact:pmid-28045969
    - source_artifact:pmid-31504080
    - source_artifact:pmid-32168244
    - source_artifact:pmid-35298459
    - source_artifact:pmid-36051910
    - source_artifact:pmid-36854795
    - source_artifact:pmid-40728371
    - source_artifact:pmid-41565717
    defaultOpen: true
  - id: measurement-and-claim-guardrails
    label: "Measurement and wearable guardrails"
    stance: context_only
    summary: "Actigraphy and consumer wearables are useful for repeated within-person trends, but wake detection, scoring rules, algorithms, and sleep-stage estimates are imperfect; pair device data with subjective sleep-onset and pre-bed-wiredness logs."
    sourceKeys:
    - source_artifact:evening-light-reduction-pmid-12749556
    - source_artifact:pmid-12749557
    - source_artifact:evening-light-reduction-pmid-14655927
    - source_artifact:evening-light-reduction-pmid-17969470
    - source_artifact:pmid-19103508
    - source_artifact:evening-light-reduction-pmid-24179309
    - source_artifact:evening-light-reduction-pmid-29991437
    - source_artifact:pmid-31901524
    - source_artifact:evening-light-reduction-pmid-32053169
    - source_artifact:evening-light-reduction-pmid-33378539
    - source_artifact:evening-light-reduction-pmid-38149978
    - source_artifact:evening-light-reduction-pmid-40300398
    - source_artifact:pmid-40303381
    - source_artifact:pmid-1455130
    - source_artifact:evening-light-reduction-pmid-17520797
    - source_artifact:evening-light-reduction-pmid-19544753
    - source_artifact:evening-light-reduction-pmid-21237680
    - source_artifact:evening-light-reduction-pmid-21447050
    - source_artifact:evening-light-reduction-pmid-21652563
    - source_artifact:evening-light-reduction-pmid-25845697
    - source_artifact:pmid-28323455
    - source_artifact:evening-light-reduction-pmid-29235907
    - source_artifact:evening-light-reduction-pmid-29734997
    - source_artifact:evening-light-reduction-pmid-29991438
    - source_artifact:evening-light-reduction-pmid-30472879
    - source_artifact:evening-light-reduction-pmid-30789439
    - source_artifact:pmid-30941838
    - source_artifact:evening-light-reduction-pmid-31154154
    - source_artifact:evening-light-reduction-pmid-31621129
    - source_artifact:evening-light-reduction-pmid-31778122
    - source_artifact:evening-light-reduction-pmid-32882005
    - source_artifact:evening-light-reduction-pmid-36256631
    - source_artifact:evening-light-reduction-pmid-37917155
    - source_artifact:evening-light-reduction-pmid-38557808
    - source_artifact:evening-light-reduction-pmid-39460013
    - source_artifact:pmid-41768372
    - source_artifact:pmid-7939118
    - source_artifact:pmid-25687438
    - source_artifact:pmid-31538605
    - source_artifact:doi-10.1111-opo.12406
    - source_artifact:pmid-29991437
    - source_artifact:pmid-33587901
    defaultOpen: false
  - id: safety-visual-performance-eye-health-claim-boundaries
    label: "Safety, visual tasks, and eye-health claim boundaries"
    stance: safety_boundary
    summary: "Strong filtering or tinted lenses can create visibility or color-performance tradeoffs and should not be marketed here as eye-strain treatment, retinal protection, AMD prevention, macular-health support, night-driving aids, or a substitute for eye care."
    sourceKeys:
    - source_artifact:evening-light-reduction-pmid-37593770
    - source_artifact:aao-digital-devices-eyes-2025-12-05
    - source_artifact:aop-visible-blue-light-2023-01-03
    - source_artifact:college-optometrists-blue-blocking-spectacle-lenses-position-2026-04-27
    - source_artifact:pmid-35227699
    - source_artifact:pmid-31369054
    - source_artifact:pmid-32830377
    - source_artifact:pmid-34475483
    - source_artifact:pmid-18954312
    - source_artifact:pmid-12322929
    - source_artifact:pmid-4564949
    - source_artifact:evening-light-reduction-pmid-33587901
    - source_artifact:pmid-29786830
    - source_artifact:pmid-30789642
    - source_artifact:pmid-36808601
    - source_artifact:pmid-41602785
    - source_artifact:pmid-32007978
    - source_artifact:pmid-35057697
    - source_artifact:pmid-33001489
    - source_artifact:pmid-31696535
    - source_artifact:pmid-15302349
    - source_artifact:pmid-25838942
    - source_artifact:pmid-26900325
    - source_artifact:evening-light-reduction-pmid-27855740
    - source_artifact:evening-light-reduction-pmid-28045969
    - source_artifact:pmid-28118668
    - source_artifact:pmid-29044670
    - source_artifact:pmid-31635988
    - source_artifact:pmid-31824984
    - source_artifact:pmid-33181732
    - source_artifact:pmid-33734926
    - source_artifact:pmid-35809192
    - source_artifact:pmid-35911990
    - source_artifact:pmid-36042717
    - source_artifact:pmid-37991308
    - source_artifact:pmid-37593770
    defaultOpen: true
  - id: screen-room-light-and-device-context
    label: "Adjacent screen, room-light, and device context"
    stance: context_only
    summary: "Screen-use, room-light, and device-filter sources explain why the glasses signal can be confounded, but they stay separate from the eyewear protocol and do not turn this into a generic screen-curfew experiment."
    sourceKeys:
    - source_artifact:evening-light-reduction-pmid-20673649
    - source_artifact:evening-light-reduction-pmid-25193149
    - source_artifact:evening-light-reduction-pmid-27802500
    - source_artifact:pmid-29093040
    - source_artifact:evening-light-reduction-pmid-31260534
    - source_artifact:evening-light-reduction-pmid-32168244
    - source_artifact:evening-light-reduction-pmid-32658494
    - source_artifact:evening-light-reduction-pmid-38657359
    - source_artifact:evening-light-reduction-pmid-38806392
    - source_artifact:evening-light-reduction-pmid-38846535
    - source_artifact:pmid-32954412
    - source_artifact:evening-light-reduction-pmid-37812713
    - source_artifact:pmid-31915891
    defaultOpen: false
  - id: adolescent-pediatric-and-neurodevelopmental-context
    label: "Youth and neurodevelopmental variants"
    stance: context_only
    summary: "Child, adolescent, school, myopia, ADHD, and child-psychiatry evidence is useful for mechanism and boundary context, but it needs separate age- and condition-specific safety and outcomes framing."
    sourceKeys:
    - source_artifact:doi-10.59720-23-028
    - source_artifact:doi-10.1001-jamapediatrics.2026.0976
    - source_artifact:doi-10.2147-cpt.s37985
    - source_artifact:evening-light-reduction-pmid-24397302
    - source_artifact:evening-light-reduction-pmid-25287985
    - source_artifact:pmid-36064209
    - source_artifact:evening-light-reduction-pmid-41166315
    - source_artifact:pmid-33556454
    defaultOpen: false
  - id: clinical-circadian-and-insomnia-boundaries
    label: "Clinical circadian and insomnia boundaries"
    stance: mixed
    summary: "Delayed-sleep-phase, CBT-I adjunct, inpatient light-environment, registry, and other clinical sources should guide referral and variant separation rather than ordinary unsupervised bedtime-glasses claims."
    sourceKeys:
    - source_artifact:evening-light-reduction-pmid-26414986
    - source_artifact:evening-light-reduction-pmid-27322730
    - source_artifact:evening-light-reduction-pmid-31752544
    - source_artifact:evening-light-reduction-pmid-39642162
    - source_artifact:pmid-15713707
    - source_artifact:pmid-25287985
    - source_artifact:pmid-26414986
    - source_artifact:pmid-27226262
    - source_artifact:pmid-27322730
    - source_artifact:pmid-28488943
    - source_artifact:pmid-31967375
    - source_artifact:pmid-32276301
    - source_artifact:pmid-35024497
    - source_artifact:pmid-35089982
    - source_artifact:pmid-35268469
    - source_artifact:pmid-39642162
    - source_artifact:pmid-41166315
    - source_artifact:pmid-41421618
    defaultOpen: false
  - id: clinical_supervised_mood_dark_therapy
    label: "Mood and virtual-darkness clinical variants"
    stance: mixed
    summary: "Mood-disorder and virtual-darkness sources are clinical, supervised, inpatient, registry, case-report, or hypothesis-level contexts with mixed results; they set safety boundaries rather than consumer sleep claims."
    sourceKeys:
    - source_artifact:pmid-15654938
    - source_artifact:pmid-17637502
    - source_artifact:pmid-19329259
    - source_artifact:pmid-25264124
    - source_artifact:evening-light-reduction-pmid-27226262
    - source_artifact:evening-light-reduction-pmid-31967375
    - source_artifact:evening-light-reduction-pmid-32276301
    - source_artifact:evening-light-reduction-pmid-34030534
    - source_artifact:evening-light-reduction-pmid-35268469
    - source_artifact:evening-light-reduction-pmid-41421618
    - source_artifact:evening-light-reduction-pmid-28488943
    - source_artifact:pmid-38109922
    - source_artifact:pmid-33561902
    - source_artifact:pmid-40781930
    defaultOpen: false
  - id: shift_work_timing_variants
    label: "Shift-work timing variants"
    stance: context_only
    summary: "Shift-work eyewear sources use different timing goals and often combined light packages, so they should not be folded into the default pre-bed adult protocol."
    sourceKeys:
    - source_artifact:pmid-19637050
    - source_artifact:pmid-20599459
    - source_artifact:pmid-23834705
    - source_artifact:pmid-33588653
    - source_artifact:pmid-37429599
    - source_artifact:pmid-41353624
    - source_artifact:pmid-30700675
    defaultOpen: false
  - id: pregnancy_evening_eyewear_context
    label: "Pregnancy eyewear context"
    stance: mixed
    summary: "Pregnancy sources are special-population context with mixed sleep findings and transient side effects; pregnancy should stay outside the default unsupervised adult protocol."
    sourceKeys:
    - source_artifact:evening-light-reduction-pmid-35024497
    - source_artifact:evening-light-reduction-pmid-35089982
    defaultOpen: false
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
  - eye_disease_or_recent_eye_surgery
  - new_visual_symptoms
  - migraine_or_photosensitivity
  - visual_triggered_seizures
  - tinted_lens_intolerance
  - bipolar_or_unstable_mood
  - severe_insomnia
  - delayed_sleep_phase_disorder
  - pregnancy_or_postpartum
  - children_or_adolescents
  - shift_work_or_overnight_wakefulness
  - current_light_therapy_or_melatonin_protocol
  - significant_fall_risk
  - low_light_navigation_risk
  - safety_critical_evening_tasks
  - major_depression
  - hospital_recovery_or_acute_event
  - regular_evening_driving_or_cycling
  - evening_color_critical_work
  stopIf:
  - safety_critical_task_arises_while_glasses_are_on
  - new_visual_symptoms_blurred_double_vision_photophobia_eye_pain_or_visual_discomfort
  - migraine_like_headache
  - trip_near_fall_fall_bumping_objects_or_unsafe_navigation
  - dizziness_nausea_or_malaise
  - anxiety_depressive_mood_unusual_agitation_elevated_mood_low_mood_or_mood_instability
  - severe_sleep_worsening_next_day_impairment_or_unsafe_drowsiness
  - experiment_creates_tracking_anxiety_rumination_or_extra_sleep_score_checking
  notes:
  - Wellness experiment only — not treatment for insomnia, mood disorders, pregnancy, pediatric sleep, shift work, or eye disease.
  - Do not add melatonin, sleep supplements, light therapy, screen curfews, or room-light changes during the test unless attribution is intentionally weakened.
  - Remove glasses before driving, cycling, cooking hazards, tools, stairs, color/contrast/motion tasks, or unfamiliar low-light spaces.
  - Already-dim evenings or stable sleep may produce a small or null signal — that is expected, not failure.
  - Short-term use appears feasible but adverse-event data is limited — do not describe it as proven safe.
researchCoverage:
  auditCutoff: '2026-04-27'
  canonicalSourceRecords: 214
  extractedSourcePages: 161
  evidenceAppraisalRecords: 161
  excludedExtractionBatches:
  - batch-004 output was mismatched to dry-sauna/collagen in the provided snapshot
  - batch-005 output was unrelated to time-restricted eating and not usable for this target
  sourceIndexStatus: packages/health-commons/generated/source-index.json was absent from the snapshot
---
## Question this experiment answers

After a stable baseline, does wearing high-filtering amber, red, or orange glasses for the last 90–120 minutes before bed make the evening feel less wired/sleepier or sleep come more easily?

## Simple version

Run a 21-day experiment: 7 baseline nights, then 14 intervention nights with the glasses on 90–120 minutes before intended bedtime. A useful first read needs at least 10 adherent intervention nights, with 12 as the target.

Keep daytime light normal. Do not add new melatonin, sleep supplements, a screen curfew, a new bedtime target, a room-light redesign, or timed light therapy during the same test unless the run is intentionally marked as weaker attribution [source_artifact:evening-light-reduction-pmid-30410784; source_artifact:evening-light-reduction-pmid-31752544; source_artifact:pmid-36508661].

## Why this version

The mechanism is plausible: high-filtering evening lenses can reduce short-wavelength or melanopic retinal input, and that retinal input can matter for melatonin, alertness, and circadian timing [source_artifact:evening-light-reduction-pmid-16842544; source_artifact:evening-light-reduction-pmid-35298459; source_artifact:evening-light-reduction-pmid-40728371]. The direct adult glasses evidence is still small and mixed, and extracted adult actigraphy synthesis did not confirm reliable objective improvements in sleep onset latency, total sleep time, sleep efficiency, or wake after sleep onset [source_artifact:evening-light-reduction-pmid-26730983; source_artifact:evening-light-reduction-pmid-29101797; source_artifact:pmid-33707105; source_artifact:evening-light-reduction-pmid-41341515].

With a negative safety screen and a visually safe, task-free pre-bed wear window, that makes this a low-burden self-experiment rather than a treatment claim.

## What counts as a signal

Use wearable sleep-onset latency and sleep efficiency as the main measurable read, checked against perceived ease of sleep onset and pre-bed wiredness or sleepiness in the subjective log. The subjective log still matters because actigraphy and consumer sleep devices can misclassify quiet wakefulness and sleep stages [source_artifact:evening-light-reduction-pmid-12749556; source_artifact:evening-light-reduction-pmid-29991437; source_artifact:evening-light-reduction-pmid-40300398].

Resting heart rate, HRV, and deep-sleep minutes are exploratory only. Treat them as context after checking alcohol, caffeine, illness, training load, travel, stress, bedtime changes, and medication or supplement changes [source_artifact:evening-light-reduction-pmid-29991437; source_artifact:evening-light-reduction-pmid-40300398].

## Product and setup guardrails

Use high-filtering amber, red, or orange glasses rather than assuming any lens labeled "blue blocker" is equivalent. Product spectral transmittance, melanopic, alpha-opic, or mDFD data is better than color or marketing copy alone [source_artifact:evening-light-reduction-pmid-40728371; source_artifact:evening-light-reduction-doi-10.25039-s026.2018]. A closer or wraparound fit is preferable when practical because light can leak around frames [source_artifact:pmid-34983271; source_artifact:pmid-31696535].

If the only available dose information is that the lenses are visibly dark amber/red, mark lens-filter confidence as lower than published spectral or melanopic data. Visible darkness is a practical fallback for testing, not proof of dose and not a safety credential for low-light, motion-, contrast-, or color-critical tasks [source_artifact:evening-light-reduction-pmid-40728371; source_artifact:evening-light-reduction-doi-10.25039-s026.2018; source_artifact:pmid-34983271; source_artifact:pmid-31696535; source_artifact:pmid-32830377; source_artifact:pmid-34475483].

## Safety guardrails

Do not start the default unsupervised version if you have eye disease, recent eye surgery, new visual symptoms, migraine/photosensitivity, visually triggered seizures, tinted-lens intolerance, bipolar disorder, recent mania or hypomania, major depression, severe or unstable mood symptoms, delayed sleep phase, severe insomnia, pregnancy or postpartum mood context, child/adolescent use, shift work, planned overnight wakefulness, current timed melatonin or light therapy, major surgery/hospital recovery, acute neurologic or cardiac recovery, significant fall risk, or safety-critical evening tasks that cannot be moved outside the wear window. Those are clinician-guided or separate-protocol contexts, not ordinary wellness onboarding [source_artifact:evening-light-reduction-pmid-37593770; source_artifact:evening-light-reduction-pmid-27226262; source_artifact:evening-light-reduction-pmid-41421618; source_artifact:evening-light-reduction-pmid-28488943; source_artifact:evening-light-reduction-pmid-26414986; source_artifact:evening-light-reduction-pmid-27322730; source_artifact:evening-light-reduction-pmid-35024497; source_artifact:evening-light-reduction-pmid-35089982; source_artifact:doi-10.1001-jamapediatrics.2026.0976; source_artifact:pmid-33556454; source_artifact:pmid-19637050; source_artifact:pmid-33588653; source_artifact:clinicaltrials-nct04578249-2026-04-27].

Remove the glasses before driving, cycling, cooking with visual hazards, using tools, navigating unfamiliar low-light spaces, stairs when visibility is reduced, or doing color-, contrast-, or motion-critical work [source_artifact:pmid-35227699; source_artifact:pmid-31369054; source_artifact:pmid-32830377; source_artifact:pmid-34475483; source_artifact:pmid-18954312; source_artifact:pmid-12322929; source_artifact:pmid-4564949; source_artifact:pmid-31696535]. A need to do one of those tasks is not a “continue with caution” situation; choose a later task-free wear window, remove the glasses before the task, or skip that night’s session [source_artifact:pmid-31369054; source_artifact:pmid-32830377; source_artifact:pmid-34475483; source_artifact:pmid-35227699]. Do not use this page as eye care, retinal protection, AMD prevention, macular-health support, insomnia treatment, psychiatric treatment, pregnancy guidance, pediatric guidance, shift-work adaptation, or photobiomodulation protocol [source_artifact:evening-light-reduction-pmid-37593770; source_artifact:aao-digital-devices-eyes-2025-12-05; source_artifact:aop-visible-blue-light-2023-01-03; source_artifact:college-optometrists-blue-blocking-spectacle-lenses-position-2026-04-27; source_artifact:pmid-29786830; source_artifact:pmid-30789642; source_artifact:pmid-36808601; source_artifact:pmid-41602785; source_artifact:evening-light-reduction-pmid-27226262; source_artifact:evening-light-reduction-pmid-35024497; source_artifact:evening-light-reduction-pmid-35089982].

## Off-ramp

A repeat is reasonable if the user had at least 10 adherent nights and saw a consistent subjective signal without meaningful confounders. A null result is not a failure; it is expected for some healthy or stable sleepers, while already-dim evenings are a mechanism-based reason to expect a smaller signal rather than a directly extracted subgroup result [source_artifact:pmid-33707105; source_artifact:evening-light-reduction-pmid-41341515]. Stop the protocol when symptoms, mood changes, safety friction, or tracking anxiety outweigh the possible benefit.
