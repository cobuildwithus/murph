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

The spring clock change asks you to wake an hour earlier overnight; the fall change moves the clock later. Most people adapt, but sleep loss and a misaligned body clock can make the first several days rough. A gradual shift, enough sleep, and well-timed light take most of the sting out.

## What to do

- For the spring change, move bedtime and wake time 15 to 20 minutes earlier for three or four days before the clock moves.
- For the fall change, move later in the same small steps if early waking is a recurring problem; many people need less preparation here.
- Shift meals, exercise, and the household routine with sleep. The body clock reads the whole pattern of cues.
- Get outdoor light after the new wake time. In spring, avoid very bright late-evening light, which pushes your rhythm later.
- Protect the weekend from avoidable sleep loss. Move a late party, early drive, or overnight shift off the clock-change night if you can.
- A short early-afternoon nap is fine; skip long or late naps that push the new bedtime back.

## A simple plan

Starting Wednesday or Thursday before the change, shift the household schedule by 15 minutes a day: alarm, first light, breakfast, dinner, and wind-down together. On the transition night, set the clocks before bed and keep the morning simple.

For the first three mornings, get daylight and light activity soon after waking. Keep caffeine earlier and allow an extra 30 minutes of sleep opportunity. If your commute is safety-sensitive, leave extra time, and find another way in if you are unusually sleepy.

After three to five days, hold the new wake time instead of drifting back on the weekend. If it still feels wrong after a week, check whether bedtime actually moved or late light and weekend timing are pulling it back.

Parents and caregivers can shift meals, baths, and bedtime stories in the same steps. Morning light and the wake routine do more than asking someone to feel sleepy an hour early on command.

## How to know it is working

You fall asleep and wake closer to the intended times, total sleep returns to normal, and mornings sharpen over the week. One rough Monday is not a failure; look for a steady drop in the mismatch.

Children, adolescents, later chronotypes, and people already short on sleep may take longer. Compare with your own past transitions rather than expecting the whole household to adapt at once.

## If you get stuck

The spring change often exposes a schedule that was already too late or too short. Keep shifting earlier in small steps with morning light rather than pulling an all-nighter. If the fall change leaves you waking very early, don't move bedtime too early, and keep pre-dawn light low until near the intended rise time.

If clock changes set off weeks of insomnia or severe mood symptoms, a circadian or mood disorder may need a more specific plan.

## A quick note

Take extra care with driving and hazardous work on the sleepiest days. If you have bipolar disorder, get guidance before using bright-light therapy or aggressively changing sleep timing.

## Sources

- [AASM position statement on daylight saving time](https://aasm.org/advocacy/position-statements/daylight-saving-time-an-american-academy-of-sleep-medicine-position-statement/)
- [AASM position statement supporting permanent standard time](https://aasm.org/advocacy/position-statements/permanent-standard-time-is-the-optimal-choice-for-health-and-safety/)
