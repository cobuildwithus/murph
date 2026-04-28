---
schemaVersion: "murph.commons.page.v1"
entityType: "protocol_variant"
key: "protocol_variant:consistent-wake-time/consistent-wake-time"
slug: "protocols/consistent-wake-time/consistent-wake-time"
title: "Consistent Wake Time"
summary: "Choose a realistic wake/rise window and keep it stable while protecting enough sleep, then test whether regularity, sleepiness, or alertness signals improve."
status: "field-testing"
quality: "usable"
aliases:
  - "consistent wake time"
  - "fixed wake time"
  - "regular wake time"
  - "stable wake time"
  - "same wake time every day"
  - "fixed rise time"
  - "regular rise time"
  - "wake-time consistency"
  - "wake-time regularity"
  - "weekday-weekend wake consistency"
  - "sleep schedule anchor"
  - "regular sleep-wake schedule"
categories:
  - "sleep"
  - "circadian"
  - "sleep-regularity"
  - "behavior-change"
  - "wearable-measured"
  - "murph-canonical"
media:
  -
    kind: image
    relativePath: design-assets/hero-consistent-wake-time.jpeg
    mediaType: image/jpeg
    caption: Consistent Wake Time
relations:
  -
    type: "parent_family"
    target: "experiment_family:consistent-wake-time"
  -
    type: "primary_biomarker"
    target: "biomarker:wake-time-variability"
  -
    type: "secondary_biomarker"
    target: "biomarker:total-sleep-time"
  -
    type: "secondary_biomarker"
    target: "biomarker:daytime-sleepiness"
  -
    type: "secondary_biomarker"
    target: "biomarker:sleep-efficiency"
  -
    type: "secondary_biomarker"
    target: "biomarker:sleep-onset-latency"
  -
    type: "secondary_biomarker"
    target: "biomarker:hrv-rmssd"
  -
    type: "cites"
    target: "source_artifact:consistent-wake-time-bibliography"
  -
    type: "cites"
    target: "source_artifact:pmid-8843535"
  -
    type: "cites"
    target: "source_artifact:pmid-7126725"
  -
    type: "cites"
    target: "source_artifact:pmid-218642"
  -
    type: "cites"
    target: "source_artifact:doi-10.1111/j.1479-8425.2011.00524.x"
  -
    type: "cites"
    target: "source_artifact:pmid-40543253"
  -
    type: "cites"
    target: "source_artifact:pmid-40924703"
  -
    type: "cites"
    target: "source_artifact:pmid-37366548"
  -
    type: "cites"
    target: "source_artifact:pmid-34605392"
  -
    type: "cites"
    target: "source_artifact:pmid-33164742"
  -
    type: "cites"
    target: "source_artifact:pmid-27136449"
  -
    type: "cites"
    target: "source_artifact:pmid-24497651"
  -
    type: "cites"
    target: "source_artifact:pmid-22357064"
  -
    type: "cites"
    target: "source_artifact:pmid-19962939"
  -
    type: "cites"
    target: "source_artifact:pmid-26745754"
  -
    type: "cites"
    target: "source_artifact:pmid-28607474"
  -
    type: "cites"
    target: "source_artifact:pmid-30242174"
  -
    type: "cites"
    target: "source_artifact:pmid-32138974"
  -
    type: "cites"
    target: "source_artifact:pmid-36789869"
  -
    type: "cites"
    target: "source_artifact:pmid-37738616"
  -
    type: "cites"
    target: "source_artifact:pmid-37995126"
  -
    type: "cites"
    target: "source_artifact:pmid-39603689"
  -
    type: "cites"
    target: "source_artifact:pmid-31132578"
  -
    type: "cites"
    target: "source_artifact:doi-10.3109/07420528.2011.613137"
  -
    type: "cites"
    target: "source_artifact:pmid-26588182"
  -
    type: "cites"
    target: "source_artifact:pmcid-pmc12404321"
  -
    type: "cites"
    target: "source_artifact:pmcid-pmc9981680"
  -
    type: "cites"
    target: "source_artifact:doi-10.1016/j.jacadv.2025.102109"
  -
    type: "cites"
    target: "source_artifact:pmid-33054339"
  -
    type: "cites"
    target: "source_artifact:pmcid-pmc6647049"
  -
    type: "cites"
    target: "source_artifact:pmid-27110481"
  -
    type: "cites"
    target: "source_artifact:pmid-37800322"
  -
    type: "cites"
    target: "source_artifact:pmid-33864369"
  -
    type: "cites"
    target: "source_artifact:pmid-37684151"
  -
    type: "cites"
    target: "source_artifact:pmid-29991437"
  -
    type: "cites"
    target: "source_artifact:pmid-29991438"
  -
    type: "cites"
    target: "source_artifact:pmid-29734997"
  -
    type: "cites"
    target: "source_artifact:pmid-30789439"
  -
    type: "cites"
    target: "source_artifact:pmid-38149978"
  -
    type: "cites"
    target: "source_artifact:pmid-22294820"
  -
    type: "cites"
    target: "source_artifact:pmid-12749556"
  -
    type: "cites"
    target: "source_artifact:pmid-17520797"
  -
    type: "cites"
    target: "source_artifact:pmid-16687322"
  -
    type: "cites"
    target: "source_artifact:pmid-22578422"
  -
    type: "cites"
    target: "source_artifact:pmid-28631524"
  -
    type: "cites"
    target: "source_artifact:pmid-30099352"
  -
    type: "cites"
    target: "source_artifact:pmid-39158856"
  -
    type: "cites"
    target: "source_artifact:pmid-36351658"
  -
    type: "cites"
    target: "source_artifact:mdpi-social-jetlag-risks-2021-12-15"
  -
    type: "cites"
    target: "source_artifact:pmid-36852716"
  -
    type: "cites"
    target: "source_artifact:pmid-34698705"
  -
    type: "cites"
    target: "source_artifact:pmid-39894021"
  -
    type: "cites"
    target: "source_artifact:pmid-25156998"
  -
    type: "cites"
    target: "source_artifact:pmid-26039963"
  -
    type: "cites"
    target: "source_artifact:pmid-27250809"
  -
    type: "cites"
    target: "source_artifact:pmid-29073398"
  -
    type: "cites"
    target: "source_artifact:pmid-29073412"
  -
    type: "cites"
    target: "source_artifact:pmid-26414989"
  -
    type: "cites"
    target: "source_artifact:pmid-30239905"
  -
    type: "cites"
    target: "source_artifact:aaafoundation-acute-sleep-deprivation-crash-risk-2016-12-01"
  -
    type: "cites"
    target: "source_artifact:pmid-26414986"
  -
    type: "cites"
    target: "source_artifact:pmid-28162150"
  -
    type: "cites"
    target: "source_artifact:pmid-34743789"
  -
    type: "cites"
    target: "source_artifact:pmid-28684405"
  -
    type: "cites"
    target: "source_artifact:pmid-17969869"
  -
    type: "cites"
    target: "source_artifact:pmid-18041479"
  -
    type: "cites"
    target: "source_artifact:doi-10.26616/nioshpub2015115revised042020"
  -
    type: "cites"
    target: "source_artifact:pmcid-pmc4629843"
