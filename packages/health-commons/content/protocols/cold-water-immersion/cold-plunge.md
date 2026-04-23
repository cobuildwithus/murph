---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:cold-water-immersion/cold-plunge
slug: protocols/cold-water-immersion/cold-plunge
title: Cold Plunge
summary: Use a short, controlled, head-out cold-water immersion to test whether later-same-day stress or mood improves enough to matter, while treating first-minute cold shock as the main safety problem.
status: field-testing
quality: usable
aliases:
  - cold plunge protocol
  - cold-water immersion protocol
  - ice bath protocol
  - cold tub experiment
  - head-out cold-water immersion
categories:
  - cold-exposure
  - recovery
  - stress
  - murph-canonical
relations:
  -
    type: parent_family
    target: experiment_family:cold-water-immersion
  -
    type: primary_biomarker
    target: biomarker:perceived-stress
  -
    type: secondary_biomarker
    target: biomarker:mood-affect
  -
    type: secondary_biomarker
    target: biomarker:resting-heart-rate
  -
    type: cites
    target: source_artifact:cold-water-immersion-bibliography
  -
    type: cites
    target: source_artifact:pmid-36829490
  -
    type: cites
    target: source_artifact:pmid-33910456
  -
    type: cites
    target: source_artifact:pmid-37866096
  -
    type: cites
    target: source_artifact:doi-10.1002-lim2.53
  -
    type: cites
    target: source_artifact:pmid-37711459
  -
    type: cites
    target: source_artifact:pmid-39879231
  -
    type: cites
    target: source_artifact:pmid-10751106
  -
    type: cites
    target: source_artifact:pmid-36150503
  -
    type: cites
    target: source_artifact:pmid-25275647
  -
    type: cites
    target: source_artifact:pmid-33820701
  -
    type: cites
    target: source_artifact:pmid-40408371
  -
    type: cites
    target: source_artifact:pmid-22752345
  -
    type: cites
    target: source_artifact:pmid-23377833
  -
    type: cites
    target: source_artifact:pmid-33870188
  -
    type: cites
    target: source_artifact:pmid-19074671
  -
    type: cites
    target: source_artifact:pmid-29801652
  -
    type: cites
    target: source_artifact:pmid-2691172
  -
    type: cites
    target: source_artifact:pmid-16714416
  -
    type: cites
    target: source_artifact:pmid-2010387
  -
    type: cites
    target: source_artifact:pmid-31178366
  -
    type: cites
    target: source_artifact:pmid-22547634
  -
    type: cites
    target: source_artifact:pmid-26794588
  -
    type: cites
    target: source_artifact:pmid-38211547
  -
    type: cites
    target: source_artifact:pmid-33276648
  -
    type: cites
    target: source_artifact:pmid-31702722
  -
    type: cites
    target: source_artifact:pmid-35157264
  -
    type: cites
    target: source_artifact:pmid-36527593
  -
    type: cites
    target: source_artifact:pmid-36744038
  -
    type: cites
    target: source_artifact:pmid-27398915
  -
    type: cites
    target: source_artifact:pmid-33146851
  -
    type: cites
    target: source_artifact:pmid-35068365
  -
    type: cites
    target: source_artifact:hubermanlab-cold-exposure-2022-05-01
  -
    type: cites
    target: source_artifact:pmid-37840386
  -
    type: cites
    target: source_artifact:pmid-15253480
  -
    type: cites
    target: source_artifact:pmid-12078959
  -
    type: cites
    target: source_artifact:pmid-10735978
  -
    type: cites
    target: source_artifact:pmid-37381680
  -
    type: cites
    target: source_artifact:pmid-27631616
  -
    type: cites
    target: source_artifact:pmid-38478473
lineage:
  relationship: root
  rationale: Murph root variant for deliberate controlled tub or plunge immersion. Post-exercise CWI, winter swimming, cold showering, cryotherapy, contrast therapy, and external named protocols remain separate evidence buckets.
attribution:
  ownerType: murph
  note: Canonical Murph protocol synthesized from the cold-water-immersion research package audited through 2026-04-22.
