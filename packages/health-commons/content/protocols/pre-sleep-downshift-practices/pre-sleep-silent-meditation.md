---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:pre-sleep-downshift-practices/pre-sleep-silent-meditation
slug: protocols/pre-sleep-downshift-practices/pre-sleep-silent-meditation
title: Silent Meditation Before Bed
summary: "Sit quietly for a brief unguided meditation near bedtime and test whether it lowers perceived pre-sleep wiredness or sleep-onset latency, while treating wearable changes as exploratory."
status: draft
quality: usable
aliases:
  - pre-sleep silent meditation
  - silent meditation before bed
  - bedtime silent meditation
  - unguided meditation before sleep
  - quiet mindfulness before bed
  - pre-sleep mindfulness
  - no-audio bedtime meditation
categories:
  - sleep
  - meditation
  - mindfulness
  - pre-sleep-downshift
  - evening-routine
  - wearable-measured
  - murph-canonical
relations:
  -
    type: parent_family
    target: experiment_family:pre-sleep-downshift-practices
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
lineage:
  relationship: root
  rationale: "Murph canonical no-audio, no-app pre-sleep downshift variant; guided meditation, mindfulness courses, breathwork, PMR, yoga nidra, CBT-I, and commercial app protocols stay separate adjacent variants."
attribution:
  ownerType: murph
  note: Canonical Health Commons implementation synthesized from the pre-sleep silent meditation research package; not an external named protocol.
protocol:
  doseSignature: Nightly · 10 min · silent unguided breath/body awareness · last 30 min before intended bedtime · 14-night intervention after 7-day baseline
  target: pre-sleep cognitive arousal and perceived sleep-onset latency
  frequency:
    sessionsPerWeek: 7
  durationMinutes:
    min: 10
    max: 10
  interventionSessionsMinimum: 10
  interventionSessionsTarget: 12
  steps:
    - Choose a 10-minute window in the last 30 minutes before intended bedtime; use the same window during the test when possible.
    - "Prefer a chair or the edge of the bed. Use in-bed practice only if it does not make you lie awake, try harder to sleep, or blur meditation with sleep tracking; keep the room dim and the posture comfortable."
    - "Keep the practice silent, unguided, and free of audio, app lessons, music, breath pacing, supplements, or other new sleep interventions."
    - "Set a quiet timer, let breathing stay natural, and rest attention on a simple breath, body, contact-point, room-sound, or eyes-open soft-gaze anchor without trying to force sleepiness."
    - "If breath or body attention increases panic, trauma memories, dissociation, disorientation, fear of losing control, or distress, stop the session rather than pushing through."
    - "When planning, worry, or sleep-effort thoughts appear, notice them briefly, label them as thinking or worrying if useful, and return to the chosen neutral anchor."
    - "When the timer ends, stop the practice; do not repeat or extend the session to chase sleep."
    - "Make a quick log entry for minutes practiced, pre-bed wiredness, estimated sleep-onset latency, and any adverse or activating effects. If no stop condition occurred, proceed with the normal bedtime routine."
  tips:
    - "Keep caffeine timing, alcohol, late exercise, screens, bedtime, wake time, and sleep environment as stable as possible across baseline and intervention nights."
    - Use a neutral timer and avoid checking sleep scores during the session window.
    - "If silent attention practice makes you try harder to sleep, shorten the next session to 5 minutes or stop the experiment rather than increasing the dose."
    - "If in-bed practice makes wearable sleep-onset estimates hard to interpret, switch to a chair or edge-of-bed posture and log the location."
    - "Do not use the practice as a way to force sleep. If you are awake and frustrated after the timer, stop meditating and follow your usual insomnia plan or do a quiet low-light activity outside the bed."
    - "If the practice feels physically uncomfortable, creates pain, shortness of breath, dizziness, or chest symptoms, stop and do not restart that night."
    - "Do not increase the duration after a bad night. A worse night means shorten, pause, or stop, not meditate harder."
  keepInMind:
    - "The direct evidence base for unguided silent meditation immediately before bed is not established; this is a low-burden personal experiment, not a treatment claim."
    - "Guided apps, CBT-I, sleep hygiene, breathwork, progressive muscle relaxation, yoga nidra, mindfulness courses, and commercial sleep programs are adjacent variants and should not be merged into this protocol’s efficacy claim."
    - "The cleanest read is repeated manual sleep-onset latency plus pre-bed wiredness or rumination; wearable sleep efficiency, HRV, resting heart rate, and sleep stages are supportive or exploratory."
    - "Persistent insomnia, suspected untreated sleep apnea, severe psychiatric symptoms, trauma activation, dissociation, mania/psychosis vulnerability, suicidal thoughts, or major functional impairment require clinician guidance rather than unsupervised experimentation."
    - "The 10-minute dose, last-30-minute timing window, 7-night baseline, 14-night intervention, and 10-of-14 minimum adherence target are pragmatic self-experiment defaults, not an extracted optimal dose, timing, or minimum effective exposure."
  logFields:
    - meditation start time
    - meditation minutes
    - practice location and posture
    - intended bedtime
    - lights-out time
    - estimated minutes to fall asleep
    - pre-bed wiredness 0-10
    - rumination or worry 0-10
    - sleep quality 0-10
    - morning wearable sleep-onset estimate if available
    - wearable sleep efficiency if available
    - caffeine after noon
    - alcohol in last 24 hours
    - late exercise
    - screen exposure in last hour
    - "unusual stress, illness, travel, or schedule shift"
    - "new sleep intervention, medication, or supplement change"
    - adverse effects or activating effects
    - final wake time
    - out-of-bed time
    - daytime nap timing and duration
    - time awake in bed after the meditation timer ended
    - whether you repeated or extended the session after the timer
    - "sleep medication, melatonin, antihistamine, hypnotic, sedative, pain medication, or other sleep-affecting medication used that day, including timing and dose if easy"
    - "recreational substance use, withdrawal, or unusual intoxication"
    - "other meditation, mindfulness, breathwork, yoga nidra, PMR, CBT-I, sleep app, or relaxation practice that day"
    - wearable device model and app or algorithm changes
    - "wearable not worn, low battery, changed device, or unusual sensor issue"
    - "bedroom noise, light, temperature, partner, child, pet, or unusual sleep-environment disruption"
    - "pain flare, shortness of breath, illness symptoms, nocturia, or other physical symptom that affected sleep"
    - "adverse-effect type, intensity 0-10, duration, whether it carried into the next day, and whether it impaired functioning"
    - reason for stopping early or skipping the session
  stopConditions:
    - "Sleep-onset latency, total sleep time, pre-bed wiredness, or functional next-day impairment is clearly worse for 3 consecutive intervention nights."
    - "The practice increases anxiety, panic, rumination, intrusive thoughts, frustration, sleep effort, or compulsive tracking."
    - "You feel confused, disoriented, unreal, detached from yourself, detached from the world, afraid of losing control, or distressed in a way that carries into the next day."
    - "You experience dissociation, depersonalization, derealization, traumatic memories, flashbacks, trauma activation, or unusually distressing mental content."
    - "You notice mood elevation, agitation, racing thoughts, markedly reduced need for sleep, hallucinations, unusual beliefs, altered reality testing, or other psychosis- or mania-like symptoms."
    - "You develop new or worsening suicidal thoughts, self-harm thoughts, severe depression, or loss of functioning; stop immediately and seek appropriate urgent support."
    - "You develop pain, shortness of breath, dizziness, chest symptoms, or other physical symptoms during the practice."
    - You find yourself repeating or extending the session in bed to chase sleep.
    - "Logging or meditation becomes burdensome, compulsive, or more important than sleep itself."
  safetyNotes:
    - Stop rules override adherence targets.
    - "This is not a substitute for CBT-I, medical evaluation for sleep apnea, or mental-health care."
