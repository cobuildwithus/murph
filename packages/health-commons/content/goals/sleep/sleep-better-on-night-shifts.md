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

Night work asks your body to stay alert when it's primed for sleep, then sleep when daylight pushes it awake. The job is to protect enough total sleep, reduce circadian conflict where you can, and keep the shift and commute safe.

## What to do

- Choose a main sleep block after the shift and defend it like an appointment. Household noise, calls, deliveries, and errands need a plan before you get home.
- Make the room dark, quiet, and cool: blackout curtains or an eye mask, notifications silenced, and housemates told when you're unavailable.
- Use bright light early in the shift when it helps alertness. Wear ordinary sunglasses on the trip home when safe, then keep the bedroom dark.
- Use caffeine early enough to help at work and stop several hours before planned sleep. The exact cutoff depends on your sensitivity and shift length.
- Consider a planned nap before the shift. A short nap can improve alertness; a longer one may help before an extended night if there's time for grogginess to clear.
- Eat and move to support the shift without making the biological night a string of heavy meals.

## A simple plan

For the next run of nights, map four times: the pre-shift nap, the start of caffeine, the caffeine cutoff, and the main sleep block. Keep them as stable as work allows. After the shift, run a short repeatable sequence (small meal if needed, wash up, dark room, phone silenced) so errands don't eat the sleep window.

If the main block is short, add a nap. On days off, decide whether to stay partly delayed or switch back based on how many nights you work in a row and how long the break lasts. Frequent full reversals can add circadian disruption.

Ask your household and employer for concrete help: protected quiet hours, predictable scheduling, reasonable shift length, and authorized breaks. Shift-work sleep is partly a work-design problem, not just a personal habit.

## How to know it is working

Track total sleep across 24 hours, alertness during the hardest part of the shift, and sleepiness on the drive home. A more predictable main sleep block is progress, even if daytime sleep stays lighter than night sleep.

Don't grade the plan by a wearable's sleep-stage percentages. Daytime sleep can be scored differently, and safety and total restorative opportunity matter more.

## If you get stuck

If the room is good but sleep is still short, check caffeine timing, bright morning light, errands, childcare, and whether you're trying to switch schedules every day. On permanent nights, partial circadian adaptation may be possible. On rapidly rotating shifts, full adaptation usually isn't realistic, so focus on protected sleep and fatigue management.

Persistent insomnia or excessive sleepiness tied to the schedule may be shift work disorder. A sleep clinician can help with timed light, melatonin, and prescription options when appropriate.

## A quick note

The commute after a night shift is a high-risk period. If you're nodding off or missing parts of the drive, stop, nap somewhere safe, or arrange another ride. Caffeine alone doesn't guarantee safe driving.

## Sources

- [AASM 2025 clinical practice guideline for shift work disorder](https://aasm.org/wp-content/uploads/2025/08/Extrinsic-CRSWD-CPG_SWD_May2025.pdf)
- [NIOSH training on shift work and long hours](https://www.cdc.gov/niosh/work-hour-training-for-nurses/longhours/)
