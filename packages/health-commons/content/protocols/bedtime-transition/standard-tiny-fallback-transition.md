---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:bedtime-transition/standard-tiny-fallback-transition
slug: protocols/bedtime-transition/standard-tiny-fallback-transition
title: Standard, Tiny, And Fallback Bedtime Transition
summary: One prechosen cue followed by a standard, tiny, or fallback bedtime transition, reducing the friction between deciding to stop and actually attempting sleep.
status: draft
quality: usable
aliases:
  - tiny bedtime transition
  - bedtime procrastination routine
  - standard tiny fallback bedtime
  - bedtime shutdown cue
categories:
  - sleep
  - bedtime-procrastination
  - behavior-change
  - low-burden
  - murph-canonical
relations:
  - type: parent_family
    target: experiment_family:bedtime-transition
  - type: primary_biomarker
    target: biomarker:bedtime-delay
  - type: secondary_biomarker
    target: biomarker:sleep-onset-latency
  - type: secondary_biomarker
    target: biomarker:sleep-quality
  - type: secondary_biomarker
    target: biomarker:daytime-sleepiness
  - type: cites
    target: source_artifact:pmid-37354745
  - type: cites
    target: source_artifact:pmid-24997168
  - type: cites
    target: source_artifact:pmid-33164742
  - type: cites
    target: source_artifact:pmid-26414989
lineage:
  relationship: root
  rationale: Murph canonical low-burden bedtime-transition variant; full CBT-I, sleep restriction, rigid bedtime scheduling, app lockouts, and clinical circadian treatment remain separate.
attribution:
  ownerType: murph
  note: A pragmatic one-variable transition routine informed by bedtime-procrastination research without copying a multicomponent clinical intervention.
protocol:
  doseSignature: Nightly · one transition cue · standard, tiny, or fallback version · 14 nights after 14-night baseline
  target: Reduce the nonnegative delay between a prospectively intended sleep-attempt time and the actual sleep attempt without reducing sleep opportunity.
  frequency:
    sessionsPerWeek: 7
  durationMinutes:
    min: 1
    max: 10
  sessionShape:
    label: One bedtime transition
    segments:
      - label: park current activity and begin prechosen transition
        kind: stimulus
        durationMinutes: 10
    ticks:
      - transition cue
      - sleep attempt
  interventionSessionsMinimum: 10
  interventionSessionsTarget: 12
  steps:
    - Baseline for 14 nights without changing the routine; set the intended sleep-attempt time before the late-evening decision point, then record nonnegative bedtime delay, sleep opportunity, estimated sleep onset, daytime sleepiness 0-10 (higher is worse), and any burden, anxiety, or adverse effect 0-10.
    - Choose one realistic transition cue tied to the intended sleep attempt, not an exact universal bedtime.
    - Standard version (up to 10 minutes): park the current activity with one next-action note, complete only essential bedtime tasks, put discretionary entertainment down, and begin the sleep attempt.
    - Tiny version (about 2 minutes): save the current stopping point, do the one essential bedtime task, and begin the sleep attempt.
    - Fallback version (about 1 minute): if the cue was missed, write the next action and start the tiny version now instead of declaring the night lost.
    - Preserve emergency, medical, accessibility, caregiving, and on-call availability; those are external constraints, not procrastination.
    - Keep the nightly default to bedtime delay, sleep opportunity, estimated sleep onset, daytime sleepiness 0-10, and burden, anxiety, or adverse effect 0-10. Add exact clock times, transition version, sleep quality, or context only when the user volunteers it or Murph needs it to interpret an unusual night.
    - At 14 nights, keep the lightest version only if bedtime delay improved without reducing sleep opportunity or worsening morning function; otherwise adapt once or leave it alone.
  tips:
    - Prechoose the standard, tiny, and fallback versions while rested; do not redesign them late at night.
    - Keep the routine shorter than the activity it replaces and avoid adding a full sleep-hygiene checklist.
    - A missed cue is information. Use the fallback or log the external reason without shame.
    - If you are already sleepy, skip optional steps and go to bed.
  keepInMind:
    - The closest randomized evidence tested a broader individualized behavioral intervention in a small non-clinical young-adult sample; it does not prove this compact routine.
    - The target is a voluntary transition delay. Work, caregiving, on-call duties, pain, symptoms, and a shifted body clock need different help.
    - Do not tighten bedtime or wake time in a way that reduces sleep opportunity.
  logFields:
    - bedtime delay in minutes, recorded as 0 when on time or earlier
    - sleep opportunity in minutes from the actual sleep attempt to final rise
    - estimated sleep-onset latency in minutes
    - daytime sleepiness 0-10 (0 = fully alert, 10 = struggling to stay awake; higher is worse)
    - burden, anxiety, or adverse effect 0-10 (0 = none, 10 = severe or stop-worthy)
  sessionFieldIds:
    - bedtime_delay_minutes
    - sleep_opportunity_minutes
    - estimated_sleep_onset_latency_minutes
    - daytime_sleepiness
    - adverse_effects
  stopConditions:
    - The routine delays bedtime, reduces sleep opportunity, or repeatedly makes sleep onset or next-day function worse.
    - You develop dangerous sleepiness, drowsy driving, or unsafe impairment.
    - The routine increases panic, compulsive checking, self-criticism, agitation, or reduced need for sleep.
    - An external constraint or suspected sleep disorder makes bedtime delay the wrong target.
