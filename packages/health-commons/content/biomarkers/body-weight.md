---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:body-weight
slug: biomarkers/body-weight
title: Body Weight
summary: A same-condition scale-weight trend used to interpret creatine-related water, diet, and body-composition context without treating scale change as fat gain by default.
status: draft
quality: usable
categories:
  - body-composition
  - manual-log
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
  shortName: Body Weight
  displayName: Body Weight
  unit: kg
  valuePrecision: 1
  direction:
    desired: mixed_or_contextual
    label: Context matters more than one direction.
    nuance: Early increases can reflect water or fat-free-mass changes; diet, sodium, menstrual cycle, glycogen, and hydration can all move the scale.
  measurement:
    bestContext: Use the same scale, similar time of day, and similar clothing across baseline and intervention windows.
    howToMeasure:
      - Weigh at a consistent time, ideally after waking and bathroom use.
      - Compare weekly averages rather than single readings.
      - Log major diet, sodium, alcohol, travel, illness, and training-volume changes.
    confounders:
      - hydration_shift
      - diet_change
      - sodium_change
      - glycogen_change
      - menstrual_cycle
      - travel
      - new_training_volume
---

A same-condition scale-weight trend used to interpret creatine-related water, diet, and body-composition context without treating scale change as fat gain by default.