testPlans:
  -
    planId: sol-arousal-21d
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
      - Compare the 14-night intervention average with the 7-night baseline for manual perceived sleep-onset latency and pre-bed wiredness.
      - "Treat wearable sleep-onset latency, sleep efficiency, deep sleep, HRV, and resting heart rate as repeated-night context, not one-night proof."
      - "Keep other sleep interventions and major evening routines stable; flag caffeine, alcohol, late exercise, illness, travel, stress, and medication or supplement changes."
experimentOnboarding:
  schemaVersion: murph.commons.experiment-onboarding.v1
  startIntent:
    displayPrompt: "Hey Murph, I want to explore doing silent meditation before bed."
    intentSummary: Explore Silent Meditation Before Bed.
  contextReview:
    vaultChecks:
      -
        id: active-experiments
        label: Active sleep or recovery experiments
        reason: Avoid overlapping new sleep interventions that would make the result hard to interpret.
        freshnessDays: 7
        readHints:
          - experiment list --status active
      -
        id: wearable-sleep-baseline
        label: Recent wearable sleep baseline
        reason: "Use recent sleep-onset, sleep-efficiency, HRV, resting-heart-rate, and deep-sleep trends as exploratory context."
        freshnessDays: 21
        readHints:
          - wearables sleep summary
          - wearables recovery summary
      -
        id: sleep-routine-context
        label: Bedtime routine and confounders
        reason: "Bedtime, caffeine, alcohol, screens, exercise, stress, illness, and travel can dominate sleep-onset signals."
        freshnessDays: 30
        readHints:
          - memory search sleep routine
          - journal search bedtime caffeine alcohol screens exercise stress
      -
        id: mental-health-and-meditation-safety
        label: Meditation and psychiatric safety context
        reason: "Some users need clinician guidance before unsupervised silent practice, especially near bedtime."
        freshnessDays: 90
        readHints:
          - memory search meditation adverse reaction bipolar mania psychosis dissociation trauma panic suicidality
    notes:
      - "Use existing context first, then ask only for missing or stale setup details."
      - Do not create reminders or automations unless the user opts in.
  safetyScreen:
    cautionLevel: moderate
    mode: ask_compact_then_expand_if_positive
    dispositionIfAnyPositive: clinician_guidance_before_unsupervised_start
    mustAsk:
      -
        id: mania-psychosis-risk
        prompt: "Any history of bipolar disorder, mania or hypomania, psychosis, hallucinations, unusual beliefs, markedly reduced need for sleep, or current agitation?"
        ifPositive: do_not_start_unsupervised
        why: Mania- or psychosis-like symptoms are red-line stop conditions for an unsupervised bedtime meditation experiment.
      -
        id: dissociation-trauma-panic-risk
        prompt: "Any PTSD, trauma re-experiencing, panic attacks, fear of losing control, or breath/body-focus anxiety even if you have not tried meditation before?"
        ifPositive: clinician_guidance_before_unsupervised_start
        why: The protocol should stay brief or be avoided when attention practice activates distressing or dissociative experiences.
      -
        id: suicidality-severe-depression
        prompt: "Any current suicidal thoughts, self-harm thoughts, severe depression, or major functional impairment?"
        ifPositive: do_not_start_unsupervised
        why: Meditation is not a substitute for urgent mental-health support.
      -
        id: persistent-insomnia-or-osa-concern
        prompt: "Do you have persistent insomnia, suspected untreated sleep apnea, loud snoring with pauses, or sleepiness that is impairing daily life?"
        ifPositive: clinician_guidance_before_unsupervised_start
        why: A self-experiment should not delay evidence-based insomnia care or medical evaluation.
      -
        id: past-meditation-adverse-reaction
        prompt: "Have you previously had a bad reaction to meditation, mindfulness, breath attention, retreats, or silent practice?"
        ifPositive: clinician_guidance_before_unsupervised_start
        why: Past adverse reactions are a practical boundary for unsupervised bedtime practice.
      -
        id: epilepsy-neurologic-cognitive-risk
        prompt: "Any epilepsy or seizure disorder, cognitive impairment, dementia, major neurologic condition, or need for caregiver-supported practice?"
        ifPositive: clinician_guidance_before_unsupervised_start
        why: Neurologic and cognitive contexts may need adapted or supported practice rather than ordinary self-guided bedtime meditation.
      -
        id: perinatal-complexity
        prompt: "Are you pregnant, postpartum, or dealing with perinatal sleep or mental-health complexity?"
        ifPositive: clinician_guidance_before_unsupervised_start
        why: Pregnancy and postpartum sleep contexts need population-specific guidance rather than general adult protocol assumptions.
      -
        id: substance-use-or-withdrawal
        prompt: "Any active substance-use disorder, withdrawal, intoxication, or addiction-related instability that could affect sleep or mental state?"
        ifPositive: clinician_guidance_before_unsupervised_start
        why: "Substance use, withdrawal, and addiction instability can confound sleep and increase safety uncertainty."
      -
        id: major-medical-sleep-driver
        prompt: "Is pain, shortness of breath, cancer-related symptoms, MS, stroke/heart disease, or another major medical issue currently driving your sleep problem?"
        ifPositive: clinician_guidance_before_unsupervised_start
        why: Medical comorbidity sleep problems need condition-specific care and should not be treated as an ordinary wellness self-experiment.
      -
        id: youth-or-caregiver-context
        prompt: "Is this for a child or adolescent, or someone who needs caregiver support to do the practice safely?"
        ifPositive: clinician_guidance_before_unsupervised_start
        why: Youth and caregiver-supported contexts require separate variants and should not be generalized from the adult protocol.
    stopIf:
      inheritFromProtocolSafety: true
      additionalConditions:
        - "The practice becomes a source of sleep pressure, rumination, or compulsive tracking."
        - The user reports any red-line mental-health symptom during the experiment.
    notes:
      - "Positive screens do not diagnose anything; they decide whether the protocol should be skipped, shortened, or clinician-guided."
  setupSlots:
    -
      id: bedtime-anchor
      label: Target bedtime
      purpose: logistics
      valueType: local_time
      askPolicy: ask_if_unknown_or_stale
      required: true
      question: What time are you usually trying to be in bed or lights-out during this experiment?
      target:
        object: experimentRun
        field: bedtimeAnchor
    -
      id: session-window
      label: Meditation timing window
      purpose: logistics
      valueType: enum
      askPolicy: ask_if_unknown
      required: true
      question: When should the 10-minute silent meditation usually happen relative to bedtime?
      options:
        - last15min
        - last30min
        - last60min
      constraints:
        preferredDefault: last30min
      target:
        object: experimentRun
        field: sessionWindow
    -
      id: session-duration
      label: Session duration
      purpose: adherence
      valueType: enum
      askPolicy: ask_if_unknown
      required: true
      question: How long should each silent session be?
      options:
        - five-minutes
        - ten-minutes
      constraints:
        preferredDefault: ten-minutes
        defaultMinutes: 10
        doNotEscalateForSleep: true
      target:
        object: experimentRun
        field: sessionDuration
    -
      id: practice-location
      label: Practice location
      purpose: measurement_fidelity
      valueType: enum
      askPolicy: ask_if_unknown
      required: true
      question: Where will you usually do the silent meditation?
      options:
        - chair
        - edge-of-bed
        - in-bed
      constraints:
        preferredDefault: chair
      target:
        object: experimentRun
        field: practiceLocation
    -
      id: measurement-path
      label: Measurement path
      purpose: measurement_fidelity
      valueType: enum
      askPolicy: ask_if_unknown
      required: true
      question: Do you want diary-only tracking or diary plus wearable context?
      options:
        - diary-only
        - diary-plus-wearable
      constraints:
        preferredDefault: diary-plus-wearable
      target:
        object: analysisPlan
        field: measurementPath
    -
      id: reminder-policy
      label: Reminder preference
      purpose: assistant_support
      valueType: reminder_policy
      askPolicy: ask_at_confirmation
      required: true
      question: "Would you like no reminders, a pre-bed reminder, or a pre-bed reminder plus a morning missing-log nudge?"
      options:
        - none
        - pre-bed-reminder
        - pre-bed-plus-morning-missing-log
      constraints:
        preferredDefault: none
      target:
        object: assistantSupport
        field: reminderPolicy
  adaptationPolicy:
    fields:
      -
        id: adapt-session-duration
        label: Session duration
        target:
          object: experimentRun
          field: sessionDuration
        sourceSlotIds:
          - session-duration
        requiredForRunSpec: true
        protocolReusable: true
        guidance: Default to 10 minutes; 5 minutes is allowed after arousal or burden. Do not offer 30 minutes inside the ordinary protocol; longer sessions require a separate higher-burden variant and should never be used to chase sleep.
      -
        id: adapt-practice-location
        label: Practice location
        target:
          object: experimentRun
          field: practiceLocation
        sourceSlotIds:
          - practice-location
        requiredForRunSpec: true
        protocolReusable: true
        guidance: Use a consistent location; prefer chair or edge-of-bed if in-bed quiet wakefulness confounds wearable sleep onset.
      -
        id: adapt-session-window
        label: Session timing window
        target:
          object: experimentRun
          field: sessionWindow
        sourceSlotIds:
          - session-window
        requiredForRunSpec: true
        protocolReusable: true
        guidance: Use the last 30 minutes before intended bedtime by default; do not move later if it increases sleep pressure.
    measurementPlan:
      testPlanId: sol-arousal-21d
      requiredSignals:
        - biomarker:sleep-onset-latency
      optionalSignals:
        - biomarker:sleep-efficiency
        - biomarker:deep-sleep-minutes
        - biomarker:hrv-rmssd
        - biomarker:resting-heart-rate
      notes:
        - Pre-bed wiredness and rumination are protocol-local log fields until separate biomarker pages exist.
        - "Wearable outputs are context and trend signals, not diagnostic confirmation."
    reusableSetup:
      enabled: true
      sourceSlotIds:
        - bedtime-anchor
        - session-window
        - session-duration
        - practice-location
        - measurement-path
      notes:
        - Reuse setup only for adjacent pre-sleep downshift variants when the intervention remains low stimulation and pre-bed.
  planDefaults:
    testPlanId: sol-arousal-21d
    baselineDays: 7
    interventionDays: 14
    sessionsPerWeek: 7
    targetSessions: 12
    minimumUsefulSessions: 10
    firstSessionGuidance: "Start with 10 minutes of silent, unguided breath or body awareness. Stop and log it if the session increases arousal, rumination, panic, dissociation, or sleep effort."
  logging:
    sessionFields:
      - meditation-start-time
      - meditation-minutes
      - practice-location
      - estimated-sleep-onset-minutes
      - pre-bed-wiredness-0-10
      - rumination-0-10
      - sleep-quality-0-10
      - adverse-effects
      - morning-wearable-sleep-onset
    confounders:
      - caffeine-after-noon
      - alcohol-last-24h
      - late-exercise
      - screens-last-hour
      - unusual-stress
      - illness
      - travel-timezone-shift
      - new-sleep-intervention
      - medication-or-supplement-change
    notes:
      - "Morning missing logs should ask for a quick estimate, not a detailed forensic reconstruction."
      - Adverse or activating effects should be shown in review even if sleep score improved.
  assistantPolicy:
    maxSetupQuestionsPerTurn: 2
    askBeforeCreatingAutomations: true
    missedLogFollowup: opt_in_only
    reminderOptions:
      - none
      - pre-bed-reminder
      - pre-bed-plus-morning-missing-log
    weeklyDigestDefault: true
    missedLogFollowupCopy: You missed last night’s silent-meditation log. Add a quick estimate only if it is easy.
    confirmationPrompt: "Create a 7-day baseline plus 14-night Silent Meditation Before Bed experiment, with stop rules active and wearable data treated as exploratory?"
