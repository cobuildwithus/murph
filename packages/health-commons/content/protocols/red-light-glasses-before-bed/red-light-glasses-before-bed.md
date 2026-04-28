---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:red-light-glasses-before-bed/red-light-glasses-before-bed
slug: protocols/red-light-glasses-before-bed/red-light-glasses-before-bed
title: Red-Light Glasses Before Bed
summary: "Wear high-filtering amber, red, or brown glasses before bed to reduce evening light exposure and see whether you feel less wired or fall asleep more easily."
status: draft
quality: usable
aliases:
  - red light glasses before bed
  - amber glasses before bed
  - blue-blocking glasses before bed
  - blue light blocking glasses for sleep
  - evening red glasses sleep experiment
categories:
  - sleep
  - circadian
  - evening-light
  - wearable-measured
  - murph-canonical
relations:
  -
    type: parent_family
    target: experiment_family:evening-light-reduction
  -
    type: primary_biomarker
    target: biomarker:sleep-onset-latency
  -
    type: secondary_biomarker
    target: biomarker:sleep-efficiency
  -
    type: secondary_biomarker
    target: biomarker:deep-sleep-minutes
  -
    type: secondary_biomarker
    target: biomarker:hrv-rmssd
  -
    type: secondary_biomarker
    target: biomarker:resting-heart-rate
  -
    type: cites
    target: source_artifact:red-light-glasses-before-bed-bibliography
  -
    type: cites
    target: source_artifact:pmid-16842544
  -
    type: cites
    target: source_artifact:pmid-26730983
  -
    type: cites
    target: source_artifact:pmid-31752544
  -
    type: cites
    target: source_artifact:pmid-25287985
  -
    type: cites
    target: source_artifact:pmid-30410784
  -
    type: cites
    target: source_artifact:pmid-32658494
  -
    type: cites
    target: source_artifact:pmid-21193540
  -
    type: cites
    target: source_artifact:pmid-25535358
  -
    type: cites
    target: source_artifact:pmid-32168244
  -
    type: cites
    target: source_artifact:pmid-36854795
  -
    type: cites
    target: source_artifact:pmid-28488943
  -
    type: cites
    target: source_artifact:pmid-32276301
  -
    type: cites
    target: source_artifact:pmid-31967375
  -
    type: cites
    target: source_artifact:pmid-39642162
  -
    type: cites
    target: source_artifact:pmid-35268469
  -
    type: cites
    target: source_artifact:doi-10.1111-opo.12406
  -
    type: cites
    target: source_artifact:pmid-28045969
  -
    type: cites
    target: source_artifact:pmid-31504080
  -
    type: cites
    target: source_artifact:pmid-34030534
  -
    type: cites
    target: source_artifact:pmid-41341515
  -
    type: cites
    target: source_artifact:pmid-40728371
  -
    type: cites
    target: source_artifact:pmid-37192881
  -
    type: cites
    target: source_artifact:pmid-37593770
  -
    type: cites
    target: source_artifact:pmid-35298459
  -
    type: cites
    target: source_artifact:doi-10.17617-1.4a6s-ec74
  -
    type: cites
    target: source_artifact:pmid-29101797
  -
    type: cites
    target: source_artifact:pmid-20030543
  -
    type: cites
    target: source_artifact:pmid-33707105
  -
    type: cites
    target: source_artifact:pmid-30427265
  -
    type: cites
    target: source_artifact:pmid-35089982
  -
    type: cites
    target: source_artifact:pmid-35024497
  -
    type: cites
    target: source_artifact:pmid-29991437
  -
    type: cites
    target: source_artifact:pmid-33587901
  -
    type: cites
    target: source_artifact:pmid-36051910
  -
    type: cites
    target: source_artifact:pmid-41166315
  -
    type: cites
    target: source_artifact:pmid-41565717
  -
    type: cites
    target: source_artifact:pmid-27322730
  -
    type: cites
    target: source_artifact:pmid-15713707
  -
    type: cites
    target: source_artifact:pmid-27226262
  -
    type: cites
    target: source_artifact:pmid-26414986
  -
    type: cites
    target: source_artifact:pmid-41421618
lineage:
  relationship: root
  rationale: Default evening-eyewear experiment designed to be easy to try and easy to stop if it does not help.
attribution:
  ownerType: murph
