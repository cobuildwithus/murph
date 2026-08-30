---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:take-better-naps
slug: take-better-naps
title: Take Better Naps
summary: Use naps to improve alertness or cover unusual sleep loss without regularly undermining nighttime sleep.
status: field-testing
quality: usable
aliases:
  - nap without feeling groggy
  - nap without ruining my sleep
categories:
  - goals
  - sleep
  - naps
goal:
  category: sleep
  outcomeKind: behavior
  goalPhrase: take better naps
  successSignals:
    - id: planned_nap
      kind: behavior
      label: Naps taken at a useful time and length
    - id: improved_alertness
      kind: function
      label: Better alertness after the nap
    - id: protected_night_sleep
      kind: function
      label: Nighttime sleep remains easy enough
  evidenceSourceKeys:
    - source_artifact:pmid-29073398
    - source_artifact:doi-10.26616/nioshpub2015115revised042020
  workflow:
    kind: habit_plan
    ownerSkillIds:
      - sleep-recovery-readiness
      - sleep-improvement
  startPrompt: Hey Murph, help me take better naps.
  indexable: true
safety:
  cautionLevel: low
---

A good nap has a job. It may restore alertness after a short night, support a night-shift plan, or give a brief reset before an evening demand. The best timing and length depend on that job. For many daytime workers, a short nap in the early afternoon provides benefit with less grogginess and less interference with nighttime sleep.

## What to do

- Decide why you are napping: ordinary afternoon dip, acute sleep loss, preparation for a night shift, or illness and recovery.
- For a routine alertness boost, start with 20 to 30 minutes. Set an alarm and include a few minutes to settle.
- Nap earlier rather than close to bedtime. The later the nap, the more likely it is to reduce the sleep pressure you need at night.
- Use a dark, quiet, comfortable place, but do not spend an hour trying to force a nap. Quiet rest is still useful.
- Leave a buffer after waking before driving, making important decisions, or doing hazardous work. Sleep inertia can briefly slow thinking and reaction time.
- Treat long naps as a specific tool. A roughly 90-minute opportunity may help after major sleep loss or before a night shift, but it also takes more time and can produce grogginess.

## A simple plan

Choose a consistent early-afternoon window for one week. Lie down for no more than 30 minutes and note three things: whether you slept, how alert you felt 30 minutes later, and whether nighttime sleep was harder. Keep the nap only if it improves the day without repeatedly delaying sleep at night.

If 20 minutes leaves you consistently groggy, test a 10- to 15-minute opportunity or allow a longer wake-up buffer. If you need recovery after a severely short night, test a roughly 90-minute opportunity earlier in the day, but do not assume it replaces the missing night. The tradeoff is more time and a greater chance of delaying bedtime.

If you work nights, the plan is different. A longer nap before the shift and a strategically timed short nap during an authorized break can help, but workplace rules and the need to clear sleep inertia matter. Protect a main sleep period at home; naps should not be expected to replace it.

## How to know it is working

The nap leaves you more alert after the initial grogginess, does not regularly push bedtime later, and helps you function without escalating caffeine. Judge the effect over several attempts, because whether you actually fall asleep will vary.

Use the same checkpoint each time: alertness 30 minutes after waking, then nighttime sleep onset. A nap that feels wonderful immediately but repeatedly adds an hour of wakefulness at bedtime may not be worthwhile. People who sleep normally at night and feel good during the day do not need naps for optimization.

## If you get stuck

If a short nap always becomes a two-hour sleep, the underlying issue may be inadequate nighttime sleep. If you cannot nap, use quiet eyes-closed rest and focus on the main sleep window. If naps worsen insomnia, stop them temporarily while addressing nighttime sleep. People with very late schedules may need an individualized timing plan.

## A quick note

An irresistible need to nap every day despite adequate nighttime sleep can signal a sleep disorder or another health problem. Discuss persistent excessive sleepiness with a clinician.

## Sources

- [NHLBI: healthy sleep habits](https://www.nhlbi.nih.gov/health/sleep-deprivation/healthy-sleep-habits)
- [NIOSH: napping as a fatigue countermeasure](https://www.cdc.gov/niosh/work-hour-training-for-nurses/longhours/mod7/08.html)