testPlans:
  - planId: bedtime-transition-21d
    durationDays: 28
    baselineDays: 14
    interventionDays: 14
    primaryBiomarkerKey: biomarker:bedtime-delay
    secondaryBiomarkerKeys:
      - biomarker:sleep-onset-latency
      - biomarker:daytime-sleepiness
    minimumAdherenceSessions: 10
    targetAdherenceSessions: 12
    notes:
      - Compare repeated morning estimates, not one perfect bedtime or one wearable score.
      - Calculate bedtime delay as max(0, actual sleep-attempt time minus the prospectively intended time); do not move the intended time after the fact.
      - Calculate sleep opportunity from the actual sleep-attempt time to final rise, and do not call a lower bedtime delay a win when that opportunity shrinks.
      - Treat transition version as adherence evidence, bedtime delay as the direct behavior outcome, and sleep onset or next-day function as supporting health signals.
      - Keep sleep opportunity protected. Add external constraints, illness, travel, pain, caffeine, alcohol, naps, exact clock times, transition version, and major schedule changes only when volunteered or needed to explain an unusual night.
expectedSignalDescriptions:
  - biomarkerKey: biomarker:bedtime-delay
    expected: May reduce minutes late to the sleep attempt
    expectedDirection: down_or_stable
    description: A prechosen transition directly targets the gap between an intended sleep-attempt time and when the attempt actually begins.
    estimatedChange:
      kind: mixed_or_contextual
      window: 14 nights versus 14-night baseline
      confidence: low
      basis: A small randomized trial reduced bedtime procrastination with a broader individualized intervention; this compact transition and exact delay metric have not been tested directly.
    protocolProminence: focus
  - biomarkerKey: biomarker:sleep-onset-latency
    expected: Should not clearly worsen
    expectedDirection: down_or_stable
    description: Getting to the sleep attempt closer to the intended time does not guarantee faster sleep onset, so latency remains a separate supporting signal.
    estimatedChange:
      kind: mixed_or_contextual
      window: 14 nights versus 14-night baseline
      confidence: low
      basis: The broader intervention reported sleep benefits, but this compact transition is designed around bedtime delay rather than a direct sleep-onset treatment.
    protocolProminence: context
  - biomarkerKey: biomarker:daytime-sleepiness
    expected: Should not worsen
    expectedDirection: down_or_stable
    description: Starting the sleep attempt on time may preserve sleep opportunity, but daytime safety outweighs adherence.
    estimatedChange:
      kind: mixed_or_contextual
      window: 14 nights versus 14-night baseline
      confidence: low
      basis: Daytime sleepiness improved in the broader young-adult intervention, but the compact transition has not been tested directly.
    protocolProminence: context
