---
name: sleep-recovery-readiness
description: Use for sleep, fatigue, soreness, low motivation, recovery/readiness, train-hard-versus-modify-versus-rest decisions, deload or recovery blocks, naps, shift work, travel or jet lag, and wearable sleep or recovery trends. This is a reusable decision layer that composes with training, PT, chronic-illness or pain, behavior, experiment, food-journal, and care-navigation work rather than replacing them.
---

# Sleep, recovery, and readiness

## Goal

Help the user make the smallest safe, useful recovery decision:

- leave normal variation alone;
- train as planned;
- train with guardrails;
- choose an easy or recovery session;
- rest;
- start or continue a short recovery block or deload;
- improve one part of the sleep system; or
- seek appropriate care.

This is a reasoning layer over Murph's existing training and health skills. It should turn sleep, fatigue, recent load, function, context, and optional wearable trends into a clear next action without pretending recovery is one knowable score.

Do not create a readiness score, point system, mandatory questionnaire, sleep store, recovery engine, protocol catalog, streak, or CLI family.

## Ownership

This skill owns the recovery decision and its rationale. It does not own every action that follows.

- The active strength, cardio, or competition skill owns exact exercise selection, volume, intensity, pace, progression, taper, and return-to-training programming. Return constraints and a recovery objective to that skill.
- `physical-therapy` owns new or changed pain, injury, rehabilitation, and pain-specific exercise modification.
- `chronic-illness-support` and `chronic-pain-support` own flares, post-exertional malaise, pacing, and condition-specific fatigue or pain plans. Never overwrite an established PEM or flare plan with ordinary athletic-recovery logic.
- `food-journal` owns low-friction food capture. The relevant nutrition or training skill owns detailed fueling decisions.
- `behavior-followthrough` owns recurring reminders, accountability, repeated-miss repair, and ongoing habit support.
- `experiment-onboarding` and `self-management-experiments` own formal bounded experiments, measures, and review rules.
- Care-navigation surfaces own booking, referral, and clinician follow-through. Use `computer-use` when the user asks Murph to carry out a browser-based care task.

Compose with the owning skill instead of duplicating its intake, records, or protocol. Produce one integrated answer; do not make the user coordinate Murph's internal skills.

## Core decision policy

Use one shared loop across all five modes:

1. **Safety and function:** remove routes made unsafe by dangerous sleepiness, acute illness, concerning symptoms, new injury, or a known flare/PEM plan.
2. **Horizon:** decide whether this is one session, an accumulating pattern, a sleep-system problem, a device-data question, or a care issue.
3. **Deviation:** compare with the user's own normal using magnitude, persistence, context, and recent performance—not a signal count. Personal baseline helps interpret change; it does not prove that chronic short sleep or persistent sleepiness is healthy.
4. **Consequence:** be more conservative when an error would be hard to reverse or could harm the user or others.
5. **Action:** choose the least disruptive route that protects safety and adaptation.
6. **Recheck:** say what to observe and when the decision should change.

Do not use a signal count or point total. Judge magnitude, persistence, context, and consequence. One severe or safety-critical finding can matter more than several mild ones.

Prefer a reversible probe when it is safe. A graded warm-up can inform an ordinary training decision, but it does not test every vigilance or judgment deficit and cannot clear dangerous drowsiness or make a high-consequence activity safe.

## Low-friction assessment

Reuse the conversation, recent training, symptoms, sleep logs, competitions, travel or shift context, and connected wearable data before asking the user to repeat anything.

Only inspect information that could change the route:

- immediate safety and illness;
- whether the problem is isolated or building;
- daytime function, coordination, concentration, mood, and whether this is sleepiness (could doze) or fatigue without a tendency to fall asleep;
- recent load, performance, perceived effort, soreness, and warm-up response;
- planned-session consequence;
- plausible context such as life stress, travel, shift work, caffeine, alcohol, meals, medication, heat, or altitude;
- device trend and data quality when wearables matter.

Ask at most one decision-changing question before recommending, unless immediate safety requires more. Do not turn a simple readiness question into a full sleep intake.

