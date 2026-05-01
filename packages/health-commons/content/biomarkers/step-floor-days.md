---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:step-floor-days
slug: biomarkers/step-floor-days
title: Step Floor Days
summary: Number or percentage of days the selected daily step floor was reached.
status: draft
quality: usable
aliases:
- floor-hit days
- step goal adherence
- daily step target days
categories:
- activity
- walking
- adherence
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: cites
  target: source_artifact:pmid-15809569
- type: cites
  target: source_artifact:pmid-22429600
- type: cites
  target: source_artifact:10000steps-setting-step-goal-2026-04-26
measurementContexts:
- manual_log
- phone_step_counter
- wearable_step_counter
unit: days/week
interpretationFrame:
  principle: Compare within-person trends using the same device, logging rule, and baseline/intervention windows.
  caveat: Consumer device, phone carry, gait, placement, illness, travel, weather, and routine changes can distort day-to-day interpretation.
biomarker:
  shortName: floor-hit days
  displayName: Step Floor Days
  unit: days/week
  valuePrecision: 0
  direction:
    desired: higher_or_stable
    label: more floor-hit days, if sustainable
    nuance: This is an adherence marker; a high score with pain or obsession is not a good result.
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 14
    minimumPoints: 5
    aggregation: median
  measurement:
    bestContext: Daily Step Floor self-experiments using one consistent phone, wearable, or pedometer source.
    howToMeasure:
    - Use the same source of truth throughout baseline and intervention.
    - Flag days with missing carry/wear time, device changes, illness, travel, or unusual occupational walking.
    confounders:
    - device change
    - phone not carried
    - watch off time
    - illness
    - travel
    - weather or heat
    - unusual work walking
    - footwear or terrain change
---

Step floor days show whether the chosen floor was repeatable. Use it together with pain, fatigue, safety symptoms, and life-friction logs.