protocol:
  doseSignature: 3x/week · start 1–3 min, progress only toward 5 min if well tolerated · 10–15 °C head-out sessions · 14-day intervention after 7-day baseline
  target: controlled head-out tub or plunge immersion with easy exit and approximate water temperature known
  frequency:
    sessionsPerWeek: 3
  durationMinutes:
    min: 1
    max: 5
  temperatureC:
    min: 10
    max: 15
  interventionSessionsMinimum: 4
  interventionSessionsTarget: 6
  steps:
    - Set up a controlled plunge or tub where you can enter and exit easily, keep your head out of the water, know the approximate water temperature before you start, and use a setting where help is immediately available for early sessions if entry goes badly.
    - Begin with a conservative 1-to-3-minute session. Only extend toward 5 minutes on later sessions if the first minute stays controllable, exit remains easy, and you rewarm normally afterward without chest symptoms, faintness, confusion, or lingering breathing difficulty.
    - Enter calmly without intentional hyperventilation, breath-holding, or face immersion. Do not turn the plunge into a breathwork stack or a cold-endurance challenge. Exit early if breathing control, balance, or chest comfort are not clearly okay.
    - Warm back up gradually after the session, dry off, and log how quickly normal warmth and breathing return. Keep open-water swimming and face-immersion practice outside this protocol.
    - Log the session details and compare later-same-day stress or mood plus next-morning resting cardiovascular context against your own baseline rather than against an internet target.
  tips:
    - Keep time of day and session context as stable as practical so the signal is easier to read.
    - Treat stand-alone cold plunge and post-exercise cold plunge as different contexts even if you personally do both.
    - Colder or longer is not assumed to be better; the direct evidence base does not validate an extreme home target.
    - If you already use sauna, contrast therapy, or cold showers, either pause them or log them clearly so attribution stays honest.
  keepInMind:
    - The clearest direct healthy-adult signal is delayed stress or negative-affect improvement, not guaranteed immediate calm or a broad immune boost.
    - Most direct studies are small and healthy-adult, and the repeated-use cardiovascular signal comes from one tiny exploratory men-only trial.
    - HRV and sleep are still exploratory for a stand-alone plunge and should not outrank manual stress or mood ratings plus repeated resting heart rate checks and optional home blood-pressure context if you already track it consistently.
    - The first minute is a safety problem before it is a wellbeing protocol.
  logFields:
    - water temperature
    - duration
    - immersion depth
    - session number
    - first-minute controllability
    - acute symptoms
    - rewarming difficulty or time
    - protocol deviation face or head immersion
    - protocol deviation breath-holding or hyperventilation
    - needed help to exit
    - time of day
    - exercise proximity
    - workout type and intensity if post-exercise
    - same-day mood
    - same-day stress
    - next-morning resting heart rate
    - next-morning blood pressure if already tracked
    - days since last cold exposure
    - alcohol or illness context
  stopConditions:
    - Stop the session immediately for chest pain or pressure, palpitations, faintness, marked dizziness, confusion, collapse, new neurologic symptoms, or breathing you cannot control.
    - After exit, if chest symptoms, breathing difficulty, confusion, collapse, or failure to rewarm are not resolving promptly, seek urgent medical evaluation rather than treating that as adaptation.
    - End the experiment if you cannot enter or exit safely or if symptoms repeatedly outweigh any possible benefit.
testPlans:
  -
    planId: cold-plunge-21d
    durationDays: 21
    baselineDays: 7
    interventionDays: 14
    primaryBiomarkerKey: biomarker:perceived-stress
    secondaryBiomarkerKeys:
      - biomarker:mood-affect
      - biomarker:resting-heart-rate
    minimumAdherenceSessions: 4
    targetAdherenceSessions: 6
    notes:
      - Use the 7-day baseline to learn your normal same-day stress and mood pattern plus resting heart rate and, if you already measure it consistently, home morning blood pressure as optional context.
      - During the 14-day intervention, favor three planned sessions per week instead of daily exposure so the experiment stays conservative and easy to interpret.
      - Manual same-day stress and mood ratings are the main user-facing outcomes. Resting heart rate is the clearest repeated-use context measure; if you already track home morning blood pressure consistently, keep it as optional context rather than a promised endpoint.
      - Treat HRV, sleep, soreness, and recovery metrics as exploratory notes unless you are intentionally running a separate post-exercise variant.
