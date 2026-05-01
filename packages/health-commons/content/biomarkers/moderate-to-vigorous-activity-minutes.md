---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:moderate-to-vigorous-activity-minutes
slug: biomarkers/moderate-to-vigorous-activity-minutes
title: Moderate-to-Vigorous Activity Minutes
summary: Estimated MVPA minutes used as optional context when a step floor also changes activity intensity.
status: draft
quality: usable
aliases:
- MVPA minutes
- moderate vigorous activity
- active minutes
categories:
- activity
- wearable-metric
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: cites
  target: source_artifact:healthgov-physical-activity-guidelines-americans-2018-11-12
- type: cites
  target: source_artifact:who-physical-activity-guidelines-2020-11-25
- type: cites
  target: source_artifact:pmid-24528783
measurementContexts:
- wearable_activity_summary
- accelerometer
unit: minutes/week
interpretationFrame:
  principle: Compare within-person trends using the same device, logging rule, and baseline/intervention windows.
  caveat: Consumer device, phone carry, gait, placement, illness, travel, weather, and routine changes can distort day-to-day interpretation.
biomarker:
  shortName: MVPA minutes
  displayName: Moderate-to-Vigorous Activity Minutes
  unit: minutes/week
  valuePrecision: 0
  direction:
    desired: mixed_or_contextual
    label: contextual; useful if measured consistently
    nuance: MVPA is a secondary interpretation signal, not proof that the total-step floor hit an intensity guideline.
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

MVPA minutes are useful when a device reports them, but requiring MVPA changes the dose from a daily total-step floor to an intensity protocol.
