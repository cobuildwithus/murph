---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:sit-less
slug: sit-less
title: Sit Less During the Day
summary: Break up long sitting periods and replace some of them with movement that fits naturally into work and home life.
status: field-testing
quality: usable
aliases:
  - reduce sedentary time
  - move more at work
categories:
  - goals
  - cardio
  - daily-activity
goal:
  category: cardio
  outcomeKind: behavior
  goalPhrase: sit less during the day
  successSignals:
    - id: fewer_long_sitting_blocks
      kind: behavior
      label: Fewer long uninterrupted sitting blocks
    - id: active_breaks
      kind: behavior
      label: More brief movement breaks
    - id: less_sitting_stiffness
      kind: symptom
      label: Less stiffness after work or travel
  evidenceSourceKeys:
    - source_artifact:who-physical-activity-guidelines-2020-11-25
    - source_artifact:health.gov-physical-activity-guidelines-2018-11-12
    - source_artifact:pmid-35247352
  workflow:
    kind: habit_plan
    ownerSkillIds:
      - daily-activity
      - behavior-followthrough
  startPrompt: Hey Murph, help me sit less during the day.
  indexable: true
safety:
  cautionLevel: low
---

Sitting less does not require standing all day. The useful change is to reduce long, uninterrupted sitting and replace some of it with light movement. Two to five minutes of walking, stairs, household activity, or mobility between work blocks is enough to change the pattern.

Regular workouts remain valuable, but they do not make the rest of the day irrelevant. Public-health guidance therefore pairs “move more” with “sit less” and does not impose one universal maximum number of seated hours.

## What to do

- Identify the longest seated blocks in a normal day. Meetings, focused work, commuting, gaming, and evening television are common targets.
- Add movement at transitions that already happen: after a meeting, before a refill, when a call starts, or between episodes.
- Start with the block you can change most easily instead of setting an all-day timer.
- Walk for calls that do not require a screen, use a farther bathroom or printer, or stand for the first few minutes of a meeting.
- Keep a small indoor option for weather and busy days: one hallway lap, a flight of stairs, or two minutes of easy movement.
- Use standing as variety, not as a replacement for movement. Standing still for hours can also become uncomfortable.

## A simple plan

For one week, notice when you sit for roughly 60 to 90 minutes without moving. Do not try to track every minute. Choose two recurring blocks and add a two- to five-minute movement break immediately afterward.

In week two, keep those anchors and add one active task, such as a ten-minute walk after lunch, walking part of the commute, or doing one household task during an evening break. In weeks three and four, extend the pattern to another long block if it still feels useful.

A practical workday might look like this: walk for three minutes after the first long focus block, take lunch away from the desk, walk for ten minutes afterward, and move briefly after the final afternoon meeting. On a difficult day, keep one break. The plan succeeds by making prolonged sitting less automatic, not by eliminating chairs.

## How to know it is working

Look for fewer very long seated blocks, more days with brief movement breaks, and less stiffness or sluggishness late in the day. A wearable's stand hours or sedentary minutes can reveal a pattern, but algorithms vary and often misclassify driving, standing, and small movements.

Weekly trends are more useful than perfect daily totals. You may also notice that a short walk improves concentration or makes it easier to begin the next task. That immediate benefit can be a stronger habit cue than a distant health outcome.

## If you get stuck

If reminders become background noise, remove most of them and attach movement to one real event. If your job limits breaks, look for small substitutions: stand during a handoff, walk during a permitted break, change position frequently, or use active commuting outside the shift.

If standing causes foot or back discomfort, alternate positions rather than forcing it. If fatigue makes movement feel impossible, begin with one or two minutes and investigate the fatigue separately if it persists. A formal workout can coexist with the plan, but do not use it as a reason to remain motionless for every other hour.

## A quick note

People with dizziness, balance problems, or mobility limitations can use seated movement, supported standing, or clinician-recommended alternatives. The goal is more appropriate movement, not one prescribed posture.

## Sources

- [WHO guidelines on physical activity and sedentary behaviour](https://www.who.int/publications/i/item/9789240015128)
- [Physical Activity Guidelines for Americans, 2nd edition](https://odphp.health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf)
- [WHO physical activity fact sheet](https://www.who.int/news-room/fact-sheets/detail/physical-activity)