lineage:
  relationship: "root"
  rationale: "Default Murph wake-time-anchored regularity experiment, kept separate from bedtime-only regularity, full sleep hygiene, CBT-I fixed-rise-time care, sleep restriction, light therapy, melatonin, social-jetlag reduction, delayed sleep-wake phase treatment, and shift-work adaptation."
attribution:
  ownerType: "murph"
protocol:
  doseSignature: "Daily · chosen 60-minute wake/rise window · protect sleep opportunity · 7-day baseline + 28-day intervention"
  target: "Wake or rise within a personally realistic 60-minute window that still allows adequate sleep opportunity."
  frequency:
    sessionsPerWeek: 7
  interventionSessionsMinimum: 20
  interventionSessionsTarget: 28
  steps:
    - "For 7 baseline days, do not try to change your schedule; log final wake time, time out of bed, lights-out time, estimated sleep duration, daytime sleepiness, naps, and major confounders."
    - "Choose a daily wake/rise window no wider than 60 minutes. Pick the latest window that still works with your real obligations and gives you enough sleep opportunity."
    - "Set the wake window as a consistency target, not an exact-minute alarm. The aim is to reduce day-to-day drift while staying rested enough to function safely."
    - "Plan bedtime backward from the wake window so the schedule preserves adequate sleep opportunity. If bedtime cannot realistically move earlier, choose a later wake window or postpone the run."
    - "During the 28-day intervention, wake or get out of bed inside the chosen window on as many days as safely reasonable, including free days when you are not recovering from short sleep."
    - "If you are acutely short on sleep, ill, jet-lagged, unusually sleepy, or facing safety-sensitive driving or work, prioritize sleep and safety, log the exception, and resume only when safe."
    - "Review weekly trends in wake-time variability, days inside the window, sleep duration, sleepiness, naps, and confounders rather than judging single nights."
    - "Safety overrides that protect sleep opportunity, illness recovery, drowsy-driving prevention, or safety-sensitive work should be logged as valid exceptions, not counted as nonadherence."
  tips:
    - "Make the first target realistic rather than aspirational; a later consistent window is safer than an early window that creates sleep debt."
    - "Pair the wake target with a bedtime or wind-down guardrail so consistency does not silently become sleep restriction."
    - "Use a wearable for convenience if available, but keep a simple sleep diary field for final wake time and time out of bed."
    - "Keep caffeine timing, alcohol, late screens or bright light, naps, training load, stress, and travel as stable as reasonably possible while testing."
    - "Weekends can use the same window when sleep opportunity is adequate, but recovery sleep wins when weekday sleep has been too short."
  keepInMind:
    - "This is not a treatment for chronic insomnia, sleep apnea, narcolepsy, circadian rhythm sleep-wake disorders, bipolar mood destabilization, or shift-work fatigue."
    - "The strongest direct source used both bedtime and wake-time windows, so evidence for wake-time-only effects is limited."
    - "No extracted source validates an optimal universal wake-time window, adherence percentage, weekend tolerance, or consumer-wearable algorithm."
    - "Lower wake-time variability is the primary behavior signal; health, metabolic, cardiovascular, mortality, sleep-stage, or disease-prevention benefits should not be inferred from observational context."
  logFields:
    - "target wake/rise window"
    - "final wake time"
    - "time out of bed"
    - "lights-out or sleep-attempt time"
    - "estimated total sleep time or time in bed"
    - "days inside target window"
    - "daytime sleepiness or alertness"
    - "naps"
    - "caffeine and alcohol timing"
    - "evening light or screen exposure"
    - "stress, illness, travel, shift work, or schedule disruption"
    - "mood irritability or activation"
    - "wearable missingness or manual correction"
  stopConditions:
    - "Pause or end the run if the wake target repeatedly reduces sleep opportunity or produces new or worsening daytime sleepiness."
    - "Do not drive, commute, operate machinery, or do safety-sensitive work while sleepy or acutely short on sleep just to preserve the wake target."
    - "Stop and seek appropriate guidance for persistent excessive sleepiness, loud snoring with witnessed apneas, suspected narcolepsy or hypersomnolence symptoms, severe insomnia, or unexplained sleep-disorder signs."
    - "Stop and seek appropriate guidance for signs of mania or hypomania, unusual agitation, risky activation, or mood destabilization linked to shorter or shifted sleep."
    - "Adapt or defer the protocol during rotating shifts, long work hours, jet lag, acute illness, caregiving nights, or other contexts where a rigid wake window is unsafe or unrealistic."
