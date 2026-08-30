---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:sleep-longer
slug: sleep-longer
title: Sleep Longer
summary: Make enough room for sleep and gradually turn that extra time into sleep you can actually use.
status: field-testing
quality: usable
aliases:
  - get more sleep
  - increase sleep duration
categories:
  - goals
  - sleep
  - sleep-duration
goal:
  category: sleep
  parentGoalKey: goal_template:sleep-better
  outcomeKind: function
  goalPhrase: sleep longer
  successSignals:
    - id: sleep_opportunity
      kind: behavior
      label: More nights with enough time reserved for sleep
    - id: typical_sleep_duration
      kind: function
      label: A longer typical night of sleep
    - id: daytime_energy
      kind: symptom
      label: Better daytime energy
  evidenceSourceKeys:
    - source_artifact:pmid-29073398
    - source_artifact:pmid-37684151
  workflow:
    kind: habit_plan
    ownerSkillIds:
      - sleep-improvement
      - sleep-recovery-readiness
  startPrompt: Hey Murph, help me sleep longer.
  indexable: true
safety:
  cautionLevel: low
---

Sleeping longer usually starts with a simple question: **is there enough time available for sleep?** If your schedule allows six hours in bed, no supplement or wearable can turn that into eight hours of sleep. Most adults do best with at least seven hours regularly, although individual needs vary.

## What to do

- Pick a wake time you can keep on most days, then work backward to create a realistic sleep window.
- Add time gradually. Move bedtime earlier by 15 to 30 minutes every few nights instead of making a dramatic jump you cannot sustain.
- Get outdoor light and some movement early in the day. Both help anchor the body clock.
- Protect the final hour from work that routinely runs long. A short shutdown routine is often more useful than an elaborate bedtime ritual.
- Keep caffeine and alcohol visible as possible sleep disruptors, especially when they occur later than usual.

## A simple plan

For two weeks, keep the same wake time within about an hour. Start with a sleep window that gives you 30 more minutes than usual. Note bedtime, wake time, a rough sleep-duration estimate, and how alert you feel the next day. If you are falling asleep reasonably well but still waking before the alarm, add another 15 minutes.

Before adding more time, audit where the current evening goes. Separate obligations from optional drift: caregiving and a second job need structural help, while unplanned television, scrolling, and chores may respond to a clear stop time. Move one recurring task earlier or make it smaller. Do not build the new sleep window by removing exercise, connection, or the only quiet part of the day without replacing what that time provides.

Progress in stages. Week one protects 30 extra minutes; week two tests whether you actually use it; week three adjusts bedtime again only if sleep remains efficient and mornings improve. On weekends, keep wake time near normal and use a somewhat earlier bedtime rather than a very late lie-in. A brief early-afternoon nap can help during the transition, but a long late nap may consume the sleep pressure needed that night.

Do not spend hours awake in bed trying to force extra sleep. If an earlier bedtime simply produces more wakefulness, return to a comfortable time and work on the reason sleep is difficult.

## How to know it is working

Look at your typical week, not your best night. Useful signs are a longer median sleep duration, less dependence on the alarm, and better daytime alertness without a growing struggle to fall asleep.

The number does not need to rise every night. If you reserve more time but sleep duration stays flat while restfulness improves, the stable routine may still be helping. If time in bed rises while sleep and daytime function do not, stop expanding it. Consumer wearables are useful for approximate timing, but quiet wakefulness is often counted as sleep; compare their trend with your own estimate and function.

## If you get stuck

Enough time in bed with persistently short or broken sleep points to a different problem: insomnia, sleep apnea, restless legs, pain, medication effects, or a schedule that conflicts with your body clock. Work on that barrier rather than expanding the sleep window indefinitely.

## A quick note

Regularly struggling to stay awake—especially while driving—deserves prompt medical attention. Persistent sleep trouble or loud snoring with gasping is also worth discussing with a clinician.

## Sources

- [American Academy of Sleep Medicine and Sleep Research Society: recommended sleep duration for adults](https://jcsm.aasm.org/doi/10.5664/jcsm.4758)
- [NHLBI: healthy sleep habits](https://www.nhlbi.nih.gov/health/sleep-deprivation/healthy-sleep-habits)
