---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:lean-body-mass
slug: biomarkers/lean-body-mass
title: Lean Body Mass
summary: A body-composition proxy that can be relevant for creatine but is water-sensitive and should be interpreted with training and weight context.
status: draft
quality: usable
categories:
  - body-composition
  - fitness
relations:

  -
    type: related_protocol
    target: protocol_variant:creatine-supplementation/creatine-monohydrate
measurementContexts:
  - creatine_self_experiment
  - manual_checkin
unit: kg
interpretationFrame:
  principle: Compare the same measure under similar conditions across baseline and intervention windows rather than reacting to one unusually good or bad day.
  caveat: Creatine experiments are easily confounded by training changes, diet changes, hydration shifts, illness, sleep disruption, and other supplements.
biomarker:
  shortName: Lean Body Mass
  displayName: Lean Body Mass
  unit: kg
  valuePrecision: 1
  direction:
    desired: mixed_or_contextual
    label: Higher may be favorable only in context.
    nuance: Consumer body-composition estimates can move with hydration and glycogen; do not treat short-term lean-mass changes as pure muscle gain.
  measurement:
    bestContext: Use the same device and conditions, and interpret trends alongside strength, volume, weight, diet, and visual or waist context.
    howToMeasure:
      - Keep the same device, time of day, hydration state, and pre-measurement routine.
      - Compare averages over weeks rather than one scan.
      - Pair the trend with body weight, training outputs, and diet notes.
    confounders:
      - hydration_shift
      - glycogen_change
      - device_algorithm_change
      - diet_change
      - training_program_change
      - measurement_time_change
---

A body-composition proxy that can be relevant for creatine but is water-sensitive and should be interpreted with training and weight context.