whyItWorks:
  - "The mechanistic rationale is pre-sleep arousal downshift: structured mindfulness exposures have reduced cognitive-emotional or pre-sleep arousal in adjacent sources, but not as isolated silent bedtime meditation. Source keys: source_artifact:doi-10.1007-s12671-018-0911-6; source_artifact:doi-10.1007-s12671-019-01217-4; source_artifact:doi-10.1016-j.aimed.2024.08.005."
  - "Sleep evidence for mindfulness is promising but heterogeneous, so the protocol tests a personal signal rather than claiming insomnia treatment. Source keys: source_artifact:pmid-27663102; source_artifact:pmid-30380915; source_artifact:pmid-32590218; source_artifact:pmid-36150798; source_artifact:healthquality-va-gov-insomnia-osa-cpg-2025-04-22."
  - "Manual sleep-onset and pre-sleep wiredness logging is prioritized because actigraphy and consumer wearables can misclassify quiet wakefulness and vary across devices and populations. Source keys: source_artifact:pmid-12927124; source_artifact:pmid-14655927; source_artifact:pmid-17969470; source_artifact:pmid-30789439; source_artifact:pmid-31778122."
claims:
  -
    claimId: direct-silent-bedtime-evidence-not-established
    type: evidence_scope
    text: "The available corpus does not directly establish that unguided silent meditation immediately before bed improves sleep; the closest timing records are app-guided, video-guided, VR-based, registry-only, supervised, historical, or population-mismatched, and timing-close findings include mixed or null sleep-duration and objective-sleep results."
    strength: high
    sourceKeys:
      - source_artifact:pmid-41027036
      - source_artifact:clinicaltrials-nct06972303-2026-02-23
      - source_artifact:isrctn-15770131-2024-06-24
      - source_artifact:doi-10.1016-s0005-7894-76-80064-0
      - source_artifact:pmid-29706914
      - source_artifact:pmid-40194914
      - source_artifact:pmid-39500303
      - source_artifact:pmid-41502784
    caveats:
      - "A timing-close app-guided pilot and planned bedtime-meditation registry are useful for disambiguation, but they are not completed unguided silent-bedtime efficacy evidence."
      - The 1970s meditation-training study used clinical treatment training and showed no active-treatment advantage over relaxation.
  -
    claimId: presleep-arousal-target-is-plausible-but-mixed
    type: mechanistic
    text: "The strongest protocol rationale is a pre-sleep arousal or rumination downshift: structured mindfulness exposures have reduced cognitive-emotional or pre-sleep arousal in several sources, while sleep-continuity and objective-device effects remain mixed or null."
    strength: moderate
    sourceKeys:
      - source_artifact:doi-10.1007-s12671-018-0911-6
      - source_artifact:doi-10.1007-s12671-019-01217-4
      - source_artifact:doi-10.1016-j.aimed.2024.08.005
      - source_artifact:pmid-35420589
      - source_artifact:pmid-35503653
    caveats:
      - "Most evidence comes from courses, therapy packages, or app/text-guided programs, not silent pre-bed practice."
      - Objective sleep continuity should be framed as exploratory rather than promised.
  -
    claimId: mindfulness-sleep-evidence-is-promising-but-not-standalone-insomnia-treatment
    type: mixed_evidence
    text: "Mindfulness-based interventions show promising but heterogeneous sleep evidence, with benefits more consistent for self-reported sleep quality or insomnia symptoms than for sleep-onset latency, total sleep time, or sleep efficiency; chronic-insomnia guidelines still do not confirm mindfulness meditation as a standalone primary insomnia treatment."
    strength: high
    sourceKeys:
      - source_artifact:pmid-27663102
      - source_artifact:pmid-30380915
      - source_artifact:pmid-32590218
      - source_artifact:pmid-36150798
      - source_artifact:healthquality-va-gov-insomnia-osa-cpg-2025-04-22
      - source_artifact:va-dod-insomnia-osa-guideline-2019-10-01
      - source_artifact:pmid-33164742
      - source_artifact:pmid-24395850
    caveats:
      - Do not present this self-experiment as treatment for chronic insomnia or as equivalent to CBT-I.
      - Positive meta-analytic signals do not identify a silent bedtime dose or best-fit user.
  -
    claimId: measurement-plan-should-pair-diary-with-wearables
    type: design_guardrail
    text: "Pair a one-tap diary for perceived sleep onset, pre-bed wiredness, and practice completion with wearable sleep-onset and sleep-efficiency trends, because actigraphy and consumer wearables can misclassify quiet wakefulness and are not diagnostic proof of sleep improvement."
    strength: high
    sourceKeys:
      - source_artifact:pmid-12927124
      - source_artifact:pmid-14655927
      - source_artifact:pmid-17969470
      - source_artifact:pmid-27707448
      - source_artifact:pmid-29991437
      - source_artifact:pmid-29734997
      - source_artifact:pmid-30789439
      - source_artifact:pmid-31778122
    caveats:
      - "Sleep-stage, HRV, and total-sleep-time changes should be exploratory unless repeated and not obviously confounded."
      - Pre-sleep cognitive arousal/wiredness may need a new Health Commons outcome or log field rather than an existing biomarker page.
  -
    claimId: dose-and-adherence-should-be-bounded-and-logged
    type: design_guardrail
    text: "Because mindfulness dose, homework adherence, and practice-outcome relationships are heterogeneous, use a bounded low-burden session and log actual minutes, bedtime proximity, missed sessions, and burden rather than claiming that longer or more intense practice is better."
    strength: moderate
    sourceKeys:
      - source_artifact:doi-10.1891-0889-8391.23.3.198
      - source_artifact:pmid-28527330
      - source_artifact:pmid-17899351
      - source_artifact:pmid-18469160
      - source_artifact:doi-10.1111-joop.12115
      - source_artifact:pmid-30708288
      - source_artifact:pmid-37304656
    caveats:
      - The extraction does not establish an optimal silent pre-bed duration.
      - "A low-burden protocol is an implementation choice for experiment fidelity, not a source-proven minimum effective dose."
  -
    claimId: app-guided-and-commercial-claims-are-adjacent-variants
    type: evidence_scope
    text: "App-guided mindfulness, text-delivered mindfulness, and commercial app sleep programs are adjacent or related variants, not direct evidence for this silent unguided bedtime protocol."
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-41027036
      - source_artifact:pmid-36125880
      - source_artifact:pmid-40267472
      - source_artifact:pmid-35420589
      - source_artifact:pmid-39213858
      - source_artifact:pmid-41862627
    caveats:
      - "Some app evidence is positive, but app content often bundles guidance, CBT-I elements, prompts, wearables, or commercial implementation effects."
      - The Calm and Headspace web-page ledger records lacked matching findings/appraisals in the allowed corpus and should not support protocol claims until extracted.
  -
    claimId: special-populations-are-boundaries-not-generalizable-proof
    type: design_guardrail
    text: "Special-population and clinical-condition sources are context or safety-boundary evidence, not generalizable proof that a general adult silent-bedtime meditation protocol works."
    strength: high
    sourceKeys:
      - source_artifact:isrctn-15770131-2024-06-24
      - source_artifact:pmid-24395850
      - source_artifact:pmid-37434109
      - source_artifact:pmid-25686304
      - source_artifact:pmid-34162788
      - source_artifact:pmid-34735517
      - source_artifact:pmid-29787483
      - source_artifact:pmid-35582336
    caveats:
      - "Cancer, MS, older-adult, perinatal, bipolar, postmenopausal, mental-disorder, stroke, and heart-disease contexts have different baseline risks and supervision needs."
      - "Some special-population findings are positive, mixed, null, or safety-only; preserve those differences rather than flattening them into a general efficacy claim."
  -
    claimId: safety-screen-and-stop-rules-are-needed
    type: safety
    text: "This protocol is designed to be brief and low-burden, but meditation and mindfulness are not risk-free; compact screening and stop rules are needed for severe psychiatric vulnerability, mania or psychosis history, dissociation, escalating anxiety or rumination, mood destabilization, and sleep worsening."
    strength: high
    sourceKeys:
      - source_artifact:nccih-meditation-mindfulness-safety-2022-06-03
      - source_artifact:doi-10.1007-s12671-011-0079-9
      - source_artifact:pmid-30638824
      - source_artifact:pmid-32820538
      - source_artifact:pmid-41176868
      - source_artifact:doi-10.1080-713685624
      - source_artifact:pmid-31668156
      - source_artifact:pmid-10743
      - source_artifact:pmid-28873417
      - source_artifact:doi-10.1177-21677026241298269
      - source_artifact:pmid-24607768
      - source_artifact:pmid-35464906
    caveats:
      - "Case reports and surveys do not estimate risk for a brief bedtime self-experiment, but they justify warnings and stop conditions."
      - Safety evidence is limited by heterogeneous adverse-event definitions and incomplete harms reporting.
  -
    claimId: brief-dose-and-stop-if-arousal-increases
    type: design_guardrail
    text: "Keep the practice brief and do not escalate dose when meditation increases arousal, rumination, anxiety, panic, intrusive thoughts, or worsened sleep."
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-30708288
      - source_artifact:pmid-31071152
      - source_artifact:pmid-34385088
      - source_artifact:pmid-29599851
      - source_artifact:sleepfoundation-meditation-sleep-2024-02-26
      - source_artifact:pmid-28873417
    caveats:
      - "Several sources are conceptual, cross-sectional, or consumer guidance rather than bedtime protocol trials."
      - "This claim supports a safety design rule, not a quantified risk estimate."
      - The protocol should separate transient discomfort from persistent sleep worsening or impaired functioning.
  -
    claimId: mania-psychosis-red-line
    type: safety
    text: "Bipolar disorder or mania history, schizophrenia or psychosis vulnerability, unusual beliefs, hallucinations, altered reality testing, marked agitation, or reduced need for sleep are clinician-guidance boundaries; emerging mania- or psychosis-like symptoms should end the self-experiment."
    strength: high
    sourceKeys:
      - source_artifact:doi-10.1080-713685624
      - source_artifact:pmid-31668156
      - source_artifact:pmid-17848828
      - source_artifact:pmid-34426774
      - source_artifact:pmid-380368
      - source_artifact:pmid-1151361
      - source_artifact:pmid-38851179
      - source_artifact:pmid-35048869
    caveats:
      - Several severe-event sources are case reports or case-based reviews and cannot establish incidence.
      - "Supervised psychosis-MBI RCT evidence is cautiously reassuring in some indices, but harm reporting remains incomplete and does not support unguided self-escalation."
      - "The strength is high as a safety boundary because potential consequences are severe, not because bedtime-specific risk is quantified."
  -
    claimId: suicidality-and-severe-depression-urgent-care-boundary
    type: safety
    text: "New, worsened, or persistent suicidal thoughts, self-harm thoughts, severe depression, or functional impairment during meditation should trigger immediate discontinuation and appropriate urgent support; the protocol should not present meditation as a substitute for care."
    strength: high
    sourceKeys:
      - source_artifact:pmid-32820538
      - source_artifact:pmid-41176868
      - source_artifact:nccih-meditation-mindfulness-safety-2022-06-03
    caveats:
      - The extracted sources identify suicidality and severe adverse-effect categories but do not quantify risk for brief bedtime practice.
      - "This is an escalation and safety boundary, not evidence that meditation causes suicidality in typical bedtime users."
  -
    claimId: primary-endpoints-manual-sol-and-presleep-arousal
    type: design_guardrail
    text: "The primary read should be manual perceived sleep-onset latency plus pre-sleep cognitive/somatic arousal or wiredness, because PSAS sources separate cognitive and somatic arousal, cognitive arousal is linked to sleep-onset difficulty, and the Consensus Sleep Diary standardizes prospective self-monitoring of sleep timing, latency, awakenings, continuity, duration, and perceived sleep quality."
    strength: high
    sourceKeys:
      - source_artifact:pmid-4004706
      - source_artifact:pmid-22281450
      - source_artifact:pmid-22294820
      - source_artifact:pmid-21963535
    caveats:
      - "These are measurement and mechanism sources, not direct protocol-efficacy trials."
      - A brief one-tap arousal score may be more feasible than a full PSAS in a consumer self-experiment.
  -
    claimId: consumer-wearable-sleep-stages-exploratory
    type: design_guardrail
    text: "Consumer wearable sleep-stage outputs should stay exploratory because device generation, proprietary algorithms, population differences, wake detection, and sleep-staging limitations constrain inference; gross sleep duration and timing trends are more defensible than claims about deep sleep, REM, or architecture."
    strength: high
    sourceKeys:
      - source_artifact:pmid-30789439
      - source_artifact:pmid-31778122
      - source_artifact:pmid-33378539
      - source_artifact:pmid-37917155
      - source_artifact:pmid-38557808
      - source_artifact:pmid-40300398
    caveats:
      - Do not score the protocol on a wearable deep-sleep or REM change.
      - Record the device model and avoid mixing outputs from different devices or algorithm generations.
      - "Consumer trackers should not replace medical evaluation, diagnosis, or treatment."
  -
    claimId: outcome-log-should-include-worsening-sleep-and-adverse-experiences
    type: safety
    text: "The outcome log should include worsening sleep, increased arousal or anxiety, intrusive or distressing mental experiences, and functional disruption so safety signals are not hidden behind a sleep-score average."
    strength: moderate
    sourceKeys:
      - source_artifact:nccih-mind-body-practices-sleep-disorders-2026-04-27
      - source_artifact:sleepfoundation-meditation-sleep-2024-02-26
      - source_artifact:doi-10.1007-s12671-018-0897-0
      - source_artifact:pmid-35174010
    caveats:
      - Consumer-facing safety guidance is not trial-level quantification.
      - Low reported adverse-event rates in MBSR or MBCT RCTs cannot establish absence of harm because ascertainment was incomplete.
      - "This claim belongs as a measurement and stop-rule guardrail, not as a claim that the protocol is dangerous for most users."
  -
    claimId: dissociation-trauma-and-disorientation-stop-boundary
    type: safety
    text: "Feelings of unreality, depersonalization, derealization, disorientation, fear of losing control, trauma re-experiencing, traumatic memories, or distress that persists into the next day should be treated as stop-and-seek-support signals rather than effects to push through."
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-10743
      - source_artifact:pmid-34074221
      - source_artifact:pmid-39514882
      - source_artifact:pmid-41176868
      - source_artifact:sleepfoundation-meditation-sleep-2024-02-26
      - source_artifact:sleepfoundation-relaxation-exercises-sleep-2025-07-24
    caveats:
      - "These sources are broader meditation safety, survey, consumer-guidance, or case evidence, not bedtime-specific incidence estimates."
  -
    claimId: active-harm-monitoring-and-discontinuation
    type: design_guardrail
    text: "The protocol should log unwanted effects, intensity, duration, next-day functional impact, and discontinuation reasons so adverse effects are not hidden behind a sleep-score average."
    strength: high
    sourceKeys:
      - source_artifact:pmid-35174010
      - source_artifact:pmid-35464906
      - source_artifact:pmid-33747251
      - source_artifact:pmid-30638824
      - source_artifact:pmid-35048869
      - source_artifact:pmid-24607768
    caveats:
      - "This is a monitoring-method claim, not a protocol efficacy claim."
  -
    claimId: do-not-delay-insomnia-osa-or-mental-health-care
    type: safety
    text: "Silent meditation before bed should not be presented as treatment for chronic insomnia, suspected obstructive sleep apnea, medically driven sleeplessness, suicidality, severe depression, mania, psychosis, or trauma-related impairment, and a failed self-experiment should not delay appropriate clinical care."
    strength: high
    sourceKeys:
      - source_artifact:healthquality-va-gov-insomnia-osa-cpg-2025-04-22
      - source_artifact:va-dod-insomnia-osa-guideline-2019-10-01
      - source_artifact:pmid-18853708
      - source_artifact:pmid-32066145
      - source_artifact:pmid-33164742
      - source_artifact:pmid-32820538
      - source_artifact:pmid-41176868
    caveats:
      - "This is a clinical-boundary claim, not evidence that brief bedtime meditation causes these conditions."
  -
    claimId: special-populations-need-separate-variants
    type: safety
    text: "Pregnancy/postpartum, pediatric/youth, cognitive impairment or dementia, epilepsy/seizure disorder, major neurologic or medical disease, MS, chronic pain, cancer, stroke/heart disease, bipolar disorder, psychosis, and trauma/panic contexts should not be generalized from ordinary adult silent-bedtime meditation and need population-specific or clinician-guided variants."
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-34162788
      - source_artifact:pmid-32944276
      - source_artifact:pmid-39942485
      - source_artifact:sleepfoundation-relaxation-exercises-sleep-2025-07-24
      - source_artifact:pmid-37434109
      - source_artifact:pmid-39514882
      - source_artifact:pmid-37244384
      - source_artifact:isrctn-15770131-2024-06-24
      - source_artifact:pmid-34735517
      - source_artifact:pmid-38851179
      - source_artifact:pmid-27775416
      - source_artifact:pmid-29101843
      - source_artifact:pmid-30345511
    caveats:
      - "The cited sources are population-specific and often supervised, bundled, observational, registry-only, or otherwise indirect."
