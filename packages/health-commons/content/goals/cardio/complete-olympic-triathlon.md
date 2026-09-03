---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:complete-olympic-triathlon
slug: complete-olympic-triathlon
title: Complete an Olympic Triathlon
summary: Prepare for a standard-distance triathlon with balanced swim, bike, and run training plus practiced transitions and pacing.
status: field-testing
quality: usable
aliases:
  - complete a standard-distance triathlon
  - train for an Olympic triathlon
categories:
  - goals
  - cardio
  - triathlon
  - olympic-distance
goal:
  category: cardio
  outcomeKind: event
  goalPhrase: complete an Olympic triathlon
  successSignals:
    - id: balanced_discipline_training
      kind: behavior
      label: Consistent training across swim, bike, and run
    - id: course_specific_endurance
      kind: capacity
      label: Endurance for each discipline and the combined duration
    - id: olympic_triathlon_finish
      kind: milestone
      label: A controlled Olympic-distance triathlon finish
  evidenceSourceKeys:
    - source_artifact:health.gov-physical-activity-guidelines-2018-11-12
    - source_artifact:pmid-18580415
    - source_artifact:acsm-guidelines-exercise-testing-prescription-2025-03-24
  workflow:
    kind: training_plan
    ownerSkillIds:
      - competition-training
      - running-cardio
  startPrompt: Hey Murph, help me complete an Olympic triathlon.
  indexable: true
safety:
  cautionLevel: moderate
---

An Olympic or standard-distance triathlon is commonly a 1.5-kilometer swim, 40-kilometer bike, and 10-kilometer run, though the organizer's published course is what counts. Finishing well takes balanced endurance, open-water competence where the swim calls for it, bike pacing that spares the run, and rehearsed transitions.

Start a specific block once you can train consistently in all three sports and comfortably complete a sprint triathlon or comparable single-discipline distances.

## What to do

- Read the event's exact distances, course, elevation, drafting rules, cutoffs, water conditions, and equipment requirements.
- Swim, bike, and run at least weekly. Give a second session to your weakest or most technical discipline.
- Keep most volume easy and use only one or two focused sessions across the whole week.
- Build one longer bike and one longer run, without large increases in both at once.
- Practice open water with supervision and safe riding around turns, hills, and other athletes.
- Add bike-to-run bricks every one or two weeks.
- Rehearse fueling and transition setup under course-like conditions.

## A simple plan

Use a 12- to 16-week block. A representative week has two swims, two or three rides, two or three runs, and one strength session; one ride-run brick can combine two of those. Keep at least one low-load or rest day.

Build a continuous or repeat-based swim beyond 1.5 kilometers. Extend the long ride toward 50 to 60 kilometers at easy effort and the long run toward 75 to 90 minutes. These are ranges, not mandatory tests; adjust for your pace and history.

Use one controlled quality focus at a time: sustained bike blocks one week, a moderate run workout the next, while swimming keeps its technique and pace work. Do occasional bricks such as a 60- to 90-minute ride followed by a 15- to 30-minute easy run.

Two to three weeks out, rehearse equipment, transitions, and fueling in a shortened simulation. Taper by cutting volume while keeping brief, familiar intensity. Race the swim calmly, bike below standalone time-trial effort, and start the run under control.

## How to know it is working

You can complete the key discipline sessions without one wrecking the next several days. Open-water skills, transition choices, and fueling become routine. Breathing and leg sensation settle faster in bike-to-run bricks.

Readiness is that combined pattern, not a predicted finish time: known rules, course-relevant training done, and a pace that leaves enough for the run.

## If you get stuck

If training all three sports leaves you chronically tired, remove redundant intensity and make short easy sessions truly short. If swimming is far behind, get coaching rather than more unaided volume. If the run keeps suffering, reduce bike intensity before adding run training.

If an injury limits one discipline, keep fitness with the others while following a return plan. Don't cram missed work. Change the finish or time goal when the course, weather, or recent health makes the original plan unrealistic.

Review training by the whole week, not by sport. A hard swim, hard bike, and hard run are three hard sessions even though the sports differ. Reduce combined intensity before dropping the easy technical practice that keeps each discipline familiar.

## A quick note

Open water and road cycling need specific safety skills. Never swim alone, wear a helmet, and stop for chest pain, fainting, severe unusual breathlessness, or symptoms that compromise safe control.

## Sources

- [World Triathlon rules and official documents](https://about.triathlon.org/documents?category=rules)
- [USA Triathlon resources](https://www.usatriathlon.org/)
- [ACSM's Guidelines for Exercise Testing and Prescription, 12th edition](https://acsm.org/education-resources/books/guidelines-exercise-testing-prescription/)
