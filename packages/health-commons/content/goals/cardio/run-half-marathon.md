---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:run-half-marathon
slug: run-half-marathon
title: Run a Half Marathon
summary: Prepare for 13.1 miles with a durable weekly base, a gradually longer run, practiced fueling, and realistic pacing.
status: field-testing
quality: usable
aliases:
  - complete a half marathon
  - train for a half marathon
categories:
  - goals
  - cardio
  - running
  - half-marathon
goal:
  category: cardio
  outcomeKind: event
  goalPhrase: run a half marathon
  successSignals:
    - id: stable_running_week
      kind: behavior
      label: A stable three- to five-day running week
    - id: long_run_duration
      kind: capacity
      label: Long runs that approach event demands without excessive recovery cost
    - id: half_marathon_finish
      kind: milestone
      label: A controlled 13.1-mile finish
  evidenceSourceKeys:
    - source_artifact:health.gov-physical-activity-guidelines-2018-11-12
    - source_artifact:pmid-18580415
    - source_artifact:acsm-guidelines-exercise-testing-prescription-2025-03-24
  workflow:
    kind: training_plan
    ownerSkillIds:
      - competition-training
      - running-cardio
  startPrompt: Hey Murph, help me run a half marathon.
  indexable: true
safety:
  cautionLevel: moderate
---

A half marathon rewards consistency more than dramatic workouts. Build a stable running week, lengthen one easy run gradually, practice the pace and fueling you expect to use, and reduce training before the event. If your aim is simply to finish, run-walk pacing is a valid and often effective strategy.

Before a dedicated block, it helps to run comfortably three times per week and complete roughly five to six miles or 60 minutes without a large recovery cost. Starting below that is possible, but it calls for more time.

## What to do

- Choose an event far enough away for gradual progression—often 10 to 16 weeks from a stable base.
- Run three to five days per week according to your history, with most running easy.
- Progress one long run while keeping shorter days consistent.
- Add one controlled workout at half-marathon effort or a little faster after the base is stable.
- Practice drinking and carbohydrate intake during longer sessions if your expected duration makes them useful.
- Use the shoes, socks, clothing, and breakfast you expect on race day.
- Reduce volume in the final one to two weeks while keeping a little normal rhythm.

## A simple plan

A basic four-day week includes two easy runs of 30 to 50 minutes, one quality session, and one long run. Begin the long run from your comfortable baseline and add roughly five to ten minutes after successful weeks. Every third or fourth week, hold or shorten it.

For quality, alternate a sustained workout such as three ten-minute blocks at a comfortably hard effort with a lighter session of six two-minute brisk repetitions. Completion-focused runners can replace this with easy hills or omit it when long-run recovery is demanding.

Build the long run toward 90 to 120 minutes or roughly ten to twelve miles, depending on pace, experience, and injury history. You do not need to complete 13.1 miles before race day. Use selected long runs to practice water and carbohydrates, changing only one item at a time.

During race week, reduce the load, sleep normally, and avoid trying to gain fitness. Start slower than goal average for the first few miles, settle, and reassess after halfway.

## How to know it is working

The most important sign is that long runs become normal parts of the week rather than events that disrupt several days. You should recover, eat, sleep, and move normally afterward. Goal-pace segments may become smoother, and heart rate or effort may stay more stable late in a run.

Preparedness is not one magic mileage number. It is a pattern: consistent weeks, several successful long runs, practiced fueling, and no unresolved injury. Event completion and how you recover afterward are stronger outcomes than a watch prediction.

## If you get stuck

If long runs dominate recovery, reduce their increase, add walk breaks, or shorten another session. If pacing work is too hard, use current fitness rather than aspirational race pace. If fueling causes stomach trouble, practice smaller amounts, different products, or more time between intake rather than experimenting on race morning.

When training is interrupted, do not make up missed miles. Resume from a recent successful week and adjust the event goal if needed.

## A quick note

Stop for chest pain, fainting, severe unusual breathlessness, or pain that changes your stride. Persistent fatigue, recurrent injury, or menstrual disruption can indicate inadequate recovery or energy availability.

## Sources

- [Physical Activity Guidelines for Americans, 2nd edition](https://odphp.health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf)
- [World Athletics health and science resources](https://worldathletics.org/about-iaaf/documents/health-science)
- [2023 IOC consensus statement on Relative Energy Deficiency in Sport](https://bjsm.bmj.com/content/57/17/1073)