protocol:
  doseSignature: Nightly · 90–120 min before intended bedtime · high-filtering amber/red/brown glasses · 14-night intervention after 7-day baseline
  target: high-filtering amber, red, or brown evening glasses
  frequency:
    sessionsPerWeek: 7
  durationMinutes:
    min: 90
    max: 120
  interventionSessionsMinimum: 10
  interventionSessionsTarget: 12
  steps:
    - Choose high-filtering amber, red, or brown glasses that fit closely enough to limit light leakage.
    - Put the glasses on 90–120 minutes before intended bedtime.
    - Wear them indoors only during the pre-bed window, then remove them before sleep.
    - Remove the glasses before driving, cycling, cooking with visual hazards, navigating stairs or unfamiliar low-light spaces, or doing color-critical work.
    - Log wear time, bedtime target, actual bedtime, screens, room light, caffeine or alcohol, stress, and any symptoms.
  tips:
    - Lens color alone is not proof of useful filtering; product spectral data is better when available.
    - Keep room lighting, screen brightness, bedtime target, caffeine, alcohol, exercise timing, sleep supplements, and melatonin as stable as practical.
    - Do not add a new screen curfew, sleep supplement, bedtime, light-therapy device, or major room-light redesign during this test.
    - Do not wear strong filtering lenses during the day; daytime light is a different signal.
  keepInMind:
    - Direct human evidence for evening blue-blocking glasses is small and mixed, especially for objective actigraphy or wearable sleep outcomes.
    - The clearest personal signal may be feeling less wired or falling asleep more easily, not a dramatic sleep-stage change.
    - Mood-disorder, delayed-sleep-phase, pregnancy, pediatric, shift-work, and clinical lighting protocols are separate clinician-guided variants.
  logFields:
    - glasses on time
    - intended bedtime
    - actual bedtime
    - screen use
    - room-light brightness
    - caffeine timing
    - alcohol
    - mood or symptoms
  stopConditions:
    - Stop the night’s session if the glasses cause headache, dizziness, nausea, eye discomfort, unsafe low-light navigation, or clumsiness.
    - End the experiment if mood becomes unusually elevated, unusually low, agitated, or unstable.
    - End the experiment if sleep feels meaningfully worse for three consecutive nights and no obvious outside cause explains it.
    - End the experiment if the protocol creates anxiety, fixation, or friction that outweighs any benefit.
testPlans:
  -
    planId: sol-proxy-21d
    durationDays: 21
    baselineDays: 7
    interventionDays: 14
    primaryBiomarkerKey: biomarker:sleep-onset-latency
    secondaryBiomarkerKeys:
      - biomarker:sleep-efficiency
      - biomarker:deep-sleep-minutes
      - biomarker:hrv-rmssd
      - biomarker:resting-heart-rate
    minimumAdherenceSessions: 10
    targetAdherenceSessions: 12
    notes:
      - Use a wearable sleep-onset estimate when available, but pair it with a one-tap subjective estimate because consumer wearables and actigraphy can misclassify quiet wakefulness.
      - Compare intervention-window averages against the user’s own 7-day baseline rather than highlighting single-night changes.
      - Treat HRV, resting heart rate, sleep stages, and total sleep time as exploratory unless the personal signal is repeated and not obviously confounded.
      - The primary practical question is whether evenings feel less wired and sleep onset appears earlier, not whether every sleep metric improves.
expectedSignalDescriptions:
  -
    biomarkerKey: biomarker:sleep-onset-latency
    description: High-filtering evening glasses may reduce the blue-green light signal that keeps the brain alert. If that signal drops, sleep onset can feel easier.
  -
    biomarkerKey: biomarker:sleep-efficiency
    description: If evening light reduction lowers alertness and shortens the restless start of the night, more time in bed may be spent asleep.
  -
    biomarkerKey: biomarker:deep-sleep-minutes
    description: Deep sleep is downstream. It might shift only if the glasses improve body-clock timing or sleep continuity enough to affect early-night sleep.
  -
    biomarkerKey: biomarker:hrv-rmssd
    description: A better evening downshift and steadier sleep may reduce overnight strain. HRV could rise or stabilize, but it is not the main mechanism.
  -
    biomarkerKey: biomarker:resting-heart-rate
    description: If the glasses reduce pre-bed alerting and improve sleep, overnight resting pulse may drift lower as a secondary recovery signal.