researchLandscape:
  bottomLine: "Evidence is indirect and mixed: the strongest rationale is downshifting pre-sleep arousal or rumination, while direct completed evidence for unguided silent meditation immediately before bed is not established."
  confidenceLabel: limited
  primaryClaim: "A brief silent routine is reasonable as a personal downshift test for perceived sleep-onset latency and wiredness, not as a treatment claim."
  mainCaveat: "Most evidence comes from structured mindfulness programs, app-guided or digital variants, reviews, guidelines, measurement papers, safety reports, trial registries, or special populations."
  groups:
    -
      id: presleep-arousal-rumination-mechanisms
      label: "Pre-sleep arousal mechanism, closest extracted records"
      stance: mixed
      summary: "Use this as the page’s most direct mechanistic bucket. Course-based or therapy-package mindfulness reduced pre-sleep/cognitive-emotional arousal, but these records do not isolate silent unguided meditation immediately before bed and sleep outcomes were mixed."
      sourceKeys:
        - source_artifact:doi-10.1007-s12671-018-0911-6
        - source_artifact:doi-10.1007-s12671-019-01217-4
        - source_artifact:pmid-15310517
        - source_artifact:pmid-22281450
        - source_artifact:pmid-18548835
        - source_artifact:pmid-19481481
        - source_artifact:pmid-4004706
        - source_artifact:pmid-20362977
        - source_artifact:doi-10.1521-ijct.2015.8.1.21
        - source_artifact:pmid-22893774
        - source_artifact:pmid-21963535
        - source_artifact:pmid-37183177
        - source_artifact:pmid-29599851
        - source_artifact:pmid-28647747
        - source_artifact:pmid-32247571
      defaultOpen: true
    -
      id: clinical-insomnia-mindfulness
      label: Structured clinical mindfulness and insomnia trials
      stance: mixed
      summary: "Structured MBSR, MBTI, MBCT-I, and older meditation-training studies provide the strongest adjacent intervention evidence. They support plausibility for sleep-quality or insomnia-symptom improvement in some settings, but they are supervised, clinical, bundled, or comparator-limited rather than silent bedtime practice."
      sourceKeys:
        - source_artifact:doi-10.1016-j.aimed.2024.08.005
        - source_artifact:pmid-24395850
        - source_artifact:pmid-25843539
        - source_artifact:doi-10.1002-smi.1370
        - source_artifact:doi-10.1016-s0005-7894-76-80064-0
        - source_artifact:pmid-37434109
        - source_artifact:pmid-32128052
        - source_artifact:pmid-30929703
        - source_artifact:nccih-mindfulness-chronic-insomnia-2014-09-01
        - source_artifact:pmid-31296508
        - source_artifact:pmid-32448712
        - source_artifact:pmid-41856
      defaultOpen: true
    -
      id: mindfulness_sleep_reviews
      label: Mindfulness sleep reviews and guideline-adjacent syntheses
      stance: mixed
      summary: "Reviews and meta-analyses generally suggest mindfulness-based interventions can improve self-reported sleep quality or insomnia symptoms, while endpoint heterogeneity, comparator differences, and limited objective or sustained effects keep the claim mixed for this protocol."
      sourceKeys:
        - source_artifact:pmid-30380915
        - source_artifact:pmid-32590218
        - source_artifact:pmid-36150798
        - source_artifact:pmid-29194467
        - source_artifact:pmid-36027795
        - source_artifact:pmid-41986788
        - source_artifact:pmid-10617176
        - source_artifact:pmid-12927124
        - source_artifact:pmid-17162986
        - source_artifact:pmid-22631616
        - source_artifact:pmid-22975073
        - source_artifact:pmid-26054060
        - source_artifact:pmid-26390335
        - source_artifact:pmid-26844312
        - source_artifact:pmid-28191449
        - source_artifact:pmid-29761479
        - source_artifact:pmid-33164741
        - source_artifact:pmid-35843245
        - source_artifact:pmid-37364869
        - source_artifact:pmid-39188094
        - source_artifact:pmid-22529834
        - source_artifact:pmid-30390479
        - source_artifact:pmid-36764787
      defaultOpen: false
    -
      id: guidelines_and_comparator_context
      label: Guidelines and comparator boundaries
      stance: does_not_confirm
      summary: "Use this bucket to keep the page from sounding like insomnia treatment. Current guideline/context sources keep mindfulness meditation in an insufficient-evidence lane for chronic insomnia and reinforce CBT-I, structured behavioral care, and clinical evaluation as separate standards."
      sourceKeys:
        - source_artifact:healthquality-va-gov-insomnia-osa-cpg-2025-04-22
        - source_artifact:va-dod-insomnia-osa-guideline-2019-10-01
        - source_artifact:pmid-18853708
        - source_artifact:pmid-17162987
        - source_artifact:pmid-10617175
        - source_artifact:pmid-33667998
        - source_artifact:pmid-28875581
        - source_artifact:pmid-29991437
        - source_artifact:pmid-29734997
        - source_artifact:pmid-38149978
        - source_artifact:pmid-33164742
        - source_artifact:pmid-38016484
        - source_artifact:pmid-27136449
        - source_artifact:pmid-41975142
        - source_artifact:doi-10.7326/m15-1782
        - source_artifact:nice-sleepio-insomnia-2022-05-20
        - source_artifact:pmid-22294820
        - source_artifact:pmid-40300398
        - source_artifact:pmid-32066145
        - source_artifact:pmid-17040003
        - source_artifact:pmid-33666165
        - source_artifact:pmid-27231885
        - source_artifact:pmid-37454606
        - source_artifact:pmid-32882005
        - source_artifact:pmid-27998379
        - source_artifact:pmid-27136278
        - source_artifact:pmid-26273913
        - source_artifact:pmid-17520797
        - source_artifact:pmid-25905662
        - source_artifact:nccih-mind-body-practices-sleep-disorders-2026-04-27
        - source_artifact:sleepfoundation-meditation-sleep-2024-02-26
        - source_artifact:sleepfoundation-relaxation-exercises-sleep-2025-07-24
        - source_artifact:doi-10.1111-j.1479-8425.2009.00416.x
      defaultOpen: true
    -
      id: digital-app-guided-variants
      label: Timing-close app-guided bedtime mindfulness
      stance: context_only
      summary: This small bucket holds the timing-close app-guided bedtime mindfulness pilot and related clinical model context. It is useful for variant disambiguation but should not be used as silent unguided evidence.
      sourceKeys:
        - source_artifact:pmid-41027036
        - source_artifact:pmid-20853441
      defaultOpen: false
    -
      id: research_landscape:digital_app_guided_variants
      label: "Digital, app-guided, and prompted variants"
      stance: mixed
      summary: "Digital meditation and app sleep-program evidence is relevant but variant-specific. Some app or text-delivered programs report positive self-report or wearable signals, but effects are often bundled with guidance, CBT-I content, commercial implementation, compensation, or device-specific delivery; they should not be treated as silent unguided evidence."
      sourceKeys:
        - source_artifact:pmid-36125880
        - source_artifact:pmid-40267472
        - source_artifact:pmid-35420589
        - source_artifact:pmid-35503653
        - source_artifact:pmid-39213858
        - source_artifact:pmid-41862627
        - source_artifact:pmid-33482627
        - source_artifact:pmid-41339476
        - source_artifact:doi-10.2147-nss.s578770
        - source_artifact:nccih-mind-body-sleep-disorders-2024-03-01
        - source_artifact:nccih-sleep-disorders-complementary-health-approaches-2026-04-27
        - source_artifact:pmid-31539830
        - source_artifact:pmid-35168972
        - source_artifact:pmid-38761604
      defaultOpen: false
    -
      id: measurement-endpoints-and-wearables
      label: "Measurement, diaries, actigraphy, and consumer wearables"
      stance: context_only
      summary: "This bucket should drive the test plan: pair wearable sleep-onset and sleep-efficiency trends with diary sleep-onset, wiredness/arousal, and adherence. Wearables can be useful longitudinal proxies but can misclassify quiet wakefulness and are not proof of sleep-stage physiology."
      sourceKeys:
        - source_artifact:pmid-14655927
        - source_artifact:pmid-17969470
        - source_artifact:pmid-27707448
        - source_artifact:pmid-29991438
        - source_artifact:pmid-30789439
        - source_artifact:pmid-31778122
        - source_artifact:pmid-17068990
        - source_artifact:pmid-19544753
        - source_artifact:pmid-21237680
        - source_artifact:pmid-21447050
        - source_artifact:pmid-21652563
        - source_artifact:pmid-23493815
        - source_artifact:pmid-24179309
        - source_artifact:pmid-32048595
        - source_artifact:pmid-32053169
        - source_artifact:pmid-33378539
        - source_artifact:pmid-36217775
        - source_artifact:pmid-37917155
        - source_artifact:pmid-38557808
        - source_artifact:pmid-12076472
        - source_artifact:pmid-29235907
        - source_artifact:pmid-36016077
      defaultOpen: false
    -
      id: dose-duration-adherence-context
      label: "Dose, duration, and adherence guardrails"
      stance: context_only
      summary: "Dose evidence is indirect. Mindfulness practice amounts and adherence vary, practice-outcome links are not clean causal dose-response findings, and higher intensity is not automatically better. The page should therefore prescribe a bounded, low-burden self-test and log delivered dose rather than claiming an optimal meditation duration."
      sourceKeys:
        - source_artifact:doi-10.1891-0889-8391.23.3.198
        - source_artifact:pmid-28527330
        - source_artifact:pmid-17899351
        - source_artifact:pmid-18469160
        - source_artifact:doi-10.1111-joop.12115
        - source_artifact:pmid-24512477
        - source_artifact:pmid-27663102
        - source_artifact:pmid-37304656
        - source_artifact:doi-10.1007-s11920-022-01370-z
        - source_artifact:doi-10.1037-14952-000
        - source_artifact:pmid-18005910
        - source_artifact:pmid-19114261
        - source_artifact:pmid-22832540
        - source_artifact:pmid-25686304
        - source_artifact:pmid-30294523
        - source_artifact:pmid-30354905
        - source_artifact:pmid-30575050
        - source_artifact:pmid-31029188
        - source_artifact:pmid-32939342
        - source_artifact:pmid-33175980
        - source_artifact:pmid-33185552
        - source_artifact:pmid-33411779
        - source_artifact:pmid-33928908
        - source_artifact:pmid-34193328
        - source_artifact:pmid-34297230
        - source_artifact:pmid-34377217
        - source_artifact:pmid-34679078
        - source_artifact:pmid-36332952
        - source_artifact:pmid-36731199
        - source_artifact:pmid-38458149
        - source_artifact:pmid-18502250
        - source_artifact:pmid-21397868
        - source_artifact:pmid-25142566
        - source_artifact:pmid-41426462
      defaultOpen: false
    -
      id: population-mismatch-special-groups
      label: Population mismatch and special-group boundaries
      stance: context_only
      summary: "Special-population sources belong as boundaries, not general adult efficacy proof. Stroke, heart disease, oncology, pregnancy/postpartum, older-adult, psychiatric, and other clinical contexts may need different screening, supervision, outcomes, and stop rules."
      sourceKeys:
        - source_artifact:isrctn-15770131-2024-06-24
        - source_artifact:doi-10.1016-j.sleh.2022.02.003
        - source_artifact:pmid-27002445
        - source_artifact:pmid-27658913
        - source_artifact:pmid-32944276
        - source_artifact:pmid-37244384
        - source_artifact:pmid-37467038
        - source_artifact:pmid-39500303
        - source_artifact:pmid-40194914
        - source_artifact:pmid-41502784
        - source_artifact:doi-10.1371-journal.pone.0322931
        - source_artifact:pmid-23070934
        - source_artifact:pmid-23282113
        - source_artifact:pmid-24943918
        - source_artifact:pmid-24993561
        - source_artifact:pmid-27511921
        - source_artifact:pmid-27775416
        - source_artifact:pmid-28431122
        - source_artifact:pmid-28748522
        - source_artifact:pmid-33460741
        - source_artifact:pmid-34537477
        - source_artifact:pmid-34900019
        - source_artifact:pmid-35896519
        - source_artifact:pmid-36027785
        - source_artifact:pmid-37343335
        - source_artifact:pmid-37361010
        - source_artifact:pmid-37645455
        - source_artifact:pmid-38179560
        - source_artifact:pmid-38597262
        - source_artifact:pmid-39071123
        - source_artifact:pmid-39306634
        - source_artifact:pmid-40324172
        - source_artifact:pmid-40413907
        - source_artifact:pmid-41637757
        - source_artifact:pmid-40498669
        - source_artifact:pmid-12505559
        - source_artifact:pmid-16262547
        - source_artifact:pmid-20929380
        - source_artifact:pmid-25376753
        - source_artifact:pmid-25425224
        - source_artifact:pmid-26211415
        - source_artifact:pmid-27182765
        - source_artifact:pmid-28029852
        - source_artifact:pmid-28263398
        - source_artifact:pmid-35582336
        - source_artifact:pmid-36919571
        - source_artifact:pmid-40636896
        - source_artifact:pmid-32424878
        - source_artifact:pmid-35733879
        - source_artifact:pmid-29787483
        - source_artifact:pmid-32241625
        - source_artifact:pmid-38429355
        - source_artifact:pmid-29101843
        - source_artifact:pmid-38769624
        - source_artifact:pmid-33663887
        - source_artifact:pmid-31092044
        - source_artifact:pmid-31356450
        - source_artifact:pmid-32146168
        - source_artifact:pmid-34170222
        - source_artifact:pmid-30345511
        - source_artifact:pmid-35776489
        - source_artifact:pmid-41064536
        - source_artifact:pmid-29706914
      defaultOpen: false
    -
      id: safety-adverse-effects
      label: "Safety, adverse experiences, and stop rules"
      stance: safety_boundary
      summary: "This protocol is intentionally brief and low-burden, but the corpus does not quantify adverse-event incidence for this exact bedtime practice. Safety materialization should include informed-consent language, compact screening, and stop rules; the broader corpus includes safety reviews, surveys, contraindication commentary, harms-reporting limitations, and case reports around mania, psychosis, dissociation, unwanted experiences, and incomplete harms monitoring."
      sourceKeys:
        - source_artifact:nccih-meditation-mindfulness-safety-2022-06-03
        - source_artifact:doi-10.1007-s12671-011-0079-9
        - source_artifact:pmid-30638824
        - source_artifact:pmid-32820538
        - source_artifact:pmid-41176868
        - source_artifact:doi-10.1080-713685624
        - source_artifact:pmid-31668156
        - source_artifact:pmid-10743
        - source_artifact:pmid-28873417
        - source_artifact:doi-10.1177-21677026241298269
        - source_artifact:pmid-24607768
        - source_artifact:pmid-35464906
        - source_artifact:doi-10.1007-s12671-018-0897-0
        - source_artifact:doi-10.1192-bjo.2021.1066
        - source_artifact:ons-sleep-wake-mbsr-2026-04-27
        - source_artifact:pmid-28542181
        - source_artifact:pmid-30106471
        - source_artifact:pmid-30708288
        - source_artifact:pmid-31071152
        - source_artifact:pmid-32807249
        - source_artifact:pmid-33747251
        - source_artifact:pmid-34074221
        - source_artifact:pmid-34162788
        - source_artifact:pmid-34385088
        - source_artifact:pmid-34735517
        - source_artifact:pmid-35048869
        - source_artifact:pmid-35174010
        - source_artifact:pmid-37950556
        - source_artifact:pmid-38851179
        - source_artifact:pmid-39942485
        - source_artifact:pmid-1151361
        - source_artifact:pmid-1428622
        - source_artifact:pmid-17848828
        - source_artifact:pmid-34426774
        - source_artifact:pmid-380368
        - source_artifact:pmid-39514882
      defaultOpen: true
    -
      id: trial-registries-and-unresolved-protocols
      label: Registries and unresolved protocol records
      stance: context_only
      summary: "Registry records help map near variants and future evidence but should not be treated as efficacy evidence unless linked results are extracted. This is where planned bedtime-meditation comparisons, MBTI/MBJS trials, and implementation pilots can live until completed publications are linked."
      sourceKeys:
        - source_artifact:clinicaltrials-nct00768781-2026-04-26
        - source_artifact:clinicaltrials-nct03337061-2026-04-26
        - source_artifact:clinicaltrials-nct03677726-2026-04-27
        - source_artifact:clinicaltrials-nct03724305-2026-04-27
        - source_artifact:clinicaltrials-nct06972303-2026-02-23
        - source_artifact:clinicaltrials-nct04514640-2026-04-27
        - source_artifact:clinicaltrials-nct01534338-2012-12-11
        - source_artifact:clinicaltrials-nct03268629-2026-04-27
        - source_artifact:clinicaltrials-nct04443959-2026-04-27
        - source_artifact:clinicaltrials-nct04806009-2026-04-27
        - source_artifact:clinicaltrials-nct04951466-2026-04-27
        - source_artifact:clinicaltrials-nct05217602-2026-04-27
        - source_artifact:clinicaltrials-nct06348082-2026-04-27
      defaultOpen: false
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - "Bipolar disorder, mania or hypomania history, psychosis vulnerability, hallucinations, unusual beliefs, altered reality testing, marked agitation, or reduced need for sleep."
    - "Current suicidal thoughts, self-harm thoughts, severe depression, or major functional impairment."
    - "PTSD or trauma history with flashbacks, re-experiencing, dissociation, depersonalization, derealization, panic, fear of losing control, or past adverse meditation reactions."
    - "Persistent insomnia, suspected untreated sleep apnea, loud snoring with breathing pauses, or daytime sleepiness causing impairment."
    - "Epilepsy, seizure disorder, cognitive impairment, dementia, major neurologic disease, or a condition requiring caregiver-supported practice."
    - Pregnancy/postpartum sleep disturbance or perinatal mental-health complexity.
    - "Active substance-use disorder, withdrawal, intoxication, or addiction destabilization."
    - "Major medical conditions where pain, shortness of breath, cardiopulmonary symptoms, cancer-related symptoms, stroke/heart disease, MS, or other neurologic/medical issues are driving sleep."
    - "Children or adolescents; use a youth-specific, caregiver-aware variant instead."
    - Any uncertainty about whether meditation is safe for you.
  stopIf:
    - "Meditation increases arousal, anxiety, panic, rumination, intrusive thoughts, frustration, sleep effort, or compulsive tracking."
    - "Sleep is clearly worse for 3 consecutive intervention nights, total sleep time drops meaningfully, or daytime functioning deteriorates."
    - "Confusion, disorientation, fear of losing control, dissociation, depersonalization, derealization, trauma activation, traumatic memories, flashbacks, or unusually distressing mental content appears."
    - "Mood elevation, agitation, racing thoughts, reduced need for sleep, hallucinations, unusual beliefs, altered reality testing, or other mania- or psychosis-like symptoms appears."
    - "New or worsening suicidal thoughts, self-harm thoughts, severe depression, or functional impairment appears; stop immediately and seek appropriate urgent support."
    - "Pain, shortness of breath, dizziness, chest symptoms, or other physical symptoms appear during the session."
    - The user repeats or extends the session in bed to force sleep.
  notes:
    - Safety evidence is broad and heterogeneous; it justifies screening and stop rules but does not estimate the incidence of adverse events for this exact brief bedtime protocol.
    - "This protocol is not a substitute for CBT-I, medical sleep evaluation, or mental-health care."
