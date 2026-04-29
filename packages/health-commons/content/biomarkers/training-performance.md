---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:training-performance
slug: biomarkers/training-performance
title: Training Performance
summary: A repeatable strength, power, or reps-at-load signal for judging whether creatine changes training outputs under stable conditions.
status: draft
quality: usable
categories:
  - exercise
  - performance
  - manual-log
relations:

  -
    type: related_protocol
    target: protocol_variant:creatine-supplementation/creatine-monohydrate
measurementContexts:
  - creatine_self_experiment
  - manual_checkin
unit: score
interpretationFrame:
  principle: Compare the same measure under similar conditions across baseline and intervention windows rather than reacting to one unusually good or bad day.
  caveat: Creatine experiments are easily confounded by training changes, diet changes, hydration shifts, illness, sleep disruption, and other supplements.
biomarker:
  shortName: Training Performance
  displayName: Training Performance
  unit: score
  valuePrecision: 1
  direction:
    desired: higher_or_stable
    label: Higher or more repeatable output is usually better.
    nuance: Use the same lift, load, test, or session structure; new programs and unusually hard training blocks can overwhelm any supplement signal.
  measurement:
    bestContext: Use one or two preselected strength or repeated-power endpoints that can be repeated across the baseline and creatine windows.
    howToMeasure:
      - Pick a specific lift, reps-at-load test, repeated sprint/power output, or total-session output before the experiment starts.
      - Keep warmup, rest periods, equipment, and training plan as similar as practical.
      - Compare multi-session trends rather than one personal record.
    confounders:
      - training_program_change
      - sleep_loss
      - illness
      - calorie_or_protein_change
      - caffeine_change
      - motivation_or_testing_novelty
---

A repeatable strength, power, or reps-at-load signal for judging whether creatine changes training outputs under stable conditions.