experimentOnboarding:
  schemaVersion: murph.commons.experiment-onboarding.v1
  startIntent:
    displayPrompt: "Hey Murph, I want to explore wearing red-light glasses before bed."
    intentSummary: "Explore Red-Light Glasses Before Bed"
  contextReview:
    vaultChecks:
      -
        id: active_experiments
        label: Active experiments
        reason: Avoid stacking another meaningful experiment on top of an active one unless the user explicitly chooses weaker attribution.
        readHints:
          - experiment list --status active
      -
        id: wearable_sleep_baseline
        label: Wearable sleep baseline
        reason: Check whether sleep-onset, sleep-efficiency, HRV, or resting-heart-rate trends are available during the baseline and intervention windows.
        freshnessDays: 14
        readHints:
          - wearables sources list
          - wearables day
      -
        id: sleep_schedule_and_evening_context
        label: Sleep schedule and evening light context
        reason: Understand usual bedtime, screen use, room-light habits, and whether the user already has a stable evening routine that makes this experiment measurable.
        freshnessDays: 30
        readHints:
          - memory show
          - search query "bedtime evening light screens sleep schedule room light"
          - journal show
      -
        id: eye_mood_and_medication_context
        label: Eye, mood, and medication context
        reason: Screen for eye or light sensitivity, mood or circadian-risk context, pregnancy or postpartum context, melatonin or timed-light therapy, and other reasons Murph should not frame this as a simple unsupervised self-experiment.
        freshnessDays: 90
        readHints:
          - memory show
          - search query "migraine photosensitivity eye surgery eye disease bipolar mania insomnia delayed sleep phase shift work melatonin light therapy pregnancy postpartum medication"
    notes:
      - Prefer recent wearable sleep data when it exists, but explain that the experiment can still run with subjective sleep-onset notes when wearables are missing or noisy.
      - Do not re-ask stable context the vault already answers unless it changes safety, logistics, measurement fidelity, or user consent.
  safetyScreen:
    cautionLevel: moderate
    mode: ask_compact_then_expand_if_positive
    dispositionIfAnyPositive: clinician_guidance_before_unsupervised_start
    mustAsk:
      -
        id: eye_or_light_sensitivity
        prompt: eye disease, recent eye surgery, migraine or photosensitivity, epilepsy triggered by visual stimuli, or a history of tinted-lens discomfort
      -
        id: mood_or_sleep_phase_risk
        prompt: bipolar disorder, recent mania or hypomania, severe insomnia, delayed sleep phase, shift-work sleep disruption, or another reason changing evening light exposure could destabilize sleep or mood
      -
        id: safety_critical_evening_tasks
        prompt: needing to drive, cycle, cook with visual hazards, use stairs or tools, or do color-critical evening work while the glasses are on
    stopIf:
      inheritFromProtocolSafety: true
    notes:
      - A positive or uncertain screen is not a diagnosis. It means Murph should not set this up as an unsupervised bedtime experiment without a lower-burden alternative or clinician guidance.
  setupSlots:
    -
      id: glasses_available
      label: Glasses available
      purpose: logistics
      valueType: boolean
      askPolicy: ask_if_unknown
      required: true
      question: Do you already have amber, red, or brown blue-light-filtering glasses you can wear before bed?
      target:
        object: onboardingCapture
        field: answers.glassesAvailable
    -
      id: lens_filter_confidence
      label: Lens filter confidence
      purpose: measurement_fidelity
      valueType: enum
      askPolicy: ask_if_unknown
      required: true
      question: How confident are you that the lenses strongly filter blue and green light: published specs, visibly dark amber or red, or unsure?
      options:
        - published_specs
        - visibly_dark
        - unsure
      target:
        object: experimentRun
        field: lensFilterConfidence
    -
      id: wear_window
      label: Wear window before bed
      purpose: logistics
      valueType: enum
      askPolicy: ask_if_unknown
      required: true
      question: Can you realistically wear them for the last 90 to 120 minutes before bed on experiment nights?
      options:
        - ninety_minutes
        - one_hundred_twenty_minutes
        - shorter_or_inconsistent
      constraints:
        targetMinutes: 90
        preferredMinutes: 120
      target:
        object: experimentRun
        field: wearWindow
    -
      id: bedtime_anchor
      label: Bedtime anchor
      purpose: logistics
      valueType: local_time
      askPolicy: ask_if_unknown_or_stale
      required: true
      question: What bedtime should Murph anchor the glasses reminder to?
      target:
        object: experimentRun
        field: bedtimeAnchor
    -
      id: evening_light_stability
      label: Evening light stability
      purpose: confounder_control
      valueType: enum
      askPolicy: ask_if_unknown
      required: false
      question: Should we keep your current evening screen and room-light habits stable rather than changing them during the same test?
      options:
        - keep_existing_habits_stable
        - also_reduce_screens_or_room_light
      target:
        object: experimentRun
        field: eveningLightPolicy
    -
      id: reminder_policy
      label: Reminder policy
      purpose: assistant_support
      valueType: reminder_policy
      askPolicy: ask_at_confirmation
      required: true
      question: Do you want a reminder before the wear window, and if nothing is logged by the next morning should Murph ask once or leave it alone?
      options:
        - none
        - pre_window
        - pre_window_plus_next_morning_missing_log_check
      target:
        object: assistantSupport
        field: reminderPolicy
  planDefaults:
    testPlanId: sol-proxy-21d
    baselineDays: 7
    interventionDays: 14
    sessionsPerWeek: 7
    targetSessions: 12
    minimumUsefulSessions: 10
    firstSessionGuidance: Keep the first night simple. Wear the glasses during the usual pre-bed routine and do not add another new sleep intervention at the same time.
  logging:
    sessionFields:
      - glasses_on_time
      - glasses_off_time
      - intended_bedtime
      - actual_bedtime
      - estimated_time_to_fall_asleep_minutes
      - felt_less_wired_before_bed
      - headache_or_visual_discomfort
      - mood_change
    confounders:
      - screen_use_last_2h
      - room_light_brightness_last_2h
      - caffeine_after_noon
      - alcohol_last_24h
      - hard_training_last_24h
      - late_exercise
      - travel_or_timezone_shift
      - illness_or_fever
      - unusual_stress
      - new_supplement_or_medication_change
  assistantPolicy:
    maxSetupQuestionsPerTurn: 2
    askBeforeCreatingAutomations: true
    missedLogFollowup: opt_in_only
    reminderOptions:
      - none
      - pre_window
      - pre_window_plus_next_morning_missing_log_check
    missedLogFollowupCopy: "Did you end up wearing the glasses before bed last night? Totally fine either way, I just want the experiment record to be accurate."
    confirmationPrompt: Show the safety outcome, bedtime anchor, wear-window target, lens-confidence choice, logging expectations, stop conditions, and reminder policy before creating the active experiment or any automations.
