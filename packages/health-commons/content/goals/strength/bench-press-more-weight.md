---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:bench-press-more-weight
slug: bench-press-more-weight
title: Bench Press More Weight
summary: Bench more by practicing the lift often, building your pressing muscles, and adding weight in small steps.
status: field-testing
quality: usable
aliases:
  - increase my bench press
categories:
  - goals
  - strength
  - lifting
goal:
  category: strength
  parentGoalKey: goal_template:get-stronger
  outcomeKind: capacity
  goalPhrase: bench press more weight
  successSignals:
    - id: bench_press_practice
      kind: behavior
      label: The bench press is practiced consistently
    - id: bench_press_load_progress
      kind: capacity
      label: More load or repetitions at the same standard
    - id: stronger_horizontal_push
      kind: function
      label: Horizontal pushing feels stronger and more controlled
  evidenceSourceKeys:
    - source_artifact:pmid-41843416
  workflow:
    kind: training_plan
    ownerSkillIds:
      - strength-training
  startPrompt: Hey Murph, help me bench press more weight.
  indexable: true
safety:
  cautionLevel: low
---

A stronger bench comes from benching often, building the chest, triceps, and shoulders, and using a setup you can repeat. The lift is easy to test, so people test it too often. Submaximal reps build it; max attempts only show what is already there.

Decide what counts, because touch point, pause, grip, equipment, and range of motion all change the number. For a competition bench, train with the pause and commands some of the time. For general pressing strength, dumbbell or machine presses can join the plan, with the barbell as the anchor.

## What to do

- Bench two or three times a week at varied difficulty.
- Keep feet, grip, upper-back position, touch point, and range the same.
- Use one heavier practice day and one moderate-load volume day.
- Train rows and other pulling alongside the press.
- Add triceps or shoulder work only as recovery allows.
- Use a spotter or properly set safeties for hard sets.

Heavier loads do the most for strength; multiple sets do the most for muscle. Use both: the main lift for skill practice, accessories for muscle and range without another maximal session.

## A simple plan

Day one: three sets of 4 to 6 reps, stopping about two good reps short. Day two: three sets of 8 to 10 with a lighter load or dumbbells. Follow each with a row or pulldown. Add two sets of triceps extensions on one day and a comfortable overhead or incline press on the other.

When every day-one set hits six reps with the same pause and touch point, add the smallest load you can and drop back to four. Progress the lighter day within its range. If plate jumps are too big, use fractional plates or add reps more slowly.

Film a working set from the side occasionally. The bar should descend under control, touch the same spot, and finish stable. Don't rebuild your setup over one ugly rep. Change one thing at a time and judge it over several sessions.

## How to know it is working

Track one repeatable set of three to six reps and one moderate-load set. More weight, more reps, or the same work at lower effort all count. Note whether a set was paused, touch-and-go, spotted, or on different equipment.

Review progress every six to eight weeks instead of maxing weekly. Upper-body lifts move in small steps, and a flat week after poor sleep or hard shoulder work is normal.

## If you get stuck

If the bar stalls off the chest, try more paused practice, chest work, or better control at the bottom. If it stalls near lockout, triceps work is the better bet. If the bar path changes every rep, lower the load and practice the setup.

Check total pressing volume. Bench, incline, overhead press, dips, push-ups, and throwing in sport all draw on the same recovery budget. Elbow or shoulder irritation may ease with a narrower or more neutral grip, dumbbells, a shorter range for a while, or less total work. Pain is not a cue to press more.

## A quick note

Never bench a hard load alone without safeties that can catch the bar. Stop for a sudden chest or shoulder injury, a new deformity, marked weakness, or chest pressure not coming from the working muscle. Persistent joint pain calls for a change in plan and, when significant, an assessment.

## Sources

- [American College of Sports Medicine: 2026 resistance-training position stand](https://pubmed.ncbi.nlm.nih.gov/41843416/)
- [British Journal of Sports Medicine: resistance-training prescription and strength](https://pubmed.ncbi.nlm.nih.gov/37414459/)
- [British Journal of Sports Medicine: protein and resistance-training adaptations](https://pubmed.ncbi.nlm.nih.gov/28698222/)
