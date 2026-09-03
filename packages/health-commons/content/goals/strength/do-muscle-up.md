---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:do-muscle-up
slug: do-muscle-up
title: Do a Muscle-Up
summary: Combine strong pulling, a practiced transition, and stable dipping into one controlled muscle-up.
status: field-testing
quality: usable
aliases:
  - get my first muscle-up
categories:
  - goals
  - strength
  - bodyweight-skills
goal:
  category: strength
  parentGoalKey: goal_template:do-first-pull-up
  outcomeKind: skill
  goalPhrase: do a muscle-up
  successSignals:
    - id: muscle_up_skill_practice
      kind: behavior
      label: Pull, transition, and support practice happen consistently
    - id: prerequisite_strength
      kind: capacity
      label: High pulls and dips become strong and repeatable
    - id: first_muscle_up
      kind: milestone
      label: One bar or ring muscle-up is completed to stable support
  evidenceSourceKeys:
    - source_artifact:pmid-41843416
  workflow:
    kind: training_plan
    ownerSkillIds:
      - strength-training
  startPrompt: Hey Murph, help me do a muscle-up.
  indexable: true
safety:
  cautionLevel: moderate
---

A muscle-up chains a high pull, a transition over the bar or rings, and a stable dip to support. Build each piece separately, then connect them with enough assistance to keep the movement clean.

Choose bar or rings. Rings need a false grip and control of two independent rings; the bar uses a different path and often more swing, and progress on one doesn't transfer perfectly. This guide defaults to the bar, but the order holds for both: strength first, transition second, full attempts sparingly.

## What to do

- Build several controlled pull-ups and dips (parallel-bar or straight-bar) before full attempts.
- Train high pulls toward the lower chest, not just chin-over-bar reps.
- Practice the transition with a low bar and feet down, a band, or an assisted machine.
- Use controlled swings only if the skill allows them, and never let attempts become uncontrolled kicks.
- Train two or three focused sessions a week and stop before technique breaks down.
- Keep pulling, pressing, grip, and trunk training in the program.

There's no universal prerequisite number, but several clean pull-ups and dips make the skill safer and easier to practice. With one max pull-up, build that base before chasing transitions.

## A simple plan

Day one: four sets of 3 to 5 high pull-ups (assisted if needed), three sets of 3 to 6 straight-bar dips, and five minutes of low-bar transition practice. Day two: weighted or challenging pull-ups, parallel-bar dips, rows, and trunk work. Day three: assisted full muscle-ups for several low-rep sets.

Keep each full-skill set to one to three reps. Reduce band or foot assistance only when the pull stays high and both elbows clear the bar together, without a big uneven “chicken wing.” Take a few rested unassisted attempts every week or two, not dozens per workout.

On rings, learn a comfortable false grip, a deep ring pull, a low-ring transition with feet supported, and a stable ring dip. Set the rings low enough that a missed transition puts your feet back on the floor.

## How to know it is working

Track pull height, transition assistance, dip strength, and the quality of assisted full reps. A higher pull or smoother two-arm transition counts as progress before the first full rep.

Film occasional attempts from the side to check that you reach the right height before the transition and that both arms move together, then use the footage to choose the next drill.

## If you get stuck

If your chest never reaches the bar, work on pulling strength and speed. If you pull high enough but can't get over, spend more time on low-bar transitions and straight-bar dips. If one elbow always leads, add assistance until both go together.

If elbows or shoulders get irritated, cut explosive and transition volume; muscle-ups load end-range positions hard, and fatigue changes timing. More attempts won't fix a limit set by prerequisite strength or tissue tolerance.

## A quick note

Use a secure bar or correctly set rings, clear space, a safe way down, and no hard obstacles below. Stop after a sudden shoulder, elbow, or wrist injury, or after a fall. Get coaching if you can't see why the transition keeps failing.

## Sources

- [American College of Sports Medicine: 2026 resistance-training position stand](https://pubmed.ncbi.nlm.nih.gov/41843416/)
- [Skill-acquisition interventions in sports: scoping review](https://pubmed.ncbi.nlm.nih.gov/38401870/)
- [British Journal of Sports Medicine: resistance-training prescription and strength](https://pubmed.ncbi.nlm.nih.gov/37414459/)