## The five modes

Choose the narrowest mode that resolves the user's current need. A reply may combine two modes, such as wearable interpretation plus today's training decision, but do not preload all five.

### 1. Acute readiness check

Use when the user asks whether to train hard, modify the session, train easy, or rest today.

**Route away first** when there is dangerous sleepiness, acute systemic illness, a concerning cardiopulmonary or neurological symptom, a new or materially changed pain problem, or a known flare/PEM plan. Do not relabel these as ordinary under-recovery.

A single short or disrupted night raises uncertainty; it does not automatically cancel every session. When the user is otherwise well and the activity can be safely probed:

1. start with the normal graded warm-up;
2. keep the first meaningful effort clearly submaximal;
3. compare familiar effort, output, movement quality, and coordination with normal;
4. continue, cap, switch to easy, or stop based on that response.

Useful downgrade signs include a clear effort-output mismatch, worsening coordination, unusual dizziness or breathlessness, new pain, or a warm-up that deteriorates instead of settling.

Scale the recommendation to consequence. Maximal attempts, failure work, complex or high-speed skill, contact, open water, remote terrain, heights, traffic, machinery, heat, altitude, and long-duration work deserve more margin than easy, familiar, reversible training.

Low motivation alone is weak evidence. It matters more when it is persistent and accompanied by sleep loss, irritability, abnormal effort, falling performance, illness, or unresolved soreness.

Choose among these plain-language routes:

- **Planned:** function and warm-up are normal and the deviation is small.
- **Guarded:** train, but add a ceiling such as no maximal work, no failure, lower technical risk, or an early stop rule.
- **Easy/recovery:** when movement is useful and wanted, preserve routine while removing the session's main fatigue cost; otherwise rest.
- **Rest:** the session is unsafe, function is meaningfully impaired, the warm-up is clearly abnormal, or expected training value is low relative to risk and fatigue.

### 2. Sleep routine improvement

Use when the main problem is short, late, inconsistent, fragmented, or hard-to-initiate sleep.

Find the dominant bottleneck before giving advice:

- **Opportunity or timing:** the schedule does not allow enough sleep, or sleep is attempted at a poorly aligned time.
- **Arousal or insomnia:** there is enough opportunity, but sleep is persistently hard to start or maintain.
- **Bedtime procrastination:** the user intends to sleep but continues another activity.
- **Environment or exposure:** light, noise, temperature, caregiving, substances, medication, meals, work, or stimulating content plausibly interferes.
- **Irregular schedule:** shifts, travel, school, caregiving, or rotating obligations make a conventional routine unrealistic.

Pick one lever that addresses the bottleneck. If there is no meaningful impairment or repeatable problem, leave ordinary variation alone. Do not dump a generic sleep-hygiene checklist.

A practical routine usually needs only:

- an **anchor** the user can repeat, often a feasible wake-time range or another stable cue; prefer workable regularity, but do not sacrifice needed sleep only to hit the clock;
- an **off-ramp** that reduces decisions and stimulation;
- a **fallback** small enough to use on late or depleted nights.

Protect adequate sleep opportunity before optimizing stages, supplements, or rituals. Sleep need varies; use the user's longer-term function and pattern rather than treating one duration as a nightly pass/fail threshold. Do not treat feeling accustomed to chronic short sleep as proof that it is adequate.

Treat common exposures as hypotheses, not moral rules:

- For **caffeine**, reason from dose, timing, sensitivity, and intended sleep. Move the last meaningful dose earlier or reduce a late dose as a concrete test; do not impose one universal cutoff or ignore withdrawal and feasibility.
- For **alcohol**, explain that sedation is not the same as restorative sleep. Test an earlier, smaller, or alcohol-free evening when it is a plausible contributor.
- For **meals**, target a large, reflux-triggering, or unusually late meal only when it plausibly affects sleep. Do not use blanket clock-time bans.
- For **screens**, identify the mechanism: light, arousing content, time displacement, autoplay, work, or social obligation. Match the boundary to the mechanism instead of blaming blue light alone.
- For **evening exercise**, do not assume it is harmful. Adjust timing or intensity only when the user's pattern suggests that a late, activating session is delaying sleep.

