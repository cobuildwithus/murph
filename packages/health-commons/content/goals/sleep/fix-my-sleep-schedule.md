---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:fix-my-sleep-schedule
slug: fix-my-sleep-schedule
title: Fix My Sleep Schedule
summary: Move a drifted sleep schedule toward the times your life requires using gradual timing and strong daily cues.
status: field-testing
quality: usable
aliases:
  - reset my sleep schedule
  - get my sleep schedule back on track
categories:
  - goals
  - sleep
  - circadian-rhythm
goal:
  category: sleep
  outcomeKind: behavior
  goalPhrase: fix my sleep schedule
  successSignals:
    - id: target_wake_time
      kind: behavior
      label: Waking near the target time
    - id: target_sleep_time
      kind: behavior
      label: Becoming sleepy near the target bedtime
    - id: stable_schedule
      kind: milestone
      label: Holding the new schedule for two weeks
  evidenceSourceKeys:
    - source_artifact:pmid-26414986
    - source_artifact:pmid-37684151
  workflow:
    kind: habit_plan
    ownerSkillIds:
      - circadian-rhythm
      - sleep-improvement
  startPrompt: Hey Murph, help me fix my sleep schedule.
  indexable: true
safety:
  cautionLevel: low
---

A drifted sleep schedule moves more easily with **consistent timing, morning light, and small steps** than with an all-nighter. Decide where the schedule needs to land, then shift the whole day toward it.

## What to do

- Set the target wake time first. It is the strongest anchor because it sets when sleep pressure starts building again.
- Start with a small wake-time shift, often 15 to 30 minutes, and hold it for one to three days before moving again. This is a starting pace, not a universal prescription.
- Get outdoor light after waking. In the evening, dim bright light and stop whatever keeps pushing bedtime later.
- Move meals, exercise, and social plans toward the new schedule too; the body clock reads the whole pattern of cues.
- Don't sleep far into the day after a poor night. Use a short early-afternoon nap instead while the schedule settles.

## A simple plan

Write down your current average sleep and wake times and the targets, and pick a wake-time step you can keep up. Hold each step until you can get up without falling back asleep, then shift again. Keep the final target for at least two weeks, weekends included where possible.

If you need a large shift for work or school, start several days ahead. Expect the first mornings to feel harder, and protect enough total sleep during the change.

Let the direction of the shift guide the evening. To move earlier, bring wake time, morning light, meals, and the work cutoff earlier together. To move later, don't lock in a very early rhythm with pre-dawn light and an early bedtime; badly timed light works against you.

An all-nighter is not a reset. It makes you sleepy but does not reliably put the body clock where you want it, and the long recovery sleep afterward can restart the drift. When a deadline forces a fast change, keep a safe minimum of sleep and return to gradual steps afterward.

## How to know it is working

The new wake time gets less punishing, sleepiness arrives closer to the target bedtime, and weekends stop undoing the week. Judge the trend over seven days.

Also track the midpoint of sleep, halfway between estimated sleep onset and final waking, alongside the two clock times. It should move gradually toward the target without total sleep collapsing. If the clock shifts but daytime sleepiness jumps, slow down or hold the current step for several days.

## If you get stuck

If you consistently cannot sleep until very late despite a stable routine, you may have delayed sleep-wake phase disorder rather than a bad habit. Shift work, medications, mood changes, and insomnia can also need a more tailored approach.

Often the real blocker is social. A partner's schedule, late work messages, gaming with friends in another time zone, or the household morning routine may keep pulling the clock back. Change the recurring cue or negotiate the schedule instead of treating each night as a fresh failure.

## A quick note

Melatonin and bright-light devices are timing tools, not generic sedatives. Timing matters, so ask a clinician if you have bipolar disorder, significant eye disease, pregnancy, medication interactions, or a suspected circadian disorder.

## Sources

- [AASM 2015 guideline for intrinsic circadian rhythm sleep-wake disorders](https://pubmed.ncbi.nlm.nih.gov/26414986/)
- [NHLBI: healthy sleep habits](https://www.nhlbi.nih.gov/health/sleep-deprivation/healthy-sleep-habits)