whyItWorks:
  - The mechanism starts in the retina. Short-wavelength, melanopic evening light activates melanopsin-containing retinal ganglion cells that signal the brain’s circadian clock, which can suppress or delay melatonin and keep the body in a more daytime-like alerting state.
  - High-filtering amber, red, or brown glasses try to lower that melanopic signal during the last 90–120 minutes before bed. If the signal is reduced enough, the theory is that circadian night can unfold more normally: melatonin rises, alerting eases, core temperature trends downward, and sleep onset feels less effortful.
  - The glasses only work mechanistically if they materially reduce light reaching the retina. Spectral filtering, lens darkness, wraparound fit, edge leakage, screen brightness, and room-light intensity all change the actual melanopic dose, which is why lens color by itself is not enough information.
  - Any HRV, resting-heart-rate, deep-sleep, or sleep-efficiency change is downstream of that circadian and arousal shift. The cleanest first signal is usually less pre-bed wiredness or a shorter sleep-onset window; broader wearable changes would be a secondary ripple, not the primary mechanism.
claims:
  -
    claimId: evening-melanopic-light-reduction-is-plausible
    type: mechanistic
    text: Reducing evening melanopic or short-wavelength light is a plausible way to reduce pre-bed alerting and protect circadian timing, but glasses are only one implementation of that broader light-management idea.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-35298459
      - source_artifact:doi-10.17617-1.4a6s-ec74
      - source_artifact:pmid-36051910
      - source_artifact:pmid-16842544
      - source_artifact:pmid-21193540
      - source_artifact:pmid-36854795
    caveats:
      - Plausible mechanism is not the same as reliable wearable improvement.
      - Ambient room light and screen brightness may matter as much as the glasses.
  -
    claimId: direct-glasses-evidence-is-small-and-mixed
    type: mixed_evidence
    text: Human intervention evidence for evening blue-blocking glasses is small and mixed; recent adult actigraphy synthesis did not find statistically significant pooled improvements in sleep onset latency, total sleep time, sleep efficiency, or wake after sleep onset.
    strength: high
    sourceKeys:
      - source_artifact:pmid-41341515
      - source_artifact:pmid-37192881
      - source_artifact:pmid-34030534
      - source_artifact:pmid-37593770
      - source_artifact:pmid-33707105
      - source_artifact:pmid-26730983
      - source_artifact:pmid-31752544
      - source_artifact:pmid-30427265
    caveats:
      - Some individual studies report subjective sleep benefits.
      - Lack of statistically significant pooled actigraphy effects does not rule out personal benefit in a specific user.
  -
    claimId: two-hour-evening-window-is-a-practical-first-test
    type: design_guardrail
    text: A 90–120 minute pre-bed window is a practical first test because it matches the most directly relevant small trials better than all-evening or overnight protocols.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-29101797
      - source_artifact:pmid-20030543
      - source_artifact:pmid-33707105
      - source_artifact:pmid-26730983
      - source_artifact:pmid-31752544
      - source_artifact:pmid-40728371
      - source_artifact:pmid-35298459
    caveats:
      - The evidence does not establish one exact best timing window.
      - Longer evening use may increase burden without clearly improving objective signal.
  -
    claimId: subjective-sleep-onset-may-move-before-wearables
    type: intervention_result
    text: If the protocol works for a user, the clearest early signal is likely shorter perceived sleep onset or less pre-bed wiredness; wearable sleep-stage and HRV changes are exploratory.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-29101797
      - source_artifact:pmid-20030543
      - source_artifact:pmid-33707105
      - source_artifact:pmid-26730983
      - source_artifact:pmid-31752544
      - source_artifact:pmid-30410784
      - source_artifact:pmid-41341515
    caveats:
      - Subjective benefit can reflect expectation, routine stability, or reduced screen use.
      - Actigraphy and consumer wearables may miss quiet wakefulness.
  -
    claimId: product-spectral-quality-matters
    type: design_guardrail
    text: Lens color and marketing language are not enough; product spectral filtering, fit, leakage, ambient light, and screen brightness can change whether the intervention actually reduces melanopic input.
    strength: high
    sourceKeys:
      - source_artifact:pmid-40728371
      - source_artifact:pmid-35298459
      - source_artifact:pmid-16842544
      - source_artifact:pmid-32168244
      - source_artifact:pmid-36854795
      - source_artifact:pmid-41565717
      - source_artifact:pmid-28045969
    caveats:
      - Focus on lens quality and fit rather than recommending a specific brand.
      - Weak clear blue-light lenses should not be treated as equivalent to high-filtering evening lenses.
  -
    claimId: adjacent-clinical-variants-should-not-be-merged
    type: design_guardrail
    text: Delayed sleep phase disorder, pregnancy, pediatric use, shift work, bipolar or mania virtual-darkness protocols, and psychiatric ward lighting are adjacent variants, not evidence that a general adult bedtime-glasses experiment will work.
    strength: high
    sourceKeys:
      - source_artifact:pmid-35089982
      - source_artifact:pmid-35024497
      - source_artifact:pmid-41421618
      - source_artifact:pmid-25287985
      - source_artifact:pmid-41166315
      - source_artifact:pmid-27322730
      - source_artifact:pmid-15713707
      - source_artifact:pmid-27226262
      - source_artifact:pmid-31967375
      - source_artifact:pmid-32276301
      - source_artifact:pmid-28488943
      - source_artifact:pmid-39642162
      - source_artifact:pmid-35268469
    caveats:
      - Those populations may need different timing, supervision, signals, and safety framing.
      - Mood-disorder and circadian-disorder protocols should be clinician-guided.
  -
    claimId: eye-strain-and-eye-protection-claims-are-not-this-protocol
    type: design_guardrail
    text: This protocol should not claim eye-strain relief, retinal protection, or macular-health benefit from blue-light glasses.
    strength: high
    sourceKeys:
      - source_artifact:pmid-37593770
      - source_artifact:doi-10.1111-opo.12406
      - source_artifact:pmid-33587901
    caveats:
      - Users with persistent eye symptoms should consider an eye exam rather than using this protocol as eye care.
  -
    claimId: daytime-light-is-not-the-enemy
    type: design_guardrail
    text: This experiment should not encourage all-day blue-light avoidance; the intervention is specifically about lowering evening melanopic exposure while preserving healthy daytime light exposure.
    strength: high
    sourceKeys:
      - source_artifact:pmid-35298459
      - source_artifact:doi-10.17617-1.4a6s-ec74
      - source_artifact:pmid-36051910
    caveats:
      - Morning and daytime light can be beneficial for circadian stability.
      - Daytime use of strong filtering lenses is a different intervention.
