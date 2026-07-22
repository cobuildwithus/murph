---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:cognitive-offload-before-bed/five-minute-tomorrow-list
slug: protocols/cognitive-offload-before-bed/five-minute-tomorrow-list
title: Five-Minute Tomorrow List
summary: Five minutes writing tomorrow's specific tasks before bed, testing whether a bounded list makes unfinished plans easier to set down for the night.
status: field-testing
quality: usable
aliases:
  - five minute bedtime to-do list
  - five minute tomorrow task list
  - five minute cognitive offload
  - park tasks before sleep
categories:
  - sleep
  - cognitive-offload
  - bedtime-writing
  - pre-sleep-arousal
  - low-burden
  - murph-canonical
relations:
  - type: parent_family
    target: experiment_family:cognitive-offload-before-bed
  - type: primary_biomarker
    target: biomarker:pre-sleep-arousal
  - type: secondary_biomarker
    target: biomarker:sleep-onset-latency
  - type: secondary_biomarker
    target: biomarker:sleep-quality
  - type: cites
    target: source_artifact:pmid-29058942
  - type: cites
    target: source_artifact:pmid-29441644
  - type: cites
    target: source_artifact:pmid-33164742
  - type: cites
    target: source_artifact:pmid-26414989
lineage:
  relationship: root
  rationale: Murph canonical future-task cognitive-offload variant; open-ended journaling, emotional processing, meditation, relaxation therapy, and CBT-I remain separate.
attribution:
  ownerType: murph
  note: A repeated-home adaptation of a single-night future-task-list study with a shorter fallback for burden and activation.
protocol:
  doseSignature: Nightly · 5-min specific tomorrow list · 60-sec fallback · stop at the timer · 14 nights after 14-night baseline
  target: Unfinished future tasks that keep recycling near bedtime.
  frequency:
    sessionsPerWeek: 7
  durationMinutes:
    min: 1
    max: 5
  sessionShape:
    label: One bounded writing session
    segments:
      - label: write specific future tasks and first actions
        kind: stimulus
        durationMinutes: 5
    ticks:
      - start
      - stop at 5 min
  interventionSessionsMinimum: 10
  interventionSessionsTarget: 12
  steps:
    - Baseline for 14 nights without adding bedtime writing; at the matched point before the ordinary sleep attempt, record pre-sleep arousal 0-10, sleep opportunity, estimated sleep onset, and daytime sleepiness 0-10 (higher is worse). Writing burden or activation is intervention-only and should stay blank during baseline.
    - In the last 30 minutes before the intended sleep attempt, set a quiet 5-minute timer.
    - Write only specific tasks for tomorrow or the next few days; add the first action when that makes a task easier to park.
    - Do not solve the tasks, rank the whole life backlog, process trauma, or turn the list into an open-ended journal.
    - When the timer ends, stop. Put the list away and continue the ordinary bedtime transition.
    - On a depleted night, use the 60-second fallback: write up to three tasks and one next action, then stop.
    - Keep the nightly default to pre-sleep arousal 0-10, sleep opportunity, estimated sleep onset, daytime sleepiness 0-10, and writing burden or activation 0-10. Add exact clock times, list details, sleep quality, or context only when the user volunteers it or Murph needs it to interpret an unusual night.
    - At 14 nights, keep it only if arousal or sleep onset improved enough to justify the writing; otherwise move it earlier, shorten it once, or leave it alone.
  tips:
    - Keep the list concrete and finite; the study's exploratory item-count signal does not establish an ideal list length, so do not chase volume.
    - Use paper or the lowest-stimulation tool already available without adding a new screen ritual.
    - The list is a parking place, not a promise to finish everything tomorrow.
    - If planning itself is activating, use the fallback, move it earlier, or stop.
  keepInMind:
    - Direct evidence is one controlled laboratory night in 57 healthy young adults, compared with writing completed activities rather than no writing.
    - The study measured sleep onset, not repeated pre-sleep-arousal ratings, chronic insomnia treatment, or long-term function.
    - Open-ended worry or trauma writing is not this protocol.
  logFields:
    - pre-sleep arousal or wiredness 0-10
    - sleep opportunity in minutes from the actual sleep attempt to final rise
    - estimated sleep-onset latency in minutes
    - daytime sleepiness 0-10 (0 = fully alert, 10 = struggling to stay awake; higher is worse)
    - writing burden or activation 0-10 (0 = none, 10 = severe or stop-worthy)
  sessionFieldIds:
    - pre_sleep_arousal
    - sleep_opportunity_minutes
    - estimated_sleep_onset_latency_minutes
    - daytime_sleepiness
    - writing_burden
  stopConditions:
    - Writing increases arousal, panic, intrusive thoughts, trauma recall, perfectionism, or sleep effort.
    - The list repeatedly exceeds 5 minutes, delays bedtime, or becomes a second work session.
    - Sleep onset, sleep quality, or next-day function is clearly worse for 3 consecutive intervention nights.
    - Dangerous sleepiness, drowsy driving, severe mood change, agitation, or markedly reduced need for sleep appears.