experimentOnboarding:
  schemaVersion: murph.commons.experiment-onboarding.v1
  startIntent:
    displayPrompt: Hey Murph, I want to explore a cold plunge experiment.
    intentSummary: Explore Cold Plunge
  contextReview:
    vaultChecks:
      -
        id: active_experiments
        label: Active experiments
        reason: Avoid stacking another meaningful experiment on top of an active one unless the user explicitly accepts weaker attribution.
        readHints:
          - experiment list --status active
      -
        id: cardiovascular_and_fainting_history
        label: Cardiovascular or fainting history
        reason: Known cardiovascular disease, arrhythmia, fainting history, prior severe cold-entry reactions, or severe blood-pressure instability changes whether an unsupervised plunge is appropriate.
        freshnessDays: 30
        readHints:
          - memory show
          - search query "blood pressure arrhythmia fainting chest pain cold-water reaction history"
      -
        id: wearable_and_manual_baseline_data
        label: Baseline stress and resting cardiovascular context
        reason: The protocol is easier to interpret if recent baseline trend data or manual check-in habits already exist.
        freshnessDays: 14
        readHints:
          - wearables sources list
          - wearables day
          - journal show
      -
        id: exercise_schedule_and_timing_context
        label: Exercise timing context
        reason: Post-exercise CWI is an adjacent variant, so Murph should know whether the user plans stand-alone plunges or wants to stack them near workouts.
        freshnessDays: 14
        readHints:
          - calendar search
          - memory show
          - search query "exercise schedule training routine recovery"
    notes:
      - If the user is already doing regular winter swimming, cold showers, sauna-to-ice contrast, or breathwork-plus-cold, record that because attribution will be weaker unless the protocol is simplified.
  safetyScreen:
    cautionLevel: high
    mode: ask_compact_then_expand_if_positive
    dispositionIfAnyPositive: clinician_guidance_before_unsupervised_start
    mustAsk:
      -
        id: cardiovascular_red_flags
        prompt: Do you have known cardiovascular disease, uncontrolled blood pressure, a known arrhythmia, a recent fainting episode, or unexplained chest symptoms?
        ifPositive: clinician_guidance_before_unsupervised_start
        why: Cold-water entry can sharply raise cardiorespiratory strain and can plausibly provoke dangerous symptoms in higher-risk users.
      -
        id: prior_severe_cold_entry_reaction
        prompt: Have you previously had severe gasping, panic, near-fainting, palpitations, chest symptoms, or loss of breathing control when entering cold water, or do you have another condition that makes sudden cold-water entry feel medically risky?
        ifPositive: clinician_guidance_before_unsupervised_start
        why: Prior severe entry reactions or another condition that makes sudden cold-water entry feel medically risky suggest that even a short unsupervised plunge may be a poor fit.
      -
        id: safe_exit_and_rewarming
        prompt: Is there any reason you could not enter, exit, or rewarm safely and reliably for this experiment?
        ifPositive: clinician_guidance_before_unsupervised_start
        why: This protocol assumes a healthy adult who can exit quickly and rewarm safely.
      -
        id: open_water_or_breath_holding_plan
        prompt: Are you planning open-water exposure, face immersion, intentional hyperventilation, or breath-holding as part of this experiment?
        ifPositive: do_not_start_unsupervised
        why: Those plans are outside this protocol and materially increase risk.
    stopIf:
      inheritFromProtocolSafety: true
      additionalConditions:
        - stop_for_uncontrolled_hyperventilation
        - stop_for_palpitations_or_chest_symptoms
        - stop_if_safe_exit_is_not_reliable
    notes:
      - The goal is a bounded home plunge self-experiment, not a cold-tolerance challenge.
      - Positive screening answers are more important than any curiosity about whether the protocol might work.
  setupSlots:
    -
      id: cold_plunge_access
      label: Cold plunge access
      purpose: logistics
      valueType: enum
      askPolicy: ask_if_unknown
      required: true
      question: What setup do you have for a controlled plunge over the next 2 weeks?
      options:
        - home_tub_or_plunge
        - gym_or_spa_plunge
        - shared_or_unreliable_access
        - no_regular_access
      writePath: runPlan.coldPlungeAccess
    -
      id: thermometer_confidence
      label: Water-temperature confidence
      purpose: measurement_fidelity
      valueType: enum
      askPolicy: ask_if_unknown
      required: true
      question: Can you approximate water temperature well enough to stay in a conservative target band rather than guessing?
      options:
        - measured_each_session
        - usually_measured
        - rough_estimate_only
        - unknown
      writePath: runPlan.waterTemperatureMode
    -
      id: cold_experience_level
      label: Recent cold-exposure experience
      purpose: safety
      valueType: enum
      askPolicy: ask_if_unknown
      required: true
      question: What best describes your recent deliberate cold exposure experience?
      options:
        - none_recent
        - some_recent_and_tolerated
        - regular_but_mixed
        - regular_and_well_tolerated
      writePath: onboarding.answers.coldExperienceLevel
    -
      id: session_timing
      label: Session timing
      purpose: logistics
      valueType: weekly_time_windows
      askPolicy: ask_if_unknown
      required: true
      question: What 3 days or time windows could realistically work for planned plunge sessions?
      constraints:
        sessionsPerWeek: 3
        avoidBackToBackWhenPossible: true
      writePath: runPlan.schedule
    -
      id: exercise_pairing_policy
      label: Exercise pairing
      purpose: context
      valueType: enum
      askPolicy: ask_if_unknown
      required: true
      question: Should Murph treat these as stand-alone plunges, mostly post-exercise plunges, or a mix that needs careful labeling?
      options:
        - mostly_standalone
        - mostly_post_exercise
        - mixed_contexts
      writePath: runPlan.sessionContext
    -
      id: blood_pressure_tracking
      label: Morning blood pressure tracking
      purpose: measurement_fidelity
      valueType: enum
      askPolicy: ask_if_unknown_or_stale
      required: false
      question: Do you already have a home cuff and a consistent morning blood-pressure routine, or should blood pressure stay optional?
      options:
        - validated_home_cuff_available
        - cuff_available_but_inconsistent
        - no_home_cuff
      writePath: tracking.morningBloodPressureMode
    -
      id: reminder_policy
      label: Reminder policy
      purpose: assistant_support
      valueType: reminder_policy
      askPolicy: ask_at_confirmation
      required: true
      question: Would you like a reminder before planned plunge sessions, and should Murph ask once the next morning if nothing is logged?
      options:
        - none
        - pre_session
        - pre_session_plus_next_morning_check
      writePath: assistantSupport.reminderPolicy
  planDefaults:
    testPlanId: cold-plunge-21d
    baselineDays: 7
    interventionDays: 14
    sessionsPerWeek: 3
    targetSessions: 6
    minimumUsefulSessions: 4
    firstSessionGuidance: Keep the first plunge conservative: stay head-out, aim for 1 to 3 minutes, and exit early if breathing control, balance, or chest comfort are not clearly okay.
  logging:
    sessionFields:
      - session_date
      - session_start_time
      - water_temperature_c
      - duration_minutes
      - immersion_depth
      - session_number
      - first_minute_control
      - acute_symptoms
      - rewarming_difficulty_or_time
      - protocol_deviation_face_or_head_immersion
      - protocol_deviation_breath_holding_or_hyperventilation
      - needed_help_to_exit
      - same_day_mood
      - same_day_stress
      - next_morning_resting_heart_rate
      - next_morning_blood_pressure
      - exercise_proximity
    confounders:
      - days_since_last_cold_exposure
      - workout_type_and_intensity_if_post_exercise
      - alcohol_last_24h
      - illness_or_fever
      - travel_or_timezone_shift
      - major_caffeine_change
      - hard_training_last_24h
      - sleep_loss
      - medication_change
      - sauna_or_other_cold_exposure
    notes:
      - If the user chooses mostly post-exercise plunges, interpretation should shift toward a separate adjacent-variant read rather than the default stand-alone protocol claim set.
  assistantPolicy:
    maxSetupQuestionsPerTurn: 2
    askBeforeCreatingAutomations: true
    missedLogFollowup: opt_in_only
    reminderOptions:
      - none
      - pre_session
      - pre_session_plus_next_morning_check
    weeklyDigestDefault: true
    missedLogFollowupCopy: Did you end up doing the planned plunge? Totally fine either way; I just want the experiment record to stay accurate.
    confirmationPrompt: Before I start this, I will show the exact plunge plan, schedule, safety framing, logging expectations, and reminder policy so you can confirm it.