researchLandscape:
  bottomLine: "Best read as a low-burden evening-light self-experiment, not a sleep treatment: the circadian mechanism is real enough to test, but direct glasses trials are small, mixed, and weakest on objective wearable outcomes."
  confidenceLabel: "mixed"
  primaryClaim: "High-filtering amber, red, or brown glasses may help some users feel less wired or fall asleep more easily when their last two pre-bed hours include bright rooms, screens, or cool-white light."
  mainCaveat: "The best objective adult synthesis found no statistically significant pooled actigraphy improvements, so the page should promise only a personal test of sleep onset and pre-bed wiredness—not insomnia treatment, eye-strain relief, retinal protection, or sleep-stage gains."
  groups:
    -
      id: "direct-adult-sleep-evidence"
      label: "Direct adult sleep evidence"
      stance: "mixed"
      summary: "Read this bucket as the actual bedtime-glasses evidence. It has a few small positive trials in people with insomnia symptoms, poor sleep, device use, or athletic evening routines, but the newest objective actigraphy meta-analysis found no statistically significant pooled gains in sleep onset, total sleep time, sleep efficiency, or wake after sleep onset. Plain-language takeaway: it is reasonable to test whether your own evenings feel less wired, but a wearable sleep-stage improvement is a maybe, not an expectation."
      sourceKeys:
        - "source_artifact:pmid-20030543"
        - "source_artifact:pmid-26730983"
        - "source_artifact:pmid-29101797"
        - "source_artifact:pmid-30410784"
        - "source_artifact:pmid-30427265"
        - "source_artifact:pmid-31752544"
        - "source_artifact:pmid-32658494"
        - "source_artifact:pmid-33707105"
        - "source_artifact:pmid-34030534"
        - "source_artifact:pmid-37192881"
        - "source_artifact:pmid-37593770"
        - "source_artifact:pmid-41341515"
      defaultOpen: true
    -
      id: "mechanism-dose-and-implementation"
      label: "Mechanism and dose fidelity"
      stance: "supports"
      summary: "This bucket explains why the test is plausible and why implementation can make or break it. Melanopic evening light from lamps and displays can affect melatonin and alertness, but glasses only reduce that signal if the lenses actually filter enough short-wavelength light and fit well enough to limit leakage. Plain-language takeaway: red or amber color is not enough; room brightness, screen brightness, wraparound fit, and not wearing strong filters during the day all matter."
      sourceKeys:
        - "source_artifact:doi-10.17617-1.4a6s-ec74"
        - "source_artifact:pmid-16842544"
        - "source_artifact:pmid-21193540"
        - "source_artifact:pmid-25535358"
        - "source_artifact:pmid-28045969"
        - "source_artifact:pmid-31504080"
        - "source_artifact:pmid-32168244"
        - "source_artifact:pmid-35298459"
        - "source_artifact:pmid-36051910"
        - "source_artifact:pmid-36854795"
        - "source_artifact:pmid-40728371"
        - "source_artifact:pmid-41565717"
    -
      id: "measurement-and-claim-guardrails"
      label: "Measurement and claim guardrails"
      stance: "context_only"
      summary: "This bucket keeps the page honest about what the experiment can measure. Actigraphy and consumer wearables are useful trend proxies, but they can mistake quiet wakefulness for sleep, so pair them with a one-tap subjective sleep-onset and pre-bed-wiredness log. Eye-strain, headache, retinal-protection, and macular-health claims are outside this bedtime experiment."
      sourceKeys:
        - "source_artifact:doi-10.1111-opo.12406"
        - "source_artifact:pmid-29991437"
        - "source_artifact:pmid-33587901"
    -
      id: "adjacent-clinical-variants"
      label: "Adjacent clinical variants"
      stance: "safety_boundary"
      summary: "This bucket explains what not to generalize from. Delayed sleep phase, shift work, pregnancy, pediatrics, depression, bipolar/mania virtual-darkness protocols, and psychiatric-ward lighting all use related light-reduction ideas, but they involve different risks, timing, and supervision. Plain-language takeaway: those papers help set safety boundaries; they are not proof that ordinary bedtime glasses will work for a healthy adult."
      sourceKeys:
        - "source_artifact:pmid-15713707"
        - "source_artifact:pmid-25287985"
        - "source_artifact:pmid-26414986"
        - "source_artifact:pmid-27226262"
        - "source_artifact:pmid-27322730"
        - "source_artifact:pmid-28488943"
        - "source_artifact:pmid-31967375"
        - "source_artifact:pmid-32276301"
        - "source_artifact:pmid-35024497"
        - "source_artifact:pmid-35089982"
        - "source_artifact:pmid-35268469"
        - "source_artifact:pmid-39642162"
        - "source_artifact:pmid-41166315"
        - "source_artifact:pmid-41421618"
    -
      id: "glucose-circadian-context"
      label: "Glucose Circadian Context"
      stance: "context_only"
      summary: "Circadian disruption can adversely affect glucose metabolism, making sleep timing relevant context for glucose trends. The Glucose Circadian Context group currently links one appraisal-backed source with same mechanism scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-31915891"
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - bipolar_disorder_or_history_of_mania_or_hypomania
    - active_severe_depression_or_recent_mood_instability
    - delayed_sleep_phase_disorder_or_other_circadian_rhythm_sleep_wake_disorder
    - pregnancy
    - children_or_adolescents
    - shift_work_or_planned_overnight_wakefulness
    - current_timed_light_therapy
    - current_melatonin_timing_protocol
    - significant_fall_risk_or_low_light_navigation_risk
    - color_critical_work_or_safety_critical_evening_tasks
    - eye_disease_or_new_visual_symptoms
  stopIf:
    - headache
    - dizziness
    - nausea
    - eye_pain_or_visual_discomfort
    - unsafe_clumsiness_or_trip_risk
    - unusually_elevated_mood_or_agitation
    - unusually_low_mood
    - sleep_worsens_for_three_consecutive_nights
    - experiment_creates_tracking_anxiety_or_rumination
  notes:
    - This is a bounded wellness self-experiment, not treatment for insomnia, circadian rhythm disorder, depression, mania, or eye disease.
    - Do not combine with new melatonin, sleep supplements, light therapy, or a new screen curfew during the same test window.
    - Do not wear the glasses during driving, cycling, cooking with visual hazards, stair navigation if visibility is reduced, color-critical tasks, or unfamiliar low-light environments.
    - If evening light is already dim and screen use is already low, the expected signal may be small or absent.