testPlans:
  -
    planId: "wake-regularity-35d"
    durationDays: 35
    baselineDays: 7
    interventionDays: 28
    primaryBiomarkerKey: "biomarker:wake-time-variability"
    secondaryBiomarkerKeys:
      - "biomarker:total-sleep-time"
      - "biomarker:daytime-sleepiness"
      - "biomarker:sleep-efficiency"
      - "biomarker:sleep-onset-latency"
      - "biomarker:hrv-rmssd"
    minimumAdherenceSessions: 20
    targetAdherenceSessions: 28
    notes:
      - "Treat wake-time variability and target-window adherence as the primary behavior outcomes."
      - "Track total sleep time or sleep opportunity and daytime sleepiness as safety guardrails; do not count short-sleep success as a clean win."
      - "Sleep efficiency, sleep-onset latency, and HRV are secondary or exploratory context signals with mixed and confounded evidence."
      - "Use the same wearable and diary method across baseline and intervention when possible; manually correct obvious wake-time detection errors."
      - "The 7-day baseline and 28-day intervention are Murph-pragmatic defaults, not source-validated optimum lengths."
      - "Interpret the 20/28 minimum only after separating unsafe or medically appropriate safety overrides from ordinary missed adherence days."
expectedSignalDescriptions:
  -
    biomarkerKey: "biomarker:wake-time-variability"
    description: "The protocol directly targets wake timing. If the chosen window is realistic and followed often enough, wake times should tighten."
  -
    biomarkerKey: "biomarker:total-sleep-time"
    description: "A stable wake time only helps if bedtime and time in bed adjust with it. Total sleep time may stay stable or improve when the anchor reduces drift without creating short sleep."
  -
    biomarkerKey: "biomarker:daytime-sleepiness"
    description: "More regular timing may make mornings feel steadier, but sleepiness should improve only if the plan preserves enough sleep."
  -
    biomarkerKey: "biomarker:sleep-efficiency"
    description: "A steadier wake time gives the body clock the same morning anchor each day. That can reduce night-to-night drift and make sleep less broken."
  -
    biomarkerKey: "biomarker:sleep-onset-latency"
    description: "A consistent wake anchor may make sleep pressure and body-clock timing more predictable by evening, so falling asleep may become easier."
  -
    biomarkerKey: "biomarker:hrv-rmssd"
    description: "Regular timing can reduce sleep debt and night-to-night drift. If sleep becomes more stable, overnight strain may ease."
