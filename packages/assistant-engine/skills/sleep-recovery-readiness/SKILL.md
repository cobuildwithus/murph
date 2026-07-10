---
name: sleep-recovery-readiness
description: >
  Use when the user needs an acute readiness decision: train hard, modify, train easy, rest, deload, or start a short recovery block based on recent sleep, fatigue, soreness, illness context, low motivation, load, function, or wearable context. Use sleep-improvement for sleep mechanics, circadian-rhythm for clock timing, hrv-resting-heart-rate for HRV/RHR interpretation, and energy-fatigue for persistent tiredness.
---

# Sleep, recovery, and readiness

Use this as Murph operating guidance for the recovery decision itself. It is not a parallel sleep coach, circadian coach, wearable-metric interpreter, or fatigue workup.

## Owns

- Today's train-as-planned versus guarded, easy, or rest call.
- Whether accumulated fatigue warrants a short deload or recovery block.
- Training constraints to pass to the active strength, cardio, running, or competition skill.
- Safety escalation when sleepiness, illness, symptoms, injury, or impaired function makes the planned activity unsafe.
- A compact explanation of how recent sleep, soreness, motivation, load, symptoms, and wearable context changed the decision.

Do not create a readiness score, point system, mandatory questionnaire, sleep store, recovery engine, protocol catalog, streak, or CLI family.

## Hand Off

- Use `$MURPH_ASSISTANT_SKILLS_ROOT/sleep-improvement/SKILL.md` for sleep-onset difficulty, night awakenings, sleep duration, environment, wind-down routines, sleep-stage or sleep-score interpretation, and non-clinical melatonin framing.
- Use `$MURPH_ASSISTANT_SKILLS_ROOT/circadian-rhythm/SKILL.md` for chronotype, delayed or advanced schedules, jet lag, shift work, timed light, schedule regularity, and clock-shifting plans.
- Use `$MURPH_ASSISTANT_SKILLS_ROOT/hrv-resting-heart-rate/SKILL.md` for HRV/RHR trend interpretation, baseline deviations, wearable noise versus signal, illness or overreaching warnings, and chronic levers that move autonomic markers.
- Use `$MURPH_ASSISTANT_SKILLS_ROOT/energy-fatigue/SKILL.md` for persistent tiredness, daytime sleepiness, brain/body fatigue, post-illness fatigue, or lifestyle-versus-clinician triage.
- Use `physical-therapy` for new or changed pain, injury, weakness, numbness, loss of function, or rehab.
- Use `chronic-illness-support` or `chronic-pain-support` when flares, post-exertional malaise, pacing, or condition-specific limits matter. Never overwrite a PEM or flare plan with ordinary athletic-recovery logic.
- Use `behavior-followthrough` for recurring support and `experiment-onboarding` or `self-management-experiments` for a bounded recovery behavior test.

Compose with the owning skill in one user-facing answer. Do not make the user coordinate Murph's internal handoffs.

## Data First

Reuse the conversation, recent training, symptoms, soreness, sleep summaries, competitions, life stressors, illness clues, and connected wearable data before asking the user to repeat anything.

Ask at most one question per message, and only when it can change the route. Useful gaps are:

- immediate safety, dangerous sleepiness, or acute illness;
- whether the issue is isolated or accumulating;
- daytime function, coordination, concentration, mood, and whether this is sleepiness that could cause dozing or fatigue without dozing;
- recent load, performance, perceived effort, soreness, and warm-up response;
- the consequence of the planned session;
- measurement quality when wearable context is central.

Do not use a signal count or point total. Judge magnitude, persistence, context, and consequence. One severe or safety-critical finding can matter more than several mild ones.

## Decision Rules

### 1. Acute training readiness

Use when the question is whether to train hard, modify, train easy, or rest today.

Route away first when there is dangerous sleepiness, acute systemic illness, a concerning cardiopulmonary or neurological symptom, a new or materially changed pain problem, or a known flare/PEM plan. Do not relabel these as ordinary under-recovery.

A single short or disrupted night raises uncertainty; it does not automatically cancel every session. When the user is otherwise well and the activity can be safely probed, use a reversible warm-up check:

1. start with the normal graded warm-up;
2. keep the first meaningful effort clearly submaximal;
3. compare familiar effort, output, movement quality, and coordination with normal;
4. continue, cap, switch to easy, or stop based on that response.