lensSpec:
  preferred: Published spectral transmittance or melanopic daylight filtering density data; if available, prefer lenses that substantially reduce melanopic or short-wavelength input rather than weak clear office lenses.
  practicalFallback: Wraparound amber/red/brown glasses marketed for evening blue-light blocking, used only during the pre-bed window.
  avoidAsPrimaryIntervention: Clear office/computer lenses with weak blue-light filtering and no spectral data.
researchCoverage:
  bibliographyKey: source_artifact:red-light-glasses-before-bed-bibliography
  corpusStats:
    rawDiscoveryRecords: 42
    canonicalSourceRecords: 41
    sourcePageRecords: 41
    directAdultCrossoverRCTsInActigraphyMetaAnalysis: 3
    participantsInActigraphyMetaAnalysis: 49
    highestPriorityProtocolRecords: 24
    resolvedInventoryOnlyRecords: 28
    canonicalizedDuplicateDiscoveryKeys: 4
    directAdultStandaloneGlassesTrialsInResearchGroup: 7
    latestCorpusSourceYear: 2026
    auditCutoff: 2026-04-21
  shortlistBucketCounts:
    evidence-backbone: 13
    protocol-dose-and-design: 12
    wearable-or-testable-endpoints: 8
    safety-and-contraindications: 14
    adjacent-variants-to-split: 15
    context-only-rationale: 12
  backboneSourceKeys:
    - source_artifact:pmid-40728371
    - source_artifact:pmid-41341515
    - source_artifact:pmid-37192881
    - source_artifact:pmid-34030534
    - source_artifact:pmid-37593770
    - source_artifact:pmid-35298459
    - source_artifact:doi-10.17617-1.4a6s-ec74
    - source_artifact:pmid-16842544
    - source_artifact:pmid-21193540
    - source_artifact:pmid-36854795
    - source_artifact:pmid-29991437
    - source_artifact:pmid-26414986
  causalInterventionSourceKeys:
    - source_artifact:pmid-29101797
    - source_artifact:pmid-20030543
    - source_artifact:pmid-33707105
    - source_artifact:pmid-26730983
    - source_artifact:pmid-31752544
    - source_artifact:pmid-30427265
    - source_artifact:pmid-30410784
    - source_artifact:pmid-35089982
    - source_artifact:pmid-35024497
  safetySourceKeys:
    - source_artifact:pmid-37593770
    - source_artifact:doi-10.1111-opo.12406
    - source_artifact:pmid-33587901
    - source_artifact:pmid-27226262
    - source_artifact:pmid-31967375
    - source_artifact:pmid-32276301
    - source_artifact:pmid-41421618
