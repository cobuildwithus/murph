---
schemaVersion: hv/goal@v1
goalId: goal_rhr_01
slug: reach-lower-nighttime-rhr
title: Reach sub-40 lowest nighttime RHR
status: active
horizon: long_term
priority: 2
window:
  startAt: 2026-03-14
  targetAt: 2026-06-30
domains:
  - cardiovascular-health
  - sleep-recovery
goalTemplateSlug: lower-resting-heart-rate
primaryBiomarkerSlug: resting-heart-rate
measurementContext: nighttime-lowest-wearable
target:
  comparator: below
  value: 40
  unit: bpm
relatedExperimentIds:
  - exp_rhr_zone2_01
---
# Reach sub-40 lowest nighttime RHR

Targeting the wearable sleep-derived signal, not an awake manual pulse.
