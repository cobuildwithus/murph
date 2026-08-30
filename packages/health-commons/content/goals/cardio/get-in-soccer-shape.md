---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:get-in-soccer-shape
slug: get-in-soccer-shape
title: Get in Soccer Shape
summary: Build the aerobic endurance, repeated-sprint ability, movement durability, and ball-specific fitness needed across a match.
status: field-testing
quality: usable
aliases:
  - improve soccer fitness
  - get fit for football
  - build match fitness
categories:
  - goals
  - cardio
  - soccer
  - sport-conditioning
goal:
  category: cardio
  outcomeKind: capacity
  goalPhrase: get in soccer shape
  successSignals:
    - id: match_duration_capacity
      kind: capacity
      label: More useful movement across the intended match duration
    - id: repeated_sprint_quality
      kind: capacity
      label: Less drop-off across repeated high-speed efforts
    - id: training_and_match_consistency
      kind: behavior
      label: Consistent aerobic, strength, and soccer-specific preparation
  evidenceSourceKeys:
    - source_artifact:health.gov-physical-activity-guidelines-2018-11-12
    - source_artifact:pmid-17414804
    - source_artifact:acsm-guidelines-exercise-testing-prescription-2025-03-24
  workflow:
    kind: training_plan
    ownerSkillIds:
      - running-cardio
      - strength-training
  startPrompt: Hey Murph, help me get in soccer shape.
  indexable: true
safety:
  cautionLevel: moderate
---

Soccer fitness combines a large aerobic base with repeated accelerations, high-speed runs, stops, cuts, and technical actions. The goal is not to win a continuous-distance test; it is to keep making useful runs and sound decisions late in a match. Build easy running capacity first, then add soccer-specific intervals, speed exposure, strength, and ball work.

The exact demand depends on position, match length, level, substitution rules, and current training history.

## What to do

- Accumulate two or three aerobic sessions or practices each week.
- Add high-speed running gradually; sprint exposure should not first appear in a match.
- Strengthen calves, hamstrings, quads, hips, groin, and trunk twice weekly.
- Use a structured neuromuscular warm-up before practices and matches.
- Build repeated-effort conditioning with adequate recovery and good running mechanics.
- Use small-sided games and ball drills so conditioning transfers to decisions and skill.
- Treat matches and hard practices as high-load sessions when planning the week.

## A simple plan

Use six to ten weeks. In the first two weeks, complete two easy aerobic sessions of 25 to 45 minutes, two strength sessions, and one or two technical practices. Add four to six relaxed accelerations with full walking recovery.

In weeks three and four, add one interval session: two sets of six one-minute strong runs with one minute easy, resting three minutes between sets. This should be repeatable, not all-out. Continue several short accelerations on a separate day.

In later weeks, make one conditioning session more soccer-specific: 15- to 30-second runs, shuttles, and changes of direction with enough recovery to keep speed and form. Small-sided games can replace part of this work. Progress the total number of high-speed efforts gradually.

As match play begins, reduce separate conditioning. Keep one easy aerobic session, one brief speed exposure, strength, and the structured warm-up around practices and games.

## How to know it is working

You cover the intended practice or match duration with less late-game fade, recover faster after sprints, and maintain ball control and decision quality. Repeated runs become more even rather than beginning fast and collapsing.

A fixed shuttle or interval set can show progress every three to six weeks, but match function is the main outcome. GPS distance or high-speed totals are useful only when collected consistently and interpreted by position and session.

## If you get stuck

If breathing is the limiter, keep the easy aerobic work. If hamstrings, calves, or groin become tight or painful as speed rises, reduce high-speed volume and strengthen those tissues instead of adding conditioning. If you are fit in straight lines but struggle in games, add ball-based and change-of-direction practice.

If fatigue accumulates, count the true load of matches and practices. Extra running is not automatically the solution. Recovery and consistent participation create more fitness than repeated boom-and-bust weeks.

During a competitive season, the match schedule should organize the week. Put the hardest additional conditioning far enough from matches to recover, and reduce it when minutes rise. During an off-season, rebuild easy volume and strength before increasing sprint and cutting exposure.

## A quick note

Warm up before sprinting and cutting, and do not train through pain that changes stride or kicking. Stop for chest pain, fainting, or severe unusual breathlessness.

## Sources

- [FIFA: Injury prevention and health promotion](https://inside.fifa.com/health-and-medical/injury-prevention)
- [Soligard et al.: cluster randomized trial of a comprehensive soccer warm-up](https://www.bmj.com/content/337/bmj.a2469)
- [2025 IOC consensus recommendations on athlete injury prevention](https://bjsm.bmj.com/content/59/22/1546)
