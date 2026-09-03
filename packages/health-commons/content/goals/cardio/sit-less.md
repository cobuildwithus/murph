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

Sitting less doesn't mean standing all day. The useful change is to break up long, uninterrupted sitting and replace some of it with light movement. Two to five minutes of walking, stairs, household activity, or mobility between work blocks is enough to change the pattern.

Regular workouts don't make the rest of the day irrelevant, which is why public-health guidance pairs "move more" with "sit less" and sets no universal maximum for seated hours.

## What to do

- Find the longest seated blocks in a normal day. Meetings, focused work, commuting, gaming, and evening television are common ones.
- Add movement at transitions that already happen: after a meeting, before a refill, when a call starts, or between episodes.
- Start with the block you can change most easily, not an all-day timer.
- Walk during calls that don't need a screen, use a farther bathroom or printer, or stand for the first few minutes of a meeting.
- Keep a small indoor option for bad weather and busy days: one hallway lap, a flight of stairs, or two minutes of easy movement.
- Treat standing as variety, not a substitute for movement. Standing still for hours gets uncomfortable too.

## A simple plan

For one week, notice when you sit for roughly 60 to 90 minutes without moving. Don't track every minute. Choose two recurring blocks and add a two- to five-minute movement break right after each.

In week two, keep those anchors and add one active task, such as a ten-minute walk after lunch, walking part of the commute, or one household chore during an evening break. In weeks three and four, extend the pattern to another long block if it still feels useful.

A workday might look like this: walk three minutes after the first long focus block, eat lunch away from the desk, walk ten minutes afterward, and move briefly after the last afternoon meeting. On a hard day, keep one break.

## How to know it is working

Look for fewer very long seated blocks, more days with brief movement breaks, and less stiffness or sluggishness late in the day. A wearable's stand hours or sedentary minutes can show a pattern, but algorithms vary and often misclassify driving, standing, and small movements.

Weekly trends beat perfect daily totals. You may also notice that a short walk sharpens concentration or makes the next task easier to start.

## If you get stuck

If reminders become background noise, remove most of them and tie movement to one real event. If your job limits breaks, look for small substitutions: stand during a handoff, walk during a permitted break, change position often, or commute actively outside the shift.

If standing hurts your feet or back, alternate positions rather than forcing it. If fatigue makes movement feel impossible, start with one or two minutes and get the fatigue looked into if it persists.

## A quick note

If you have dizziness, balance problems, or limited mobility, use seated movement, supported standing, or clinician-recommended alternatives.

## Sources

- [WHO guidelines on physical activity and sedentary behaviour](https://www.who.int/publications/i/item/9789240015128)
- [Physical Activity Guidelines for Americans, 2nd edition](https://odphp.health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf)
- [WHO physical activity fact sheet](https://www.who.int/news-room/fact-sheets/detail/physical-activity)