A warm-up does not test every vigilance or judgment deficit and cannot clear dangerous drowsiness. It is not clearance for driving, machinery, open water, heights, traffic, heat, altitude, contact, maximal attempts, failure work, or other high-consequence activity.

Choose among these routes:

- **Planned:** function and warm-up are normal and the deviation is small.
- **Guarded:** train, but add a ceiling such as no maximal work, no failure, lower technical risk, lower heat exposure, or an early stop rule.
- **Easy/recovery:** preserve movement or routine while removing the main fatigue cost.
- **Rest:** function is impaired, symptoms or sleepiness make the session unsafe, the warm-up is clearly abnormal, or expected training value is low relative to risk and fatigue.

Low motivation alone is weak evidence. It matters more when persistent and paired with sleep loss, irritability, abnormal effort, falling performance, illness, or unresolved soreness.

### 2. Accumulated fatigue or deload

Use when fatigue appears to be building across sessions, a hard block, competition, travel disruption, or sustained life stress.

Accumulated fatigue is more plausible when several meaningful domains are persistently worse than normal: output, perceived effort, warm-up response, mood, sleep, soreness, illness, or ability to recover between sessions. Do not diagnose overtraining syndrome from chat or a wearable score.

Return a compact handoff to the training owner:

- why accumulated fatigue is suspected and how uncertain that is;
- the dominant stressor to reduce;
- the recovery objective;
- hard guardrails, such as removing maximal, failure, testing, high-risk, or long-duration work;
- the next reassessment trigger.

The active training skill owns the exact program. Use the smallest reduction likely to restore a normal response, and do not add make-up work. If fatigue does not improve after a reasonable reduction, or worsens, reconsider illness, injury, low energy availability, medication or substance effects, mood, sleep disorders, and other medical causes.

### 3. Safety or care escalation

Immediate safety outranks training. If the user cannot stay awake reliably, tell them to stop driving, operating machinery, swimming alone, working at heights, or doing another hazardous activity and get to a safe place. Caffeine, music, cold air, or willpower is not clearance to continue.

Route acute chest pain, fainting, severe or unusual breathing difficulty, new confusion or neurological symptoms, rapidly worsening illness, thoughts of self-harm, or inability to stay safe to urgent or emergency care as appropriate.

Prompt clinician or sleep-clinician review when there is repeated unintended sleep, substantial daytime sleepiness, persistent unrefreshing sleep despite adequate opportunity, loud or irregular snoring with witnessed pauses or gasping, fatigue or performance decline that does not rebound after a reasonable recovery adjustment, recurrent illness, unexplained weight or menstrual change, medication or substance effects needing supervised change, or escalating anxiety, depression, compulsive exercise, compensatory exercise, or intense distress around rest.

Do not diagnose sleep apnea, insomnia, overtraining syndrome, or another disorder from chat or consumer oxygen, breathing, stage, or readiness data. Use the pattern to create a concise care handoff.

## Wearable Context

Wearable data can inform a readiness call, but it does not own it.

- A green score never overrides clear symptoms or unsafe function.
- A red score alone does not mandate rest.
- Compare the user with their own usual pattern on the same device.
- Check wear time, fit, missing data, device or firmware changes, and unusual measurement conditions before reacting.
- Do not directly compare HRV values across people, devices, or measurement methods. Do not assume higher is always better.
- Treat sleep stages and proprietary composites as supporting, lower-confidence evidence.

When the user's main question is what the HRV/RHR, sleep-stage, sleep-score, or circadian signal means, hand off to the focused owner before recommending.

## Answer Shape

Lead with the recommendation when evidence supports a call:

1. **Call:** planned, guarded, easy/recovery, rest, recovery block, or care route.
2. **Why:** the one to three facts that changed the decision, plus important uncertainty.
3. **Action:** the exact guardrail, behavior, or handoff.
4. **Recheck:** what to observe and when the decision should change.

When another skill calls this layer, return only the route, supporting evidence, uncertainty, training constraints or recovery objective, reassessment trigger, and owning skill for the next action.

## Quality Gate

Before responding, check:

- Did I answer a readiness or recovery-block question rather than stealing sleep, circadian, HRV/RHR, or fatigue ownership?
- Did I reuse known context and avoid a generic intake?
- Did I prioritize safety, function, personal trends, and session consequence over a device score?
- Did I avoid signal counting, diagnosis, false precision, and shame?
- Did I leave exact programming and condition-specific action with the owning skill?