nightlyLoggingFields:
  - glasses_worn
  - glasses_on_time
  - glasses_off_time
  - intended_bedtime
  - actual_bedtime
  - estimated_time_to_fall_asleep_minutes
  - felt_less_wired_before_bed
  - screen_use_last_2h
  - room_light_brightness_last_2h
  - caffeine_after_noon
  - alcohol_last_24h
  - hard_training_last_24h
  - late_exercise
  - travel_or_timezone_shift
  - illness_or_fever
  - unusual_stress
  - new_supplement_or_medication_change
  - headache_or_visual_discomfort
  - mood_change
confoundersToTrack:
  - major_bedtime_change
  - major_wake_time_change
  - alcohol_last_24h
  - caffeine_after_noon
  - hard_training_last_24h
  - late_exercise
  - illness_or_fever
  - travel_or_timezone_shift
  - unusual_stress
  - new_supplement_or_medication_change
  - melatonin_or_light_therapy_change
  - new_screen_curfew_or_room_lighting_change
  - partner_child_pet_sleep_disruption
---

## Question this experiment answers

After a stable baseline, does wearing high-filtering amber/red/brown glasses for the last **90–120 minutes before bed** make the evening feel less wired or sleep come more easily?

## Simple version

Run a 21-day experiment:

- **7 baseline days**
- **14 intervention nights**
- glasses on **90–120 minutes before intended bedtime**
- **12 target nights**, with **10 nights** as the minimum for a useful first read
- no daytime use
- no new melatonin, sleep supplements, screen curfew, bedtime target, or room-light redesign during the same test