experimentOnboarding:
  schemaVersion: "murph.commons.experiment-onboarding.v1"
  startIntent:
    displayPrompt: "Hey Murph, I want to explore a Consistent Wake Time experiment."
    intentSummary: "Explore Consistent Wake Time"
  contextReview:
    vaultChecks:
      -
        id: "active_experiments"
        label: "Active experiments"
        reason: "Avoid starting more than one meaningful sleep or recovery experiment at once unless the user explicitly accepts the attribution tradeoff."
        readHints:
          - "experiment list --status active --format json"
      -
        id: "recent_sleep_timing_duration"
        label: "Recent sleep timing and duration"
        reason: "Confirm baseline wake-time variability, sleep opportunity, and whether the proposed wake target would create short sleep."
        freshnessDays: 21
        readHints:
          - "wearables day <YYYY-MM-DD> --format json"
          - "timeline --entry-type sleep --from <YYYY-MM-DD> --format json"
          - "search query \"sleep diary wake time bedtime sleepiness\" --format json"
      -
        id: "wearable_or_diary_sources"
        label: "Wearable or diary availability"
        reason: "Choose a measurement plan before asking the user to run a timing experiment."
        freshnessDays: 14
        readHints:
          - "wearables sources list --format json"
          - "search query \"wearable sleep diary\" --format json"
      -
        id: "sleepiness_insomnia_or_sleep_disorder_context"
        label: "Sleepiness, insomnia, and sleep-disorder context"
        reason: "Persistent sleepiness, severe insomnia, suspected OSA, hypersomnolence, or circadian symptoms are supervision boundaries rather than wake-target troubleshooting tasks."
        freshnessDays: 180
        readHints:
          - "search query \"sleepiness insomnia snoring apnea hypersomnolence narcolepsy circadian delayed sleep phase\" --format json"
      -
        id: "work_school_shift_travel_constraints"
        label: "Schedule constraints"
        reason: "Work, school, caregiving, travel, and shift schedules can make a single wake window unsafe or uninterpretable."
        freshnessDays: 30
        readHints:
          - "search query \"shift work night shift travel jet lag school start caregiving commute\" --format json"
      -
        id: "mood_destabilization_context"
        label: "Mood destabilization context"
        reason: "Sleep loss and rhythm changes can be risky in bipolar-spectrum or recent mania/hypomania contexts."
        freshnessDays: 180
        readHints:
          - "search query \"bipolar mania hypomania mood sleep loss social rhythm\" --format json"
    notes:
      - "Review available context before repeating setup questions, but still ask the compact safety screen when the vault is silent or stale."
  safetyScreen:
    cautionLevel: "moderate"
    mode: "ask_compact_then_expand_if_positive"
    dispositionIfAnyPositive: "clinician_guidance_before_unsupervised_start"
    mustAsk:
      -
        id: "insufficient_sleep_opportunity"
        prompt: "Would the proposed wake window routinely leave you short on sleep because bedtime cannot realistically move earlier?"
        ifPositive: "do_not_start_unsupervised"
        why: "The protocol should not become sleep restriction."
      -
        id: "dangerous_sleepiness_or_driving"
        prompt: "Are you currently having excessive daytime sleepiness, drowsy driving, unsafe morning impairment, or safety-sensitive work while short on sleep?"
        ifPositive: "do_not_start_unsupervised"
        why: "Safety and adequate sleep override wake-time regularity."
      -
        id: "sleep_disorder_or_severe_insomnia_flags"
        prompt: "Do you have severe or chronic insomnia, loud snoring with witnessed apneas, suspected sleep apnea, narcolepsy or hypersomnolence symptoms, or another unresolved sleep-disorder concern?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
        why: "These are clinical evaluation or treatment boundaries, not wake-time-only troubleshooting targets."
      -
        id: "circadian_shift_work_or_school_constraint"
        prompt: "Are you dealing with rotating shifts, long work hours, jet lag, delayed sleep phase, school-start constraints, caregiving nights, or another schedule constraint that makes one daily wake window unrealistic?"
        ifPositive: "continue_with_caution"
        why: "The plan may need adaptation, postponement, or a different fatigue-management approach."
      -
        id: "mood_destabilization_risk"
        prompt: "Have you had bipolar disorder, recent mania or hypomania, or mood destabilization when sleep gets shorter or timing changes?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
        why: "Sleep loss and rhythm shifts can destabilize vulnerable mood states."
    stopIf:
      inheritFromProtocolSafety: true
      additionalConditions:
        - "Do not create a run when the selected wake window is expected to cause repeated short sleep."
        - "Do not create a run when the user expects to drive or do safety-sensitive work while sleepy to hit the wake target."
    notes:
      - "A positive or uncertain screen is not a diagnosis; it means the self-directed default run is not the right next step without adjustment, postponement, or clinician/occupational guidance."
  setupSlots:
    -
      id: "target_wake_window"
      label: "Target wake/rise window"
      purpose: "logistics"
      valueType: "weekly_time_windows"
      askPolicy: "always"
      required: true
      question: "What 60-minute wake/rise window can you realistically keep on most days while still getting enough sleep?"
      constraints:
        maxWindowMinutes: 60
      target:
        object: experimentRun
        field: schedule.targetWakeWindow
    -
      id: "sleep_opportunity_plan"
      label: "Sleep-opportunity plan"
      purpose: "safety"
      valueType: "free_text"
      askPolicy: "always"
      required: true
      question: "What bedtime or lights-out guardrail will protect enough sleep before that wake window?"
      target:
        object: experimentRun
        field: safety.sleepOpportunityPlan
    -
      id: "measurement_method"
      label: "Measurement method"
      purpose: "measurement_fidelity"
      valueType: "enum"
      askPolicy: "ask_if_unknown"
      required: true
      question: "How should Murph measure wake time during the run?"
      options:
        - "sleep_diary"
        - "wearable_plus_diary"
        - "wearable_only"
      target:
        object: experimentRun
        field: measurement.method
    -
      id: "weekend_recovery_policy"
      label: "Weekend and recovery policy"
      purpose: "safety"
      valueType: "enum"
      askPolicy: "always"
      required: true
      question: "How should the plan handle weekends or recovery after short sleep?"
      options:
        - "same_window_when_slept_enough"
        - "protect_sleep_after_short_sleep"
        - "needs_variable_schedule"
      target:
        object: experimentRun
        field: safety.weekendRecoveryPolicy
    -
      id: "reminder_policy"
      label: "Reminder policy"
      purpose: "assistant_support"
      valueType: "reminder_policy"
      askPolicy: "ask_at_confirmation"
      required: false
      question: "Would you like opt-in morning or weekly reminder support, or no reminders?"
      target:
        object: experimentRun
        field: assistant.reminderPolicy
  planDefaults:
    testPlanId: "wake-regularity-35d"
    baselineDays: 7
    interventionDays: 28
    sessionsPerWeek: 7
    targetSessions: 28
    minimumUsefulSessions: 20
    firstSessionGuidance: "Start with baseline logging before changing the wake target. If the chosen wake window would make tonight too short, adjust later or postpone instead of forcing it."
  logging:
    sessionFields:
      - "target_wake_window"
      - "final_wake_time"
      - "time_out_of_bed"
      - "lights_out_time"
      - "estimated_total_sleep_time"
      - "daytime_sleepiness"
      - "naps"
      - "inside_wake_window"
      - "safety_override"
    confounders:
      - "caffeine_alcohol_timing"
      - "evening_light_or_screens"
      - "stress_or_illness"
      - "travel_shift_work_or_school"
      - "mood_activation"
      - "device_missingness"
    notes:
      - "Log safety overrides as appropriate adherence decisions, not failures."
  assistantPolicy:
    maxSetupQuestionsPerTurn: 2
    askBeforeCreatingAutomations: true
    missedLogFollowup: "opt_in_only"
    reminderOptions:
      - "none"
      - "morning_checkin"
      - "evening_bedtime_guardrail"
      - "weekly_digest"
    weeklyDigestDefault: true
    missedLogFollowupCopy: "No problem if the log was missed. Do you want to record the wake time and whether sleep felt safe enough today?"
    confirmationPrompt: "Confirm the exact protocol key, 7-day baseline, 28-day intervention, target wake window, sleep-opportunity guardrail, measurement method, stop conditions, and reminder policy before creating the run."