Bedtime procrastination is often an attempt to reclaim autonomy, decompress, avoid tomorrow, finish open work, or continue a highly reinforcing activity. Preserve the needed reward, move some of it earlier, add a clear stopping cue, and make the fallback tiny. Use `behavior-followthrough` when repeated support or friction repair becomes central.

Do not respond to persistent insomnia by adding stricter rules, forcing an earlier bedtime, or extending time in bed indefinitely. Sleep hygiene alone is not a complete treatment for chronic insomnia. Route persistent or impairing difficulty to evidence-based insomnia care, especially CBT-I. Do not casually prescribe clinical sleep restriction, medication changes, antihistamines, melatonin dosing, or supplements.

**Naps, shifts, and travel** are context tools, not separate protocol catalogs:

- Use a nap for a defined objective such as acute alertness, lost sleep, shift work, travel, or pre-event function. A brief nap, often around 20–30 minutes, is a practical default when quick recovery and less inertia matter; consider a longer opportunity only when there is enough time to wake fully and it will not undermine the next main sleep period. Allow a wake-up margin before driving, precision work, or another safety-critical task.
- For shift work, prioritize total sleep across 24 hours, a protected recurring sleep block when feasible, planned supplemental sleep, a dark/quiet sleep environment, light and caffeine aligned with the intended wake period, and a safe commute.
- For travel, separate travel fatigue from circadian jet lag. Ask direction, time zones, arrival, trip length, and event timing only when a schedule is needed. Protect sleep before departure, use strategically timed light and darkness, and reduce training consequence during disruption. Keep light advice broad until direction and timing are known because mistimed light can shift the clock the wrong way. For short trips, full phase adaptation may not be worth pursuing.
- Do not give precise melatonin or prescription timing without contraindication review and a reliable phase-shift plan; route medication questions to a clinician or pharmacist.

### 3. Deload or recovery-block decision

Use when fatigue appears accumulated across sessions, a hard block, competition, travel, or sustained life stress.

Accumulated fatigue is more plausible when the user's response is persistently worse than normal across meaningful domains: output, perceived effort, warm-up response, mood, sleep, soreness, illness, or ability to recover between sessions. Do not require a fixed number of signals, and do not diagnose overtraining syndrome from chat or a wearable score.

A deload or recovery block is an objective, not a universal percentage or seven-day template. This skill should return:

- why accumulated fatigue is suspected and how uncertain that is;
- the dominant stressor to reduce;
- the recovery objective;
- hard guardrails, such as removing maximal, failure, testing, or high-risk work;
- the next meaningful reassessment point.

The active training skill owns the exact program. It may reduce volume, intensity of effort, duration, frequency, technical complexity, or another source of fatigue while preserving safe movement or routine. A competition taper is a different problem and remains owned by the competition skill.

Use the smallest reduction likely to restore a normal response. Do not add make-up work. If fatigue does not improve after a reasonable reduction, or worsens, reconsider illness, injury, low energy availability, medication or substance effects, mood, sleep disorders, and other medical causes instead of extending an indefinite self-directed deload.

### 4. Wearable trend interpretation

Use when sleep duration, stages, HRV, resting heart rate, respiratory rate, temperature, strain, or a proprietary readiness score is central to the question.

Treat the device as a measurement layer, not the decision owner:

1. check wear time, fit, missing data, device or firmware changes, and unusual measurement conditions;
2. compare with the same user's usual pattern on the same device;
3. look at persistence and related trends rather than one outlier;
4. reconcile the data with symptoms, function, load, and context;
5. choose an action proportional to the consequence of being wrong.

A green score never overrides clear symptoms or unsafe function. A red score alone does not mandate rest.

Broad sleep timing and duration trends are generally more actionable than nightly stage minutes. Resting-heart-rate, HRV, respiratory-rate, and temperature trends can add context when measured consistently. Sleep stages and proprietary composites are supporting, lower-confidence evidence; do not ask the user to chase REM or deep-sleep minutes.

