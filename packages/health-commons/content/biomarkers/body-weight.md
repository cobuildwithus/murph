---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:body-weight
slug: biomarkers/body-weight
title: Body Weight
summary: A same-condition scale-weight trend used as contextual support for nutrition and supplement experiments without treating one direction as universally good.
status: draft
quality: usable
aliases:
  - morning weight
  - scale weight
  - body mass
categories:
  - body-composition
  - manual-log
  - nutrition
relations:

  -
    type: related_protocol
    target: protocol_variant:creatine-supplementation/creatine-monohydrate
  -
    type: related_protocol
    target: protocol_variant:added-sugar-reduction/no-added-sugar-diet
  -
    type: related_protocol
    target: protocol_variant:prolonged-fasting/prolonged-fasting-24-72-hours
measurementContexts:
  - creatine_self_experiment
  - added_sugar_reduction
  - prolonged_fasting_context
  - dietary_behavior_tracking
  - manual_checkin
unit: kg
interpretationFrame:
  principle: Compare the same measure under similar conditions across baseline and intervention windows rather than reacting to one unusually good or bad day.
  caveat: Body weight is easily confounded by hydration, sodium, glycogen, menstrual cycle, travel, illness, training changes, diet changes, sleep disruption, and other supplements.
biomarker:
  shortName: Body Weight
  displayName: Body Weight
  unit: kg
  valuePrecision: 1
  direction:
    desired: mixed_or_contextual
    label: Context matters more than one direction.
    nuance: Lower, stable, or intentionally higher values can all be appropriate depending on baseline status, goals, hydration, glycogen, muscle mass, and nutrition adequacy.
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
      - recent_meal_or_refeed_timing
      - menstrual_cycle
      - travel
      - new_training_volume
---

A same-condition scale-weight trend used as contextual support for nutrition and supplement experiments without treating one direction as universally good.

## Measurement note

Use the same scale, similar time of day, and similar clothing across baseline and intervention windows. Compare weekly averages rather than single readings.

## Interpretation

Body weight is context, not a standalone success signal. In creatine experiments, early increases can reflect water or fat-free-mass changes. In added-sugar-reduction experiments, stable or lower averages may be useful context, but the primary outcome remains added-sugar exposure and adherence rather than weight loss.

In prolonged-fasting experiments, short-term weight changes can mostly reflect food mass, glycogen, fluid shifts, and refeed timing, so they should not be treated as durable fat-loss proof.
