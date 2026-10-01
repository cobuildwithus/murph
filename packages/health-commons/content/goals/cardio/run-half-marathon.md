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

A half marathon rewards consistency over dramatic workouts. Build a stable week, lengthen one easy run gradually, practice your planned pace and fueling, and cut back before the event. If finishing is the aim, run-walk pacing is sound and often effective.

Before a dedicated block, it helps to run comfortably three times a week and cover roughly five to six miles or 60 minutes without much recovery cost.

## What to do

- Pick an event far enough out to progress gradually, often 10 to 16 weeks from a stable base.
- Run three to five days a week depending on your history, mostly easy.
- Progress one long run; keep shorter days consistent.
- Once the base is stable, add one controlled workout at half-marathon effort or slightly faster.
- Practice drinking and carbohydrate intake on longer sessions if your expected duration warrants it.
- Train in your race-day shoes, socks, clothing, and breakfast.
- Cut volume in the final one to two weeks but keep a little normal rhythm.

## A simple plan

A basic four-day week: two easy runs of 30 to 50 minutes, one quality session, and one long run. Start the long run from your comfortable baseline and add roughly five to ten minutes after good weeks. Every third or fourth week, hold or shorten it.

For quality, alternate a sustained workout, such as three ten-minute blocks at a comfortably hard effort, with a lighter session of six two-minute brisk repetitions. Finishers can swap in easy hills or skip it when long-run recovery is demanding.

Build the long run toward 90 to 120 minutes, or roughly ten to twelve miles, depending on pace, experience, and injury history. You don't need 13.1 miles before race day. Practice water and carbohydrates on a few long runs, one change at a time.

In race week, cut the load, sleep normally, and don't chase fitness. Run the first few miles slower than goal average, settle, and reassess after halfway.

## How to know it is working

The best sign is long runs becoming a normal part of the week rather than events that disrupt several days of eating, sleeping, and moving. Goal-pace segments may smooth out, and heart rate or effort may hold steadier late in a run.

Readiness isn't one magic mileage number but a pattern: consistent weeks, several good long runs, practiced fueling, and no unresolved injury.

## If you get stuck

If long runs dominate recovery, shrink the increases, add walk breaks, or shorten another session. If pace work is too hard, train at current fitness, not aspirational race pace. If fueling upsets your stomach, practice smaller amounts, different products, or longer gaps between intakes in training rather than on race morning.

If training is interrupted, don't make up missed miles. Resume from a recent good week and adjust the goal if needed.

## A quick note

Stop for chest pain, fainting, severe unusual breathlessness, or pain that changes your stride. Persistent fatigue, recurring injury, or menstrual disruption can signal inadequate recovery or energy availability.

## Sources

- [Physical Activity Guidelines for Americans, 2nd edition](https://odphp.health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf)
- [World Athletics health and science resources](https://worldathletics.org/about-iaaf/documents/health-science)
- [2023 IOC consensus statement on Relative Energy Deficiency in Sport](https://bjsm.bmj.com/content/57/17/1073)