---
Silent Meditation Before Bed is a **brief, unguided, no-audio pre-sleep downshift test**. The practical question is not “does meditation cure insomnia?” It is: over a stable two-week window, does a short silent practice make your own pre-bed wiredness or perceived sleep-onset latency better, worse, or unchanged?

## How to run it

Do a 7-night baseline first, then use 10 minutes of silent breath or body awareness on up to 14 intervention nights. Keep the practice simple: no guided audio, app lesson, breath pacing, music, supplement, CBT-I module, or added relaxation technique. Stop when the timer ends, log the key fields, and proceed with the normal bedtime routine.

## What to measure

The primary read is manual perceived sleep-onset latency plus pre-bed wiredness or rumination. Wearable sleep-onset latency, sleep efficiency, deep sleep, HRV, and resting heart rate can add context, but they are exploratory because quiet wakefulness and device algorithms can distort sleep estimates.

## Evidence stance

The corpus supports a plausible pre-sleep arousal-downshift mechanism, but it does **not** provide completed, direct evidence that silent unguided meditation immediately before bed improves sleep. Closest evidence comes from structured mindfulness programs, clinical insomnia studies, app-guided variants, registries, reviews, guidelines, measurement papers, and special populations. The claim and researchLandscape blocks preserve those distinctions with source keys.

## Safety stance

Keep safety stronger than efficacy. Stop or seek support if the practice worsens sleep, increases rumination or panic, triggers dissociation or trauma reactions, or brings up mania-, psychosis-, suicidality-, or severe-depression warning signs.