whyItWorks:
  - "Wake time is a practical anchor for sleep timing regularity; the direct evidence base uses broader sleep-wake regularization and short regular-timing interventions rather than a pure wake-time-only trial base."
  - "Protecting sleep opportunity is the mechanism guardrail: a stable wake window is only useful when it does not create chronic short sleep or daytime impairment."
  - "Regularity metrics, diaries, and wearables can make the behavior visible over repeated nights, but measurement sources require diary correction and caution against diagnostic interpretations."
claims:
  -
    claimId: "direct-evidence-is-broader-regularization"
    type: "evidence_scope"
    text: "The closest intervention evidence for Consistent Wake Time is mostly broader sleep-wake or sleep-timing regularization rather than a pure wake-time-only randomized wellness trial base; adjacent wake-time-specific and fixed-wake variability sources should be used only as context."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-8843535"
      - "source_artifact:pmid-7126725"
      - "source_artifact:doi-10.1111/j.1479-8425.2011.00524.x"
      - "source_artifact:pmid-40543253"
      - "source_artifact:pmid-40924703"
    caveats:
      - "Several direct-bucket studies regularized bedtime, sleep duration, or overall sleep timing as well as wake time."
      - "Samples were often small, short-duration, student-heavy, healthy-adult, or clinically mismatched."
  -
    claimId: "wake-window-and-sleep-opportunity-first"
    type: "design_guardrail"
    text: "A practical default can use a chosen wake/rise window of about 60 minutes while protecting adequate sleep opportunity; this window is borrowed from broader sleep-wake regularization evidence and has not been optimized or validated as a wake-time-only dose."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-8843535"
      - "source_artifact:doi-10.1111/j.1479-8425.2011.00524.x"
      - "source_artifact:pmid-40543253"
      - "source_artifact:pmid-26039963"
      - "source_artifact:pmid-27250809"
      - "source_artifact:pmid-37684151"
    caveats:
      - "The one-hour window is evidence-informed by schedule-regularization evidence, not optimized against other wake windows."
      - "Adult and pediatric sleep-duration recommendations are safety boundaries, not individualized prescriptions."
  -
    claimId: "primary-measurement-wake-variability-and-adherence"
    type: "design_guardrail"
    text: "Primary measurement should record final wake/rise time each day and summarize both wake-time variability and target-window adherence, with diary correction when wearable detection is uncertain."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-8843535"
      - "source_artifact:pmid-22294820"
      - "source_artifact:pmid-33864369"
      - "source_artifact:pmid-37684151"
    caveats:
      - "No extracted source validates a Murph-specific wearable algorithm for wake-window adherence."
      - "Sleep Regularity Index is a broader sleep-wake pattern metric and should not replace the wake-time target."
  -
    claimId: "short-term-personal-signals-possible-not-guaranteed"
    type: "intervention_result"
    text: "When sleep opportunity is preserved, defensible personal signals include lower wake-time variability and possible changes in subjective daytime sleepiness, diary sleep continuity, negative mood, or selected short-term autonomic markers."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-8843535"
      - "source_artifact:doi-10.1111/j.1479-8425.2011.00524.x"
      - "source_artifact:pmid-40543253"
    caveats:
      - "These are candidate personal trend signals, not guaranteed benefits."
      - "The intervention evidence is small and short and often regularizes broader timing than wake time alone."
      - "Autonomic findings are mixed and should be described as short-term marker changes, not uniformly beneficial autonomic improvement."
  -
    claimId: "null-and-mixed-findings-stay-visible"
    type: "mixed_evidence"
    text: "Protocol prose should not promise improvements in EEG sleep architecture, cognition, broad mood, sleep duration, sleep efficiency, sleep quality, blood pressure, peripheral vascular function, or wearable sleep efficiency."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-7126725"
      - "source_artifact:doi-10.1111/j.1479-8425.2011.00524.x"
      - "source_artifact:pmid-40543253"
      - "source_artifact:pmid-40924703"
      - "source_artifact:pmid-37366548"
      - "source_artifact:pmid-34605392"
    caveats:
      - "Some null findings come from small or adjacent-variant studies and set claim boundaries rather than proving absence of any effect."
      - "Wearable and actigraphy measures can diverge from subjective reports."
  -
    claimId: "observational-health-associations-not-causal-benefits"
    type: "association_not_causation"
    text: "Large sleep-regularity, social-jetlag, and cardiometabolic observational sources justify tracking timing regularity as context, but they do not show that a Consistent Wake Time self-experiment prevents cardiovascular events, mortality, obesity, metabolic disease, depression, anxiety, or poor academic outcomes."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-28607474"
      - "source_artifact:pmid-30242174"
      - "source_artifact:pmid-32138974"
      - "source_artifact:pmid-37738616"
      - "source_artifact:pmid-37995126"
      - "source_artifact:pmid-39603689"
      - "source_artifact:pmcid-pmc6647049"
      - "source_artifact:pmcid-pmc12404321"
      - "source_artifact:pmid-39158856"
      - "source_artifact:pmid-36351658"
    caveats:
      - "These sources are observational and vulnerable to residual confounding, reverse causation, selection effects, and measurement heterogeneity."
      - "Most exposures measure broad sleep regularity or social jetlag rather than a prescribed wake-time intervention."
  -
    claimId: "wearables-and-diaries-are-trend-tools-not-diagnosis"
    type: "design_guardrail"
    text: "Consumer wearables and sleep diaries can support multi-night trend tracking, but they should not be treated as diagnostic tests or as proof that a sleep disorder has been ruled out."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-22294820"
      - "source_artifact:pmid-29734997"
      - "source_artifact:pmid-30789439"
      - "source_artifact:pmid-38149978"
      - "source_artifact:pmid-29991437"
    caveats:
      - "Device algorithms, missing nights, naps, split sleep, illness, travel, and sensor changes can distort wake-time and sleep-continuity estimates."
      - "Clinical sleep-disorder evaluation is outside the self-experiment."
  -
    claimId: "dangerous-sleepiness-and-driving-are-stop-conditions"
    type: "safety"
    text: "New or worsening daytime sleepiness, impaired vigilance, unsafe morning impairment, drowsy driving, or safety-sensitive work while short on sleep should pause or end the experiment and shift the goal back to adequate sleep and appropriate care."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-24497651"
      - "source_artifact:pmid-37366548"
      - "source_artifact:pmid-34743789"
      - "source_artifact:pmid-26414989"
      - "source_artifact:pmid-30239905"
      - "source_artifact:aaafoundation-acute-sleep-deprivation-crash-risk-2016-12-01"
    caveats:
      - "Crash-risk sources are safety-boundary evidence, not efficacy evidence for the protocol."
      - "Persistent excessive sleepiness is a clinical referral boundary."
  -
    claimId: "clinical-circadian-mood-and-shift-contexts-need-supervision-or-adaptation"
    type: "safety"
    text: "Chronic insomnia, suspected obstructive sleep apnea or hypersomnolence, clinician-managed circadian rhythm sleep-wake disorders, bipolar-spectrum mood destabilization risk, rotating shift work, long work hours, and safety-sensitive schedules should not be folded into the default self-directed protocol."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-33164742"
      - "source_artifact:pmid-27136449"
      - "source_artifact:pmid-26414986"
      - "source_artifact:pmid-28162150"
      - "source_artifact:pmid-34743789"
      - "source_artifact:pmid-28684405"
      - "source_artifact:pmid-17969869"
      - "source_artifact:doi-10.26616/nioshpub2015115revised042020"
      - "source_artifact:pmcid-pmc4629843"
    caveats:
      - "Guidelines and occupational sources define boundaries and referral contexts; they do not test this self-experiment."
      - "Bipolar-spectrum and shift-work contexts may require different timing targets or clinical/occupational fatigue-management plans."
