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

Cycling power is the work you put into the pedals. Raising sustainable power takes aerobic endurance, focused work near and above your current sustainable level, and enough recovery to do those sessions well. “FTP” is a useful estimate but not the only valid outcome, and different tests don't give interchangeable numbers.

Pick one device and test format; consistency beats hunting for the perfect protocol.

## What to do

- Build a stable base of two to four rides a week before adding multiple power sessions.
- Do one sustained quality workout a week near your current threshold.
- Add a shorter high-intensity workout only when training history and recovery allow.
- Keep easy and long rides easy enough to protect the quality work.
- Calibrate or zero the power meter per its instructions and compare on the same setup.
- Strength-train legs and trunk, especially when riding volume is low.
- Fuel demanding sessions so low energy isn't mistaken for low fitness.

## A simple plan

Use a six- to eight-week block with three or four rides a week: one easy endurance ride, one longer easy ride, one power session, and an optional easy recovery ride.

Start the power session with three eight-minute efforts at an intensity you can hold evenly, with four easy minutes between. Progress to three ten-minute efforts, then two 15-minute efforts. The last interval should be hard but close to the first, not a collapse.

After two or three stable weeks, experienced riders can alternate in a session of four to five four-minute hard efforts with equal easy recovery, which adds a different stimulus without all-out sprints. Keep at least 48 hours between demanding sessions.

Every third or fourth week, cut interval volume. Retest after six to eight weeks with the same 20-minute, ramp, or longer steady protocol, ideally with similar fatigue, cooling, nutrition, and equipment.

## How to know it is working

Power across the intervals gets higher or steadier at the same effort, and you recover faster between them. You may hold more watts for 20, 30, or 60 minutes, climb faster in similar conditions, or lose less power late in long rides.

Watts per kilogram can matter on climbs, but a power gain doesn't need weight loss to count. Don't retest so often that normal variation drives the plan.

## If you get stuck

If the first interval is strong and the rest collapse, lower the target. If power falls over several weeks, check fatigue, sleep, illness, cooling, fueling, and calibration before calling it a plateau. If short power rises but long power doesn't, add sustained aerobic and threshold work rather than more sprints.

Don't treat trainer power, crank power, and another bike's pedals as one data stream; train from the device you'll use and compare within it.

No universal FTP number defines good fitness; judge yours against your own event, terrain, duration, and training history.

## A quick note

Hard power testing is vigorous exercise. Stop for chest pain, fainting, severe unusual breathlessness, or new palpitations with symptoms, and don't do maximal tests while you're ill.

## Sources

- [Gormley et al.: cycling-based aerobic-training intensity](https://pubmed.ncbi.nlm.nih.gov/18580415/)
- [Helgerud et al.: aerobic intervals and VO2 max](https://pubmed.ncbi.nlm.nih.gov/17414804/)
- [USA Cycling coaching education resources](https://usacycling.org/coaches-old/coaching-courses)