whyItWorks:
  - Cold plunge is best understood as a short, controlled cold-stress dose. The body responds first with strong autonomic and respiratory stress, not automatic relaxation. Source keys: source_artifact:pmid-33910456, source_artifact:pmid-10751106, source_artifact:pmid-36150503.
  - Some of the most useful direct signals appear later rather than instantly: the review backbone and one acute 10 °C study point toward delayed stress or negative-affect improvement rather than a universal immediate mood lift. Source keys: source_artifact:pmid-39879231, source_artifact:pmid-37866096.
  - A small repeated-exposure study suggests that after a few weeks, resting cardiovascular measures such as heart rate and mean arterial pressure may shift, while leukocyte findings remained mostly null or uncertain. Source keys: source_artifact:pmid-37711459.
  - Repeated exposure can blunt part of the first-minute cold-shock response after roughly four exposures, which supports conservative acclimation-first onboarding instead of a first-day maximal dose. Source keys: source_artifact:pmid-38211547, source_artifact:pmid-33276648, source_artifact:pmid-31702722.
claims:
  -
    claimId: dose-implementation-001
    type: evidence_scope
    text: Direct healthy-adult cold-plunge studies use several different short protocols rather than one validated standard dose, including about 5 minutes at 20 °C, 10 minutes at 14 °C, 15 minutes at 10 °C, about 19 minutes in outdoor sea water, and one small repeated-use schedule of 12-minute immersions at 7 °C across 3 weeks.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-36829490
      - source_artifact:pmid-33910456
      - source_artifact:pmid-37866096
      - source_artifact:doi-10.1002-lim2.53
      - source_artifact:pmid-37711459
      - source_artifact:pmid-39879231
    caveats:
      - Most direct studies are small and use different settings, populations, and endpoints.
      - The repeated-use evidence is exploratory and does not establish a general default weekly frequency.
      - The direct evidence base remains heterogeneous and demographically narrow.
  -
    claimId: dose-implementation-002
    type: design_guardrail
    text: Longer and colder exposures increase physiological strain, but the prolonged 1-hour, ~170-minute, and supervised sub-4 °C studies are boundary-setting evidence and should not be treated as default home-plunge targets.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-10751106
      - source_artifact:pmid-36150503
      - source_artifact:pmid-25275647
      - source_artifact:pmid-33820701
      - source_artifact:pmid-40408371
    caveats:
      - These papers mainly define upper boundaries, responder heterogeneity, or extreme-condition context rather than typical short indoor plunges.
      - Most participants were young healthy men.
      - Several of these sources are broader in the ledger than in the later finding-level extraction; their atomic findings and source-page protocolEvidence scopes treat them as boundary or adjacent context.
  -
    claimId: direct-evidence-centers-on-affect-stress-and-limited-cardiovascular-proxies
    type: evidence_scope
    text: The direct healthy-adult cold-plunge evidence base is small and is strongest for subjective affect/stress outcomes after single exposures and a limited repeated-use cardiovascular signal, not for broad immune-enhancement claims.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-39879231
      - source_artifact:pmid-37866096
      - source_artifact:doi-10.1002-lim2.53
      - source_artifact:pmid-36829490
      - source_artifact:pmid-37711459
    caveats:
      - The review backbone still describes a small and demographically narrow literature.
      - The repeated-use cardiovascular signal comes from one very small exploratory men-only trial.
  -
    claimId: acute-affect-and-stress-signal-window-is-mixed-by-timepoint
    type: mixed_evidence
    text: Single plunges can improve affect or perceived stress in some healthy adults, but the time window is inconsistent: some studies show immediate mood improvement, one lab study showed lower negative affect and cortisol at about 3 hours, and the best review found the clearest pooled stress signal around 12 hours rather than immediately.
    strength: moderate
    sourceKeys:
      - source_artifact:doi-10.1002-lim2.53
      - source_artifact:pmid-36829490
      - source_artifact:pmid-37866096
      - source_artifact:pmid-39879231
    caveats:
      - The positive studies are small and mostly young healthy samples.
      - Water temperature, setting, and outcome timing differed across studies.
  -
    claimId: manual-affect-stress-plus-resting-hr-bp-are-the-best-fit-self-experiment-measures
    type: design_guardrail
    text: Given the current evidence mix, the best-fit user-facing measures are manual affect/stress ratings after single sessions plus resting cardiovascular context, especially resting heart rate. If the user already tracks home morning blood pressure consistently, keep it as optional context rather than a promised endpoint. HRV and sleep should stay exploratory.
    strength: low
    sourceKeys:
      - source_artifact:doi-10.1002-lim2.53
      - source_artifact:pmid-36829490
      - source_artifact:pmid-37866096
      - source_artifact:pmid-39879231
      - source_artifact:pmid-37711459
      - source_artifact:pmid-22752345
      - source_artifact:pmid-23377833
      - source_artifact:pmid-33870188
    caveats:
      - This is a synthesis choice based on evidence fit and measurability, not a directly tested ranking of endpoints.
      - Most HRV/sleep evidence comes from athlete post-exercise contexts rather than standalone general-population plunges.
  -
    claimId: sleep-and-hrv-should-stay-exploratory-not-promised
    type: mixed_evidence
    text: HRV and sleep should stay exploratory rather than promised outcomes: adjacent post-exercise studies show immediate autonomic shifts can occur after immersion, but they often do not persist to waking HRV or translate into consistent whole-night sleep benefits.
    strength: low
    sourceKeys:
      - source_artifact:pmid-19074671
      - source_artifact:pmid-22752345
      - source_artifact:pmid-23377833
      - source_artifact:pmid-33870188
      - source_artifact:pmid-29801652
    caveats:
      - These are adjacent athlete-recovery or heat-training settings, not ordinary standalone cold-plunge trials.
      - Some studies changed pre-sleep temperature or sleep architecture without producing a clear next-day recovery advantage.
  -
    claimId: entry-phase-cold-shock-is-the-main-acute-hazard
    type: safety
    text: The first minute of cold-water entry should be framed as the main acute hazard window, because cold shock can cause gasp, hyperventilation, hypertension, and loss of respiratory control that can incapacitate or contribute to drowning before hypothermia becomes the dominant issue.
    strength: high
    sourceKeys:
      - source_artifact:pmid-2691172
      - source_artifact:pmid-16714416
      - source_artifact:pmid-2010387
      - source_artifact:pmid-31178366
    caveats:
      - Most supporting sources are safety-boundary reviews or fatality-context papers rather than consumer plunge trials.
      - This claim is about acute hazard framing, not long-term efficacy or incidence in home tub users.
  -
    claimId: arrhythmia-risk-and-cardiac-stop-language-should-be-explicit
    type: safety
    text: Cold-water immersion can plausibly provoke arrhythmias through autonomic conflict, and arrhythmias have been observed in healthy volunteers, so palpitations, chest pain or pressure, marked dizziness, or faintness should be stop conditions and known arrhythmia or other significant cardiac history should trigger clinician-first language.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-22547634
      - source_artifact:pmid-26794588
      - source_artifact:pmid-37866096
    caveats:
      - The clinician-guidance wording is a practical inference from mechanism and emergency-boundary sources, not a direct home-plunge screening trial.
      - Published evidence does not define the incidence of arrhythmia in ordinary home cold-plunge users.
  -
    claimId: acclimation-can-blunt-cold-shock-but-does-not-prove-safety-for-everyone
    type: safety
    text: Repeated controlled cold-water exposures can blunt major cold-shock heart-rate and ventilatory responses after roughly four exposures, which supports acclimation-first onboarding instead of first-day maximal cold exposure.
    strength: high
    sourceKeys:
      - source_artifact:pmid-38211547
      - source_artifact:pmid-33276648
      - source_artifact:pmid-31702722
    caveats:
      - Reduced entry-phase physiology does not prove that all downstream safety outcomes are solved in unsupervised real-world use.
      - Women and older adults were underrepresented in the habituation review.
  -
    claimId: post-exercise-cwi-and-contrast-literatures-are-adjacent-and-endpoint-specific
    type: mixed_evidence
    text: Post-exercise CWI and contrast-water/hydrotherapy literatures support some athlete-recovery endpoints—especially soreness and selected delayed performance outcomes—but not all domains, and even the sleep papers are mixed or null; this evidence should stay separate from general cold-plunge efficacy claims.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-35157264
      - source_artifact:pmid-36527593
      - source_artifact:pmid-36744038
      - source_artifact:pmid-27398915
      - source_artifact:pmid-23377833
      - source_artifact:pmid-33870188
    caveats:
      - Acute strenuous-exercise and athlete/team-sport settings only.
      - Comparator results vary by endpoint, and some immediate performance or sleep effects are null or mixed.
  -
    claimId: repeated-post-training-cwi-is-a-timing-boundary-not-a-general-verdict
    type: design_guardrail
    text: Repeated post-training CWI—especially after resistance training—may blunt some strength-related adaptations, so training-adaptation papers should be used as a timing boundary, not as a general anti-plunge or pro-plunge verdict.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-33146851
      - source_artifact:pmid-35068365
    caveats:
      - Mostly male resistance-training studies.
      - This does not directly answer occasional or non-exercise plunging.
  -
    claimId: acute-cold-plunge-is-a-dose-dependent-cold-stress-load
    type: mechanistic
    text: The best-supported mechanistic framing is that cold plunge is an acute cold-stress dose: direct protocol-like biomarker work shows a short 14 °C immersion is physiologically stressful, and adjacent temperature/duration studies suggest colder or much longer exposures amplify thermoregulatory, blood-pressure, and sympathetic/catecholamine load.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-33910456
      - source_artifact:pmid-10751106
      - source_artifact:pmid-36150503
    caveats:
      - The strongest directly protocol-like biomarker signal here comes from one acute 14 °C study.
      - The temperature and duration papers are adjacent or boundary physiology sources and include exposures longer than a typical plunge.
      - This supports expectation-setting about physiological load, not a claim that colder or longer exposure is better.
  -
    claimId: direct-plunge-evidence-is-narrow-small-and-healthy-adult
    type: evidence_scope
    text: Direct cold-plunge evidence is still narrow: it is anchored by one healthy-adult review, several small single-session studies, and one exploratory repeated-exposure trial, mostly in young healthy or screened participants rather than diverse general-use populations.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-39879231
      - source_artifact:pmid-37866096
      - source_artifact:doi-10.1002-lim2.53
      - source_artifact:pmid-36829490
      - source_artifact:pmid-33910456
      - source_artifact:pmid-37711459
    caveats:
      - The backbone review still describes a small, heterogeneous, demographically narrow evidence base.
      - Key direct positive studies used screened or young healthy participants.
      - The repeated-use trial was exploratory and men only.
  -
    claimId: external-protocol-pages-map-public-claims-but-do-not-support-protocol-assertions
    type: design_guardrail
    text: External named protocol pages and newsletters can map public dose claims or user expectations, but they should not support protocol assertions unless backed by primary or synthesis evidence.
    strength: high
    sourceKeys:
      - source_artifact:hubermanlab-cold-exposure-2022-05-01
    caveats:
      - The later batch-005 extraction tightens this source to do-not-use for protocol assertions even though the canonical ledger still labels it context-only; that tighter later extraction is the safer interpretation because the source page and atomic findings both explicitly restrict it to claim mapping.