researchLandscape:
  bottomLine: "Consistent Wake Time is best framed as a modest, sleep-opportunity-preserving timing experiment with limited direct evidence and a larger adjacent regularity literature."
  confidenceLabel: "limited"
  primaryClaim: "The most defensible target is improved wake-time regularity, with possible short-term subjective sleepiness or diary-continuity benefits in people whose current schedule is irregular."
  mainCaveat: "No extracted source establishes a pure wake-time-only protocol as a treatment for insomnia, disease prevention, metabolic risk, cardiovascular risk, mortality, or sleep-stage improvement."
  groups:
    -
      id: "direct-sleep-wake-regularization"
      label: "Direct and near-direct timing regularization"
      stance: "mixed"
      summary: "Short intervention sources support feasibility and some subjective or autonomic signals, but most regularize broader sleep-wake timing rather than wake time alone and preserve sleep opportunity."
      sourceKeys:
        - "source_artifact:doi-10.1111/j.1479-8425.2011.00524.x"
        - "source_artifact:pmid-40543253"
        - "source_artifact:pmid-40924703"
        - "source_artifact:pmid-7126725"
        - "source_artifact:pmid-8843535"
      defaultOpen: true
    -
      id: "adjacent-wake-time-and-fixed-wake-context"
      label: "Adjacent wake-time and fixed-wake context"
      stance: "context_only"
      summary: "Wake-time-specific daily behavior and fixed-wake variability studies inform measurement and plausible short-term signals, but they do not establish causal wake-time-only efficacy."
      sourceKeys:
        - "source_artifact:pmid-218642"
        - "source_artifact:pmid-34605392"
        - "source_artifact:pmid-37366548"
    -
      id: "measurement-and-wearable-methods"
      label: "Measurement, diary, and wearable context"
      stance: "context_only"
      summary: "Measurement sources support tracking final awakening, time out of bed, wake-time variability, sleep regularity, and diary/wearable caveats; they do not make consumer devices diagnostic."
      sourceKeys:
        - "source_artifact:pmid-12749556"
        - "source_artifact:pmid-17520797"
        - "source_artifact:pmid-22294820"
        - "source_artifact:pmid-29734997"
        - "source_artifact:pmid-29991438"
        - "source_artifact:pmid-30789439"
        - "source_artifact:pmid-33864369"
        - "source_artifact:pmid-37684151"
        - "source_artifact:pmid-38149978"
    -
      id: "observational-regularity-context"
      label: "Sleep-regularity observational context"
      stance: "context_only"
      summary: "Cohort and review literature links irregular sleep timing with academic, mental-health, cardiovascular, mortality, and cardiometabolic outcomes, but these associations are not causal protocol evidence."
      sourceKeys:
        - "source_artifact:doi-10.1016/j.jacadv.2025.102109"
        - "source_artifact:doi-10.3109/07420528.2011.613137"
        - "source_artifact:pmcid-pmc12404321"
        - "source_artifact:pmcid-pmc6647049"
        - "source_artifact:pmcid-pmc9981680"
        - "source_artifact:pmid-26588182"
        - "source_artifact:pmid-27110481"
        - "source_artifact:pmid-28607474"
        - "source_artifact:pmid-30242174"
        - "source_artifact:pmid-31132578"
        - "source_artifact:pmid-32138974"
        - "source_artifact:pmid-33054339"
        - "source_artifact:pmid-36789869"
        - "source_artifact:pmid-37738616"
        - "source_artifact:pmid-37800322"
        - "source_artifact:pmid-37995126"
        - "source_artifact:pmid-39603689"
    -
      id: "social-jetlag-youth-and-school-context"
      label: "Social jetlag, youth, and school constraints"
      stance: "context_only"
      summary: "Social-jetlag and adolescent sources inform workday/free-day mismatch, school-start constraints, and population mismatch; they should not be converted into adult wake-time-only efficacy claims."
      sourceKeys:
        - "source_artifact:mdpi-social-jetlag-risks-2021-12-15"
        - "source_artifact:pmid-16687322"
        - "source_artifact:pmid-22578422"
        - "source_artifact:pmid-25156998"
        - "source_artifact:pmid-28631524"
        - "source_artifact:pmid-30099352"
        - "source_artifact:pmid-34698705"
        - "source_artifact:pmid-36351658"
        - "source_artifact:pmid-36852716"
        - "source_artifact:pmid-39158856"
        - "source_artifact:pmid-39894021"
    -
      id: "clinical-and-safety-boundaries"
      label: "Clinical, sleepiness, driving, and shift-work boundaries"
      stance: "safety_boundary"
      summary: "Guidelines, sleep-duration consensus, drowsy-driving evidence, circadian and hypersomnolence guidance, bipolar/social-rhythm literature, and shift-work sources define stop conditions and referral boundaries."
      sourceKeys:
        - "source_artifact:aaafoundation-acute-sleep-deprivation-crash-risk-2016-12-01"
        - "source_artifact:doi-10.26616/nioshpub2015115revised042020"
        - "source_artifact:pmcid-pmc4629843"
        - "source_artifact:pmid-17969869"
        - "source_artifact:pmid-19962939"
        - "source_artifact:pmid-22357064"
        - "source_artifact:pmid-24497651"
        - "source_artifact:pmid-26039963"
        - "source_artifact:pmid-26414989"
        - "source_artifact:pmid-26745754"
        - "source_artifact:pmid-27136449"
        - "source_artifact:pmid-27250809"
        - "source_artifact:pmid-28684405"
        - "source_artifact:pmid-29073398"
        - "source_artifact:pmid-29073412"
        - "source_artifact:pmid-30239905"
        - "source_artifact:pmid-33164742"
        - "source_artifact:pmid-34743789"
