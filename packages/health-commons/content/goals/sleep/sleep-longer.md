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

Sleeping longer starts with one question: **is there enough time available for sleep?** A schedule that allows six hours in bed cannot produce eight hours of sleep, whatever the supplement or wearable. Most adults do best with at least seven hours regularly, though needs vary.

## What to do

- Pick a wake time you can keep most days and work backward to a realistic sleep window.
- Add time gradually: move bedtime earlier by 15 to 30 minutes every few nights, not in one big jump.
- Get outdoor light and some movement early in the day. Both anchor the body clock.
- Protect the last hour from work that runs long. A short shutdown routine beats an elaborate bedtime ritual.
- Watch caffeine and alcohol as possible disruptors, especially when they land later than usual.

## A simple plan

For two weeks, keep the same wake time within about an hour. Start with a sleep window 30 minutes longer than usual. Note bedtime, wake time, a rough sleep estimate, and next-day alertness. If you fall asleep well but still wake before the alarm, add another 15 minutes.

Before adding more time, look at where the evening goes. Caregiving and a second job need structural help; unplanned television, scrolling, and chores may respond to a clear stop time. Move one recurring task earlier or shrink it. Don't build the window by cutting exercise, connection, or your only quiet time unless you replace what it gives you.

Progress in stages. Week one protects 30 extra minutes. Week two tests whether you actually use it. Week three moves bedtime again only if sleep stays efficient and mornings improve. On weekends, keep wake time near normal and go to bed a bit earlier instead of sleeping in. A brief early-afternoon nap can help during the transition; a long late nap eats the sleep pressure you need that night.

Don't spend hours awake in bed forcing extra sleep. If an earlier bedtime just produces more wakefulness, return to a comfortable time and work on why sleep is difficult.

## How to know it is working

Judge your typical week, not your best night. Good signs: a longer median sleep duration, less alarm dependence, and better daytime alertness without a growing struggle to fall asleep.

The number doesn't need to rise every night. If duration stays flat but you feel more rested, the steadier routine may still be helping. If time in bed rises while sleep and daytime function don't, stop expanding it. Wearables often count quiet wakefulness as sleep, so compare their trend with your own estimate and how you function.

## If you get stuck

Enough time in bed with persistently short or broken sleep points to a different problem: insomnia, sleep apnea, restless legs, pain, medication effects, or a schedule that fights your body clock. Work on that barrier instead of stretching the window indefinitely.

## A quick note

Regularly struggling to stay awake, especially while driving, deserves prompt medical attention. Persistent sleep trouble or loud snoring with gasping is also worth raising with a clinician.

## Sources

- [American Academy of Sleep Medicine and Sleep Research Society: recommended sleep duration for adults](https://jcsm.aasm.org/doi/10.5664/jcsm.4758)
- [NHLBI: healthy sleep habits](https://www.nhlbi.nih.gov/health/sleep-deprivation/healthy-sleep-habits)