researchLandscape:
  bottomLine: Cold Plunge is a limited-confidence healthy-adult self-experiment. The clearest direct signal is delayed stress or affect improvement, while the clearest safety signal is first-minute cold shock and cardiorespiratory risk during entry.
  confidenceLabel: limited
  primaryClaim: A conservative, controlled head-out plunge is reasonable to test for later-same-day stress or mood change, but the evidence does not justify broad benefit promises or extreme dosing.
  mainCaveat: Direct plunge evidence is still small, mixed, and demographically narrow, and much of the broader cold literature belongs to adjacent variants or safety context rather than direct efficacy.
  groups:
    -
      id: direct-healthy-adult-plunge-evidence
      label: Direct healthy-adult plunge evidence
      stance: mixed
      summary: One healthy-adult review, a few small single-session studies, and one tiny repeated-use trial support cautious self-testing of mood/stress and limited resting cardiovascular signals, but not broad promised benefits.
      sourceKeys:
        - source_artifact:pmid-39879231
        - source_artifact:pmid-37866096
        - source_artifact:doi-10.1002-lim2.53
        - source_artifact:pmid-36829490
        - source_artifact:pmid-33910456
        - source_artifact:pmid-37711459
      defaultOpen: true
    -
      id: entry-safety-and-cardiac-boundaries
      label: Entry safety and cardiac boundaries
      stance: safety_boundary
      summary: The strongest cold-plunge evidence is actually about acute hazard framing: first-minute cold shock, respiratory loss of control, blood-pressure surges, arrhythmia plausibility, and the need for screening and clear stop conditions.
      sourceKeys:
        - source_artifact:pmid-38211547
        - source_artifact:pmid-2691172
        - source_artifact:pmid-2010387
        - source_artifact:pmid-16714416
        - source_artifact:pmid-22547634
        - source_artifact:pmid-26794588
        - source_artifact:pmid-31178366
        - source_artifact:pmid-40408371
      defaultOpen: true
    -
      id: dose-and-mechanistic-boundaries
      label: Dose and mechanistic boundaries
      stance: context_only
      summary: Mechanistic and boundary papers support treating cold plunge as a dose-dependent cold stressor. They help explain why colder or longer exposures raise strain, but they do not validate an extreme home target.
      sourceKeys:
        - source_artifact:pmid-10751106
        - source_artifact:pmid-36150503
        - source_artifact:pmid-25275647
        - source_artifact:pmid-33820701
        - source_artifact:pmid-37840386
      defaultOpen: false
    -
      id: athlete-recovery-and-training-context
      label: Athlete recovery and training context
      stance: mixed
      summary: Post-exercise CWI and contrast-water papers support some soreness and delayed recovery endpoints, but they are exercise-context studies. Repeated post-resistance CWI can also trade short-term recovery against some strength-adaptation outcomes.
      sourceKeys:
        - source_artifact:pmid-35157264
        - source_artifact:pmid-36527593
        - source_artifact:pmid-36744038
        - source_artifact:pmid-27398915
        - source_artifact:pmid-23377833
        - source_artifact:pmid-33870188
        - source_artifact:pmid-33146851
        - source_artifact:pmid-35068365
      defaultOpen: false
    -
      id: adjacent-variants-and-public-claims
      label: Adjacent variants and public protocol claims
      stance: context_only
      summary: Winter swimming, cold showers, cryotherapy, and external named protocol pages help map adjacent expectations and public claims, but they should not be merged into Murph’s default cold-plunge assertions.
      sourceKeys:
        - source_artifact:pmid-15253480
        - source_artifact:pmid-12078959
        - source_artifact:pmid-10735978
        - source_artifact:pmid-37381680
        - source_artifact:pmid-27631616
        - source_artifact:pmid-38478473
        - source_artifact:hubermanlab-cold-exposure-2022-05-01
      defaultOpen: false