testPlans:
  - planId: tomorrow-list-21d
    durationDays: 28
    baselineDays: 14
    interventionDays: 14
    primaryBiomarkerKey: biomarker:pre-sleep-arousal
    secondaryBiomarkerKeys:
      - biomarker:sleep-onset-latency
      - biomarker:daytime-sleepiness
    minimumAdherenceSessions: 10
    targetAdherenceSessions: 12
    notes:
      - Compare the same 0-10 pre-sleep-arousal wording across baseline and intervention.
      - Treat sleep-onset estimates and subjective sleep quality as supporting signals; do not promote one wearable night into proof.
      - Add unusual stress, illness, pain, travel, caffeine, alcohol, naps, exact clock times, list details, and schedule changes only when volunteered or needed to explain an unusual night.
expectedSignalDescriptions:
  - biomarkerKey: biomarker:pre-sleep-arousal
    expected: May reduce planning load
    expectedDirection: down_or_stable
    description: A bounded specific list externalizes unfinished tasks, but direct evidence for repeated arousal improvement is limited.
    estimatedChange:
      kind: mixed_or_contextual
      window: 14 nights versus 14-night baseline
      confidence: low
      basis: The direct study found faster sleep onset after a single future-task list but did not measure a repeated pre-sleep-arousal outcome.
    protocolProminence: focus
  - biomarkerKey: biomarker:sleep-onset-latency
    expected: May fall asleep sooner
    description: Parking specific future tasks may reduce the planning loop that continues after lights-out.
    estimatedChange:
      kind: mixed_or_contextual
      window: 14 nights versus 14-night baseline
      confidence: low
      basis: One active-comparator laboratory study in healthy young adults found faster polysomnography-measured sleep onset after a five-minute future-task list; repeated home effects are unknown.
    protocolProminence: context