safety:
  cautionLevel: "moderate"
  avoidOrGetClinicianGuidance:
    - "severe or chronic insomnia, or current CBT-I/sleep restriction treatment without clinician guidance"
    - "suspected obstructive sleep apnea, narcolepsy, central hypersomnolence, or persistent excessive daytime sleepiness"
    - "delayed sleep-wake phase disorder or another circadian rhythm sleep-wake disorder needing phase-shift care"
    - "bipolar disorder, recent mania or hypomania, or mood destabilization with sleep loss"
    - "rotating shift work, long work hours, drowsy commutes, or safety-sensitive duties that conflict with a single wake window"
    - "adolescents whose school start time or family context would force inadequate sleep opportunity"
  stopIf:
    - "the wake window repeatedly causes short sleep or worsening daytime sleepiness"
    - "you are sleepy before driving, commuting, operating machinery, or safety-sensitive work"
    - "persistent excessive sleepiness, severe insomnia, snoring with witnessed apneas, or other sleep-disorder red flags emerge"
    - "mania, hypomania, risky activation, severe irritability, or mood destabilization emerges"
    - "illness, travel, caregiving, shift work, or acute stress makes the target unsafe or uninterpretable"
  notes:
    - "Safety overrides adherence. Recovery sleep after short sleep is not a protocol failure."
    - "This page does not make seizure-specific claims because the extraction did not identify source-supported seizure guidance for this protocol."