safety:
  cautionLevel: high
  avoidOrGetClinicianGuidance:
    - known cardiovascular disease or unexplained chest symptoms
    - uncontrolled blood pressure or known arrhythmia
    - recent fainting or unreliable safe exit/rewarming
    - prior severe breathing loss-of-control during cold-water entry
  stopIf:
    - chest pain, chest pressure, palpitations, faintness, marked dizziness, confusion, collapse, new neurologic symptoms, or breathing you cannot control
    - if chest symptoms, breathing difficulty, confusion, collapse, or failure to rewarm are not resolving promptly after exit, seek urgent medical evaluation
    - safe exit or reliable rewarming is not possible
    - symptoms repeatedly outweigh any possible benefit
  notes:
    - Keep the head out of the water and do not use open water for this protocol.
    - Do not combine the plunge with intentional hyperventilation, breath-holding, face immersion, or a cold-endurance challenge mindset.
    - This is a healthy-adult wellness experiment. Do not apply it to children, adolescents, or condition-treatment use cases such as depression without a separate reviewed variant.
    - This protocol is a bounded self-experiment, not a treatment plan or a test of willpower.
---

Cold Plunge is Murph’s cautious default for deliberate cold-water immersion in a controlled tub or plunge.

## What this protocol is trying to answer

Can a short, repeatable, head-out plunge improve later-same-day stress or mood enough to be worth repeating, without pushing safety, tolerance, or next-morning cardiovascular context in the wrong direction?