experimentOnboarding:
  schemaVersion: murph.commons.experiment-onboarding.v2
  startIntent:
    displayPrompt: Hey Murph, I want to test a short tomorrow list for the tasks that keep circling at bedtime.
    intentSummary: Explore a five-minute tomorrow-list experiment
  safetyScreen:
    dispositionIfAnyPositive: do_not_start_unsupervised
    mustAsk:
      - id: dangerous_sleepiness
        prompt: Are you having dangerous daytime sleepiness, drowsy driving, or safety-sensitive work while short on sleep?
        ifPositive: do_not_start_unsupervised
      - id: severe_writing_activation_risk
        prompt: Does writing about tasks or worries tend to trigger panic, trauma recall, compulsive planning, or marked emotional activation?
        ifPositive: do_not_start_unsupervised
    stopIf:
      additionalConditions:
        - Do not start with open-ended worry or trauma writing inside this protocol.
        - If concrete task writing already triggers panic, trauma recall, compulsive planning, or marked activation, choose another protocol rather than testing this one.
  setupSlots:
    - id: writing_window
      label: Writing window
      question: When in the last 30 minutes before the sleep attempt could the five-minute list fit without delaying bed?
      target:
        object: experimentRun
        field: writingWindow
    - id: writing_tool
      label: Writing tool
      question: What low-stimulation paper or existing note tool will you use?
      options:
        - paper
        - existing-note-tool
      target:
        object: experimentRun
        field: writingTool
    - id: reminder_policy
      label: Reminder preference
      question: Would a short pre-bed reminder help, or would you prefer no reminders?
      options:
        - none
        - pre-bed-reminder
      constraints:
        askWhen: at_confirmation
        optional: true
      target:
        object: assistantSupport
        field: reminderPolicy
  planDefaults:
    testPlanId: tomorrow-list-21d
    firstSessionGuidance: Write specific future tasks for no more than five minutes. Stop at the timer; use the 60-second fallback or stop entirely if writing increases arousal.
  adaptationPolicy:
    fields:
      - id: adapt_writing_window
        label: Writing window
        target:
          object: experimentRun
          field: writingWindow
        sourceSlotIds:
          - writing_window
        requiredForRunSpec: true
        protocolReusable: true
        guidance: Keep the list in the final 30 minutes only when it does not delay bedtime; otherwise move it earlier.
    measurementPlan:
      testPlanId: tomorrow-list-21d
      requiredSignals:
        - biomarker:pre-sleep-arousal
      optionalSignals:
        - biomarker:sleep-onset-latency
        - biomarker:daytime-sleepiness
      notes:
        - Use the same pre-sleep-arousal prompt at a matched point before baseline sleep attempts and immediately after writing but before intervention sleep attempts.
        - Keep daytime sleepiness and writing burden/activation on 0-10. Exact clock times, list details, subjective sleep quality, and contextual factors are optional and should be requested only when they would change interpretation.
  trackingHints:
    notes:
      - Log activation and burden even when sleep appears better.
      - Do not proactively chase confounders or reconstruct an ordinary night. Add context only when the user volunteers it or the compact signals make an unusual night important to interpret.
  supportHints:
    missedLogFollowupCopy: If it is easy, add a quick pre-sleep-arousal and sleep-opportunity estimate. Include writing activation only when safety or tolerability changed; otherwise leave last night alone.
claims:
  - claimId: one-night-tomorrow-list-sleep-onset-result
    type: intervention_result
    text: In one randomized sleep-laboratory night, healthy young adults assigned to write a specific five-minute future-task list fell asleep faster than those assigned to write about completed activities.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-29058942
    caveats:
      - The study included 57 healthy adults age 18 to 30 and did not compare writing with no writing.
      - It does not establish repeated home effects, chronic-insomnia treatment, or a benefit from longer journaling.
  - claimId: constructive-worry-evidence-is-not-uniform
    type: mixed_evidence
    text: A separate adolescent trial did not find clear broad improvement in pre-sleep worry, cognitive or emotional arousal, or daytime function from its constructive-worry condition, so cognitive-offload effects should not be treated as universal.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-29441644
    caveats:
      - The population and intervention differ from this adult five-minute future-task list.
  - claimId: chronic-insomnia-care-boundary
    type: safety
    text: A short task list is not CBT-I and should not delay evidence-based clinical care for persistent or impairing insomnia.
    strength: high
    sourceKeys:
      - source_artifact:pmid-33164742
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - writing that triggers trauma recall, panic, compulsive planning, or major emotional activation
    - dangerous daytime sleepiness or drowsy driving
  stopIf:
    - writing increases arousal, panic, intrusive thoughts, trauma recall, or sleep effort
    - the list becomes longer than five minutes, delays bedtime, or turns into work
    - sleep or next-day function is repeatedly worse
  notes:
    - Keep content to concrete future tasks and first actions; do not use this as emotional or trauma processing.
    - Stop rules override the target session count.
---

## What this tests

This experiment tests whether parking specific future tasks in a five-minute list reduces bedtime mental load enough to make sleep easier.

## Decision at the end

Keep it only if repeated arousal or sleep-onset evidence improved and the list stayed genuinely cheap. Move it earlier or use the fallback if timing was the problem. If writing fed planning, delayed bed, or did nothing useful, leave it alone.
