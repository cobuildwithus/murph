---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:sleep-better-on-night-shifts
slug: sleep-better-on-night-shifts
title: Sleep Better on Night Shifts
summary: Protect a main sleep period and use light, naps, and caffeine deliberately around overnight work.
status: field-testing
quality: usable
aliases:
  - sleep better after night shift
  - get enough sleep working nights
categories:
  - goals
  - sleep
  - shift-work
goal:
  category: sleep
  outcomeKind: function
  goalPhrase: sleep better on night shifts
  successSignals:
    - id: protected_day_sleep
      kind: behavior
      label: A protected main sleep period after shifts
    - id: safer_shift_alertness
      kind: function
      label: Safer alertness during work and the commute
    - id: enough_total_sleep
      kind: function
      label: Enough total sleep across each 24-hour period
  evidenceSourceKeys:
    - source_artifact:doi-10.26616/nioshpub2015115revised042020
    - source_artifact:pmid-15713707
  workflow:
    kind: general_plan
    ownerSkillIds:
      - circadian-rhythm
      - sleep-recovery-readiness
  startPrompt: Hey Murph, help me sleep better on night shifts.
  indexable: true
safety:
  cautionLevel: high
---

Night work asks the body to stay alert when it is biologically prepared for sleep and to sleep when daylight promotes wakefulness. The aim is not to pretend nights are the same as days. It is to protect enough total sleep, reduce circadian conflict where possible, and keep the shift and commute safe.

## What to do

- Choose a main sleep block after the shift and defend it like an appointment. Household noise, calls, deliveries, and errands need a plan before you get home.
- Make the room dark, quiet, and cool. Use blackout curtains or an eye mask, silence notifications, and tell people in the home when you are unavailable.
- Use bright light during the early part of the shift when it supports alertness. Reduce light on the trip home with ordinary sunglasses when safe, then keep the sleep environment dark.
- Use caffeine early enough to help at work but stop several hours before the planned sleep. The exact cutoff depends on sensitivity and shift length.
- Consider a planned nap before the shift. A short nap can improve alertness; a longer nap may help before an extended night, provided there is time for grogginess to clear.
- Eat and move in ways that support the shift without turning the biological night into a series of heavy meals.

## A simple plan

For the next run of night shifts, map four times: the pre-shift nap, start of caffeine, caffeine cutoff, and main sleep block. Keep them as stable as work allows. After the shift, use a short repeatable sequence—small meal if needed, wash up, dark room, phone silenced—so errands do not consume the sleep window.

Aim for a main sleep period plus a nap if the main block alone is short. On days off, choose whether to stay partly delayed or switch back based on how many nights you work in a row and how long the break lasts. Frequent full reversals can create additional circadian disruption.

Ask the household and employer for concrete support: protected quiet hours, predictable scheduling, reasonable shift length, and authorized breaks. Shift-work sleep is partly a work-design issue, not solely an individual habit.

## How to know it is working

Track total sleep across 24 hours, alertness during the biologically hardest part of the shift, and sleepiness on the drive home. A main sleep block becoming more predictable is progress even if daytime sleep remains lighter than nighttime sleep.

Do not grade the plan by a wearable's sleep-stage percentages. Daytime sleep can be scored differently, and safety and total restorative opportunity matter more.

## If you get stuck

If the room is good but sleep remains short, look at caffeine timing, bright morning light, errands, childcare, and an unrealistic expectation to switch schedules every day. For permanent nights, partial circadian adaptation may be possible. For rapidly rotating shifts, full adaptation is usually not a realistic goal, so focus on protected sleep and fatigue management.

Persistent insomnia or excessive sleepiness tied to the schedule may be shift work disorder. A sleep clinician can help with timed light, melatonin, and prescription options when appropriate.

## A quick note

The commute after a night shift is a high-risk period. If you are nodding off or missing parts of the drive, stop, nap in a safe place, or arrange another ride. Caffeine alone is not a guarantee of safe driving.

## Sources

- [AASM 2025 clinical practice guideline for shift work disorder](https://aasm.org/wp-content/uploads/2025/08/Extrinsic-CRSWD-CPG_SWD_May2025.pdf)
- [NIOSH training on shift work and long hours](https://www.cdc.gov/niosh/work-hour-training-for-nurses/longhours/)