The direct healthy-adult evidence is narrow and mixed. The cleanest current claim is not “cold plunge definitely boosts everything,” but something smaller: some users may notice later stress or affect benefits, and a few weeks of repeated use might shift resting cardiovascular measures, while first-minute cold shock remains the main hazard framing. Source keys: `source_artifact:pmid-39879231`, `source_artifact:pmid-37866096`, `source_artifact:doi-10.1002-lim2.53`, `source_artifact:pmid-36829490`, `source_artifact:pmid-37711459`, `source_artifact:pmid-2691172`.

## Why the Murph default is conservative

The direct literature does not validate one best dose. The closest protocol-like studies used several different short doses rather than one settled standard, and longer or much colder exposures mostly function as boundary-setting physiology or safety context rather than as default home targets. Source keys: `source_artifact:pmid-36829490`, `source_artifact:pmid-33910456`, `source_artifact:pmid-37866096`, `source_artifact:doi-10.1002-lim2.53`, `source_artifact:pmid-37711459`, `source_artifact:pmid-10751106`, `source_artifact:pmid-36150503`, `source_artifact:pmid-25275647`, `source_artifact:pmid-33820701`, `source_artifact:pmid-40408371`.

The 3x/week, 1–5 minute, 10–15 °C plan is a conservative Murph test design, not a validated standard dose from a single trial.