---

## What this tests

Consistent Wake Time tests whether a stable wake/rise window makes your sleep timing more regular without stealing sleep.

The clean win is not “woke up early.” The clean win is: wake-time variability drops, enough sleep is preserved, daytime sleepiness does not worsen, and the change is not explained by travel, illness, shift work, late caffeine, alcohol, naps, or device error.

## What to compare

Use the 7-day baseline as your normal schedule. During the 28-day intervention, compare:

- wake-time variability and days inside the target window,
- total sleep time or sleep opportunity,
- daytime sleepiness or alertness,
- sleep efficiency and sleep-onset latency as secondary signals,
- and major confounders such as naps, alcohol, caffeine, light exposure, stress, illness, travel, and work or school constraints.

## Interpretation

A useful result is a repeated-window trend, not one perfect morning. If wake-time consistency improves but sleep duration drops or daytime sleepiness worsens, interpret that as a safety miss, not a successful protocol.

The research landscape is intentionally conservative. Direct evidence is small and mixed, often regularizing both bedtime and wake time. Observational regularity and social-jetlag studies are useful context, but they do not prove that this protocol prevents disease or improves long-term clinical outcomes.

## Boundaries

Do not use this protocol as sleep restriction, insomnia treatment, circadian phase treatment, or a way to push through dangerous sleepiness. When safety and regularity conflict, choose sleep and safety.
