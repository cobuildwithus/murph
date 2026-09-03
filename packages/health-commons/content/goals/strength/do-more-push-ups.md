---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:do-more-push-ups
slug: do-more-push-ups
title: Do More Push-Ups
summary: Increase push-up repetitions with repeatable technique, submaximal practice, and stronger pressing muscles.
status: field-testing
quality: usable
aliases:
  - increase my push-ups
categories:
  - goals
  - strength
  - bodyweight-skills
goal:
  category: strength
  parentGoalKey: goal_template:do-first-push-up
  outcomeKind: capacity
  goalPhrase: do more push-ups
  successSignals:
    - id: weekly_push_up_volume
      kind: behavior
      label: Quality push-up practice accumulates each week
    - id: submaximal_set_progress
      kind: capacity
      label: More repetitions across repeatable training sets
    - id: max_push_up_progress
      kind: milestone
      label: A standardized maximum set improves
  evidenceSourceKeys:
    - source_artifact:pmid-41843416
  workflow:
    kind: training_plan
    ownerSkillIds:
      - strength-training
  startPrompt: Hey Murph, help me do more push-ups.
  indexable: true
safety:
  cautionLevel: low
---

Doing more push-ups is an endurance goal built on a strength base. Testing a max set every day builds fatigue and leaves little room for practice, so most training should stop well before failure and fit more good reps into the week.

Define a rep: hand position, body line, depth, and a lockout you can repeat. If a test has a specific standard, practice that standard. Shortening the range or resting at the top may raise the number without building the capacity you wanted.

## What to do

- Practice two to four times a week, depending on volume and recovery.
- Keep most sets at about 40 to 70 percent of your max.
- Stop with several good reps left so technique stays consistent.
- Build weekly reps gradually rather than doubling them after one good day.
- Add harder pressing work (weighted push-ups, bench press, a lower incline) to raise the strength ceiling.
- Train rows or pulldowns, and give wrists, elbows, and shoulders time to recover.

If your max is low, build strength first with smaller sets and a scalable incline. If it's already high, specific endurance practice matters more.

## A simple plan

Warm up, test one standardized max set, then wait at least two days. Use about half that number for training sets: 8 to 10 for a max of 20. Three days a week, do five sets with 60 to 90 seconds of rest. End a set early if body line or depth changes.

Each session, add one rep to one or two sets until all five reach the top of the planned range. Then bump each set slightly, or add two lower-rep sets of a harder variation before the endurance work. Keep weekly increases small enough that elbows and shoulders stay quiet.

Retest after three or four weeks, not every workout, after an easier day or two. Reset training sets from the new max. For a timed test, add one weekly session that rehearses the time rule once a base of normal sets exists.

## How to know it is working

Track total clean reps across the same number of sets, and how hard the last set felt. When 50 reps across five sets gets easier, capacity is improving even before the max test moves.

On test day, use the same surface, hand position, range, tempo rule, and rest beforehand. Video can confirm the standard.

## If you get stuck

If every set is near failure, cut the reps and spread the work over more sets. If the first few reps feel disproportionately hard, build max pressing strength with a harder variation. If triceps fail first, add a little direct work; if the trunk sags, add brief trunk-control practice.

Hidden pressing volume from bench press, dips, overhead press, and sport also adds fatigue. Reduce the overlap before adding another push-up day. If wrists are irritated, switch to handles, dumbbells, or a different hand angle without changing the movement goal.

## A quick note

Stop for sudden shoulder, elbow, or wrist pain, a new deformity, or marked weakness. Ordinary muscle fatigue should settle quickly. High-rep challenges are optional. A lower number of controlled reps can still reflect excellent useful strength.

## Sources

- [American College of Sports Medicine: 2026 resistance-training position stand](https://pubmed.ncbi.nlm.nih.gov/41843416/)
- [British Journal of Sports Medicine: resistance-training prescription and strength](https://pubmed.ncbi.nlm.nih.gov/37414459/)
- [World Health Organization: physical activity guidance](https://www.who.int/publications/i/item/9789240015128)