experimentOnboarding:
  schemaVersion: murph.commons.experiment-onboarding.v2
  startIntent:
    displayPrompt: Hey Murph, I want to test a lighter way to stop what I am doing and get to bed.
    intentSummary: Explore a bedtime-transition experiment
  safetyScreen:
    dispositionIfAnyPositive: continue_with_caution
    mustAsk:
      - id: dangerous_sleepiness
        prompt: Are you having dangerous daytime sleepiness, drowsy driving, or safety-sensitive work while short on sleep?
        ifPositive: do_not_start_unsupervised
      - id: external_schedule_constraint
        prompt: Are work, shift schedules, on-call duties, caregiving, pain, or another external constraint the main reason bedtime moves later?
        ifPositive: continue_with_caution
    stopIf:
      additionalConditions:
        - Do not start when the transition target is expected to reduce sleep opportunity.
  setupSlots:
    - id: sleep_attempt_anchor
      label: Intended sleep-attempt time
      question: What specific sleep-attempt time feels realistic enough to define on-time on ordinary nights?
      target:
        object: experimentRun
        field: sleepAttemptAnchor
    - id: transition_cue
      label: Transition cue
      question: What cue should start the bedtime transition?
      target:
        object: experimentRun
        field: transitionCue
    - id: transition_versions
      label: Standard, tiny, and fallback versions
      question: What are the smallest standard, tiny, and fallback actions that still move you toward bed?
      target:
        object: experimentRun
        field: transitionVersions
    - id: reminder_policy
      label: Reminder preference
      question: Would a pre-bed reminder help, or would you prefer no reminders?
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
    testPlanId: bedtime-transition-21d
    firstSessionGuidance: Set the intended sleep-attempt time before the late-evening decision point. Use the standard version if it feels easy, the tiny version if energy is low, and the fallback if the cue was missed. Record sleep opportunity in minutes so it stays visible, and protect that opportunity over adherence.
  adaptationPolicy:
    fields:
      - id: adapt_transition_versions
        label: Transition versions
        target:
          object: experimentRun
          field: transitionVersions
        sourceSlotIds:
          - transition_versions
        requiredForRunSpec: true
        protocolReusable: true
        guidance: Keep all versions brief and make the fallback easier than abandoning the night.
    measurementPlan:
      testPlanId: bedtime-transition-21d
      requiredSignals:
        - biomarker:bedtime-delay
      optionalSignals:
        - biomarker:sleep-onset-latency
        - biomarker:daytime-sleepiness
      notes:
        - Ask how many minutes after the intended time the sleep attempt began, with 0 for on time or earlier, and ask for sleep opportunity in minutes with the same wording throughout baseline and intervention.
        - Keep daytime sleepiness and burden/adverse effects on 0-10. Exact clock times, transition version, subjective sleep quality, and contextual factors are optional and should be requested only when they would change interpretation.
  trackingHints:
    notes:
      - Treat work, caregiving, safety, illness, and pain as context, not failed self-control.
      - Do not proactively chase confounders or reconstruct an ordinary night. Add context only when the user volunteers it or the compact signals make an unusual night important to interpret.
  supportHints:
    missedLogFollowupCopy: If it is easy, add last night's bedtime delay and sleep opportunity. Include daytime sleepiness or a burden/adverse effect only when safety or tolerability changed; otherwise leave last night alone.
claims:
  - claimId: broader-bedtime-procrastination-rct-is-adjacent
    type: intervention_result
    text: A small randomized wait-list trial found that a broader individualized behavioral intervention reduced bedtime procrastination and improved several sleep outcomes in non-clinical young adults.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-37354745
    caveats:
      - The intervention was multicomponent and individualized, so it does not establish this compact transition routine.
      - The sample was small, young, mostly female, and excluded insomnia and psychopathology.
      - The study was open-label with a wait-list comparator, so expectancy and self-report effects may contribute to the observed differences.
  - claimId: bedtime-procrastination-is-voluntary-delay
    type: evidence_scope
    text: Bedtime procrastination describes going to bed later than intended without an external reason; it should not absorb shift work, caregiving, pain, medical symptoms, or circadian disorders.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-24997168
    caveats:
      - Observational associations do not prove that a specific transition routine improves sleep.
  - claimId: persistent-insomnia-needs-clinical-boundary
    type: safety
    text: This low-burden routine is not CBT-I or sleep restriction and should not delay evidence-based care for persistent or impairing insomnia.
    strength: high
    sourceKeys:
      - source_artifact:pmid-33164742
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - dangerous daytime sleepiness or drowsy driving
    - a clinician-directed sleep schedule, CBT-I, or sleep-restriction plan
  stopIf:
    - the transition repeatedly reduces sleep opportunity or worsens next-day function
    - drowsy driving, dangerous sleepiness, agitation, or markedly reduced need for sleep appears
    - the routine becomes punitive, compulsive, or more burdensome than the problem
  notes:
    - External constraints are not adherence failures.
    - This protocol changes one transition routine; it does not add a full sleep-hygiene stack.
---

## What this tests

This experiment tests whether one small transition, with versions for good and depleted nights, reduces the delay between the intended and actual sleep attempt.

## Decision at the end

Keep the lightest useful version only if repeated bedtime delay improved without reducing sleep opportunity or worsening morning function. Adapt one element if the cue was wrong. If the routine did not help, made bedtime more effortful, or competed with ordinary life, leave it alone.
