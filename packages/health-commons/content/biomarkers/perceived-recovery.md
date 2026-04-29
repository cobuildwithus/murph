---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:perceived-recovery
slug: biomarkers/perceived-recovery
title: Perceived Recovery
summary: A subjective readiness or recovery rating that can contextualize training response but should not be treated as a primary creatine efficacy claim by itself.
status: draft
quality: usable
categories:
  - recovery
  - self-report
  - manual-checkin
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
  shortName: Perceived Recovery
  displayName: Perceived Recovery
  unit: score
  valuePrecision: 1
  direction:
    desired: higher
    label: Higher readiness or recovery is usually better.
    nuance: Sleep, stress, soreness, training load, illness, and expectations can move recovery ratings independently of creatine.
  measurement:
    bestContext: Use a same-time daily or pre-training readiness question across baseline and intervention windows.
    howToMeasure:
      - Use the same 1-to-5 or 0-to-10 recovery prompt.
      - Keep timing consistent, such as morning or pre-workout.
      - Review alongside sleep, soreness, illness, stress, and training load.
    confounders:
      - sleep_loss
      - training_load_change
      - soreness
      - illness
      - stress
      - alcohol
      - expectancy
---

A subjective readiness or recovery rating that can contextualize training response but should not be treated as a primary creatine efficacy claim by itself.