Use the simplest version first. This is not “avoid blue light forever.” It is a short test of whether lowering evening melanopic light helps you wind down. The point is the **last part of the evening**, not daytime light avoidance.

## Why this version

The evidence points in two directions at once. Lowering evening melanopic light is biologically plausible, but direct glasses trials are small, mixed, and often stronger on subjective sleep than objective actigraphy or wearable-style outcomes.

That makes this a good low-burden experiment, not a promise. The practical question is whether your own evenings feel calmer and whether sleep onset looks easier often enough to repeat. Null results are expected for some people, especially when their evenings are already dim or their sleep is already stable.

## What counts as a signal

Primary signal:

- shorter subjective or wearable-estimated sleep-onset latency compared with your own 7-day baseline

Useful subjective check:

- “Did I feel less wired in the last hour before bed?”

Exploratory signals:

- sleep efficiency
- total sleep time
- deep-sleep minutes
- HRV RMSSD
- resting heart rate

Do not score the experiment on one impressive night. A useful signal should repeat on several adherent nights and should still make sense after checking the confounders below.

A result is interesting only when it repeats across multiple adherent nights and is not obviously explained by bedtime shifts, alcohol, caffeine, travel, illness, stress, hard training, or another routine change.

## Product and safety notes

Lens quality matters. A clear office lens with weak filtering is not the same intervention as high-filtering amber/red/brown evening eyewear. When spectral transmittance or melanopic daylight filtering density is available, prefer that over marketing labels. Wraparound fit matters too, because light leaking around the lens can reduce the practical dose.

Keep this separate from delayed sleep phase disorder, shift work, pregnancy, pediatric use, depression, bipolar/mania, inpatient psychiatric ward lighting, and screen-software variants. Those may use similar mechanisms but need different supervision, signals, and safety language.

## Off-ramp

At the end of 21 days, choose the plainest conclusion:

1. **Worth repeating** if sleep onset or pre-bed wiredness clearly improved with low burden.
2. **Probably noise** if only one or two nights moved or the signal was confounded.
3. **Not worth it** if the tint was annoying, unsafe, mood-disrupting, or made sleep worse.
