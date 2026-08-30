---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:adjust-to-daylight-saving-time
slug: adjust-to-daylight-saving-time
title: Adjust to Daylight Saving Time
summary: Shift sleep gradually around the clock change and protect alertness during the roughest days.
status: field-testing
quality: usable
aliases:
  - handle the time change better
  - adjust to the clocks changing
categories:
  - goals
  - sleep
  - circadian-rhythm
  - seasonal
goal:
  category: sleep
  outcomeKind: event
  goalPhrase: adjust to daylight saving time
  successSignals:
    - id: shifted_sleep_timing
      kind: behavior
      label: Sleep and wake timing aligned with the new clock
    - id: protected_sleep_duration
      kind: function
      label: Sleep duration protected through the transition
    - id: stable_daytime_alertness
      kind: function
      label: Safer daytime alertness after the change
  evidenceSourceKeys:
    - source_artifact:pmid-37684151
    - source_artifact:pmid-18041479
  workflow:
    kind: general_plan
    ownerSkillIds:
      - circadian-rhythm
      - sleep-recovery-readiness
  startPrompt: Hey Murph, help me adjust to daylight saving time.
  indexable: true
safety:
  cautionLevel: low
---

The spring clock change effectively asks you to wake an hour earlier overnight; the fall change moves the clock later. Most people adapt, but sleep loss and circadian misalignment can make the first several days harder. A gradual shift, enough sleep, and correctly timed light can make the change less disruptive.

## What to do

- For the spring change, move bedtime and wake time 15 to 20 minutes earlier for three or four days before the clock moves.
- For the fall change, move later in similar small steps if early waking is a recurring problem. Many people need less preparation for this direction.
- Shift meals, exercise, and children's or household routines along with sleep. The body clock responds to a pattern of timing cues.
- Get outdoor light after the new wake time. In spring, reduce very bright late-evening light that encourages a later rhythm.
- Protect the weekend from avoidable sleep loss. The clock change is a poor night to add a late party, early drive, or overnight work if those can be moved.
- Use a short early-afternoon nap when needed, but avoid a long late nap that delays the new bedtime.

## A simple plan

Beginning Wednesday or Thursday before the change, shift the household schedule by 15 minutes each day. Move the alarm, first light exposure, breakfast, dinner, and wind-down together. On the transition night, set clocks before bed and keep the morning commitment simple.

For the first three mornings, get daylight and light activity soon after waking. Keep caffeine earlier in the day and aim for an extra 30 minutes of sleep opportunity. If you have a safety-sensitive commute, allow extra time and consider an alternative if you are unusually sleepy.

After three to five days, hold the new wake time rather than drifting back on the weekend. If the schedule still feels wrong after a week, check whether bedtime actually moved or whether late light and weekend timing are pulling it back.

Parents and caregivers can shift meals, baths, and bedtime stories in the same small increments. Morning light and the household wake routine often matter more than asking someone to become sleepy an hour earlier on command.

## How to know it is working

You fall asleep and wake closer to the intended clock times, total sleep returns to normal, and morning alertness improves across the week. A single difficult Monday is not a failure. Look for a steady reduction in the mismatch.

Children, adolescents, later chronotypes, and people already short on sleep may take longer. Compare the transition with your own prior time changes rather than expecting everyone in the household to adapt together.

## If you get stuck

The spring change often exposes an existing problem: a schedule that was already too late or too short. Continue a gradual earlier shift and morning light rather than using an all-nighter. If the fall change produces very early waking, avoid moving bedtime too early and keep pre-dawn light low until near the intended rise time.

If clock changes trigger weeks of insomnia or severe mood symptoms, a circadian or mood disorder may need a more specific plan.

## A quick note

Take extra care with driving and hazardous work during the sleepiest days. People with bipolar disorder should seek guidance before using bright-light therapy or changing sleep timing aggressively.

## Sources

- [AASM position statement on daylight saving time](https://aasm.org/advocacy/position-statements/daylight-saving-time-an-american-academy-of-sleep-medicine-position-statement/)
- [AASM position statement supporting permanent standard time](https://aasm.org/advocacy/position-statements/permanent-standard-time-is-the-optimal-choice-for-health-and-safety/)