Do not directly compare HRV values across people, devices, or measurement methods. Do not assume higher is always better. Interpret direction, magnitude, persistence, measurement consistency, and context.

When device data and the user disagree, investigate the mismatch rather than automatically choosing either. A well-functioning user with one poor score may use a normal warm-up and recheck. A poorly functioning user with a green score should not be reassured into unsafe training.

If tracking increases anxiety, compulsive checking, time in bed, or plan changes after every fluctuation, reduce information before adding more: hide stage details, delay checking, review trends less often, or take a tracker break. Do not turn recovery into another performance contest.

### 5. Care-navigation escalation

Use when the problem may be unsafe, persistent, or outside ordinary self-management.

**Immediate safety:** when the user cannot stay awake reliably, tell them to stop driving, operating machinery, swimming alone, working at heights, or doing another hazardous activity and get to a safe place. Caffeine, music, cold air, or willpower is not clearance to continue. Route acute chest pain, fainting, severe or unusual breathing difficulty, new confusion or neurological symptoms, rapidly worsening illness, thoughts of self-harm, or inability to stay safe to urgent or emergency care as appropriate.

**Prompt clinician or sleep-clinician review** when there is:

- loud or irregular snoring with witnessed pauses, gasping, choking, or substantial daytime sleepiness;
- repeated unintended sleep episodes or sleepiness that impairs work, school, caregiving, or driving;
- persistent difficulty falling or staying asleep, especially with daytime distress or impairment;
- persistent unrefreshing sleep despite adequate opportunity;
- fatigue or performance decline that does not rebound after a reasonable recovery adjustment;
- recurrent illness, unexplained weight or menstrual change, libido change, cold intolerance, or other clues to low energy availability or systemic illness;
- recurrent leg urges, unusual nighttime behavior, or injury risk during sleep;
- medication, supplement, alcohol, or other substance effects that may need supervised change;
- escalating anxiety, depression, sleep-related distress, compulsive exercise, compensatory exercise, or intense loss of control around rest.

Do not diagnose sleep apnea, insomnia, overtraining syndrome, or another disorder from chat or consumer oxygen, breathing, stage, or readiness data. Use the pattern to create a concise care handoff.

## Behavior and communication

Recovery support should make action easier, not make the user feel monitored or morally graded.

- Recommend one cue-linked action the user can execute while tired.
- Include a fallback when it is safe and useful.
- Preserve needed autonomy or decompression instead of deleting the only rewarding part of the evening.
- Frame rest as part of the training dose, not proof of weakness.
- After a poor night or missed routine, repair the cue, environment, or plan; do not turn it into punishment, rigid debt repayment, or a compensatory hard workout.
- Use `behavior-followthrough` for a recurring support loop and `self-management-experiments` for a bounded comparison with a review date.

## Response contract

Lead with the recommendation. A useful answer usually has four parts:

1. **Call:** leave it alone, planned, guarded, easy/recovery, rest, recovery block, one sleep lever, or care route.
2. **Why:** the one to three facts that actually drove the decision, plus meaningful uncertainty.
3. **Action:** the exact guardrail, behavior, or handoff.
4. **Recheck:** what to observe and when to change course.

Ask one question only when the answer could materially change the call. Use plain language rather than exposing internal route labels or a pseudo-clinical object.

When another skill calls this layer, return a compact handoff:

- current route and how tentative it is;
- supporting evidence and important uncertainty;
- training constraints or recovery objective;
- reassessment trigger;
- owning skill for the next action.

## Quality gate

Before responding, check:

- Did I choose the narrowest useful mode?
- Did I reuse known context and avoid a generic intake?
- Did I prioritize safety, function, personal trends, and session consequence over a device score?
- Did I avoid signal counting, diagnosis, and false precision?
- Did I leave exact programming and condition-specific action with the owning skill?
- Did I give one practical next action and a recheck point—or explicitly leave noise alone?
- Did I reduce shame, perfectionism, and score chasing?
- Is this the smallest intervention likely to help?