That is why Murph starts with short head-out sessions, a modest target band, and an acclimation-first approach. The protocol is trying to be easy to stop, easy to log, and honest about uncertainty.

## What Murph is not claiming

Murph is not turning post-exercise recovery papers, winter swimming studies, cryotherapy papers, or external newsletters into stand-alone cold-plunge proof. Those sources matter, but mostly as adjacent context, safety framing, or boundary setting. Source keys: `source_artifact:pmid-35157264`, `source_artifact:pmid-36527593`, `source_artifact:pmid-36744038`, `source_artifact:pmid-33146851`, `source_artifact:pmid-35068365`, `source_artifact:pmid-15253480`, `source_artifact:pmid-12078959`, `source_artifact:pmid-10735978`, `source_artifact:pmid-37381680`, `source_artifact:pmid-27631616`, `source_artifact:pmid-38478473`, `source_artifact:hubermanlab-cold-exposure-2022-05-01`.

## How to read your result

A useful result is not “I survived a colder plunge.” A useful result is something narrower and more personal:

- same-day stress looks meaningfully lower often enough to matter,
- mood or affect trends look better in a repeatable way,
- resting heart rate stays stable or moves in a favorable direction, and any home morning blood-pressure trend you already track does not move in the wrong direction,
- and the protocol still feels tolerable and safe.

Null results are normal. If nothing repeatable improves, that is still a useful answer.
