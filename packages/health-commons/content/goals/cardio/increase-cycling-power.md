---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:increase-cycling-power
slug: increase-cycling-power
title: Increase My Cycling Power
summary: Build the power you can sustain on the bike through specific intervals, aerobic support, strength, and consistent testing conditions.
status: field-testing
quality: usable
aliases:
  - increase FTP
  - improve bike power
  - raise cycling threshold
categories:
  - goals
  - cardio
  - cycling
  - power
goal:
  category: cardio
  outcomeKind: capacity
  goalPhrase: increase my cycling power
  successSignals:
    - id: sustained_power
      kind: capacity
      label: Higher power for a repeatable sustained duration
    - id: quality_interval_completion
      kind: capacity
      label: More consistent power across focused intervals
    - id: recoverable_training_week
      kind: behavior
      label: Focused power work inside a recoverable riding week
  evidenceSourceKeys:
    - source_artifact:pmid-18580415
    - source_artifact:pmid-17414804
    - source_artifact:pmid-17991697
  workflow:
    kind: training_plan
    ownerSkillIds:
      - running-cardio
      - aerobic-fitness
      - strength-training
  startPrompt: Hey Murph, help me increase my cycling power.
  indexable: true
safety:
  cautionLevel: moderate
---

Cycling power is the work you put into the pedals. Increasing the power you can sustain requires a mix of aerobic endurance, focused work near and above your current sustainable level, and enough recovery to complete those sessions well. “FTP” can be a useful estimate, but it is not the only valid outcome and different tests do not produce interchangeable numbers.

Pick one device and test format. Consistency matters more than finding the supposedly perfect protocol.

## What to do

- Build a stable base of two to four weekly rides before adding multiple power sessions.
- Use one sustained quality workout each week near your current threshold region.
- Add a shorter high-intensity workout only when training history and recovery support it.
- Keep easy and long rides easy enough to protect the quality work.
- Calibrate or zero the power meter according to its instructions and use the same setup for comparisons.
- Strength-train legs and trunk, especially when cycling volume is lower.
- Fuel demanding sessions so low energy is not mistaken for low fitness.

## A simple plan

Use a six- to eight-week block. Ride three or four times per week: one easy endurance ride, one longer easy ride, one power-focused session, and an optional easy recovery ride.

Begin the power session with three eight-minute efforts at an intensity you can hold evenly, separated by four easy minutes. Progress to three ten-minute efforts, then two 15-minute efforts. The final interval should be difficult but similar to the first—not a collapse.

After two or three stable weeks, experienced riders may alternate in a session of four to five four-minute hard efforts with equal easy recovery. This creates a different stimulus without requiring all-out sprints. Keep at least 48 hours between demanding sessions.

Every third or fourth week, reduce interval volume. Re-test using the same 20-minute, ramp, or longer steady protocol after six to eight weeks, ideally under similar fatigue, cooling, nutrition, and equipment conditions.

## How to know it is working

Power across the intervals becomes higher or more stable at the same effort, and recovery between them improves. You may sustain more watts for 20, 30, or 60 minutes, climb faster at similar conditions, or experience less power drop late in long rides.

Use both absolute watts and context. Watts per kilogram can matter on climbs, but body-weight change is not required for a valuable power gain. Avoid retesting so frequently that normal variation dictates the plan.

## If you get stuck

If the first interval is strong and the rest collapse, lower the target. If power falls across several weeks, examine fatigue, sleep, illness, cooling, fueling, and calibration before declaring a plateau. If short power rises but long power does not, increase sustained aerobic and threshold work rather than adding more sprints.

Equipment disagreement is common. Do not compare trainer power, crank power, and another bike's pedals as though they were one measurement stream. Train from the device you will use and compare within that system.

There is no universal FTP number that defines good fitness. Judge power against your own event, terrain, duration, and training history.

## A quick note

Hard power testing is vigorous exercise. Stop for chest pain, fainting, severe unusual breathlessness, or new palpitations with symptoms, and do not conduct maximal tests while ill.

## Sources

- [Gormley et al.: cycling-based aerobic-training intensity](https://pubmed.ncbi.nlm.nih.gov/18580415/)
- [Helgerud et al.: aerobic intervals and VO2 max](https://pubmed.ncbi.nlm.nih.gov/17414804/)
- [USA Cycling coaching education resources](https://usacycling.org/coaches-old/coaching-courses)
