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

A good nap has a job: restoring alertness after a short night, fitting a night-shift plan, or giving a brief reset before an evening demand. Timing and length depend on that job. For many daytime workers, a short early-afternoon nap gives the benefit with less grogginess and less interference with nighttime sleep.

## What to do

- Decide why you're napping: the ordinary afternoon dip, acute sleep loss, preparing for a night shift, or illness and recovery.
- For a routine alertness boost, start with 20 to 30 minutes. Set an alarm and allow a few minutes to settle.
- Nap earlier rather than near bedtime. The later the nap, the more it eats the sleep pressure you need at night.
- Use a dark, quiet, comfortable spot, but don't spend an hour trying to force it. Quiet rest still helps.
- Leave a buffer after waking before driving, important decisions, or hazardous work. Sleep inertia briefly slows thinking and reaction time.
- Treat long naps as a specific tool. A roughly 90-minute opportunity may help after major sleep loss or before a night shift, but it costs more time and can leave you groggy.

## A simple plan

Pick a consistent early-afternoon window for one week. Lie down for no more than 30 minutes and note whether you slept, how alert you felt 30 minutes later, and whether nighttime sleep was harder. Keep the nap only if it improves the day without repeatedly delaying sleep at night.

If 20 minutes leaves you consistently groggy, try a 10- to 15-minute opportunity or a longer wake-up buffer. After a severely short night, try a roughly 90-minute opportunity earlier in the day, but don't assume it replaces the missing night; it costs more time and is more likely to push bedtime later.

Night work changes the plan. A longer nap before the shift and a well-timed short nap during an authorized break can help, but workplace rules and the need to clear sleep inertia matter. Protect a main sleep period at home; naps can't replace it.

## How to know it is working

The nap leaves you more alert once the initial grogginess passes, doesn't regularly push bedtime later, and helps you function without escalating caffeine. Judge it over several attempts, since whether you actually fall asleep varies.

Use the same checkpoint each time: alertness 30 minutes after waking, then how easily you fell asleep that night. A nap that feels great but repeatedly adds an hour of wakefulness at bedtime may not be worth it. If you sleep normally at night and feel good by day, you don't need to add naps.

## If you get stuck

If a short nap always becomes a two-hour sleep, the real issue may be too little nighttime sleep. If you can't nap, use quiet eyes-closed rest and focus on the main sleep window. If naps worsen insomnia, stop them for now and work on nighttime sleep. People with very late schedules may need an individualized timing plan.

## A quick note

An irresistible need to nap every day despite enough nighttime sleep can signal a sleep disorder or another health problem. Discuss persistent excessive sleepiness with a clinician.

## Sources

- [NHLBI: healthy sleep habits](https://www.nhlbi.nih.gov/health/sleep-deprivation/healthy-sleep-habits)
- [NIOSH: napping as a fatigue countermeasure](https://www.cdc.gov/niosh/work-hour-training-for-nurses/longhours/mod7/08.html)
