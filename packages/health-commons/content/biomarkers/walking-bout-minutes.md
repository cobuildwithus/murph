---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:walking-bout-minutes
slug: biomarkers/walking-bout-minutes
title: Walking Bout Minutes
summary: Minutes accumulated in intentional or device-detected walking bouts.
status: draft
quality: usable
aliases:
- walking minutes
- intentional walking minutes
- walking bouts
categories:
- activity
- walking
- wearable-metric
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: cites
  target: source_artifact:doi-10.7326-annals-25-01547
- type: cites
  target: source_artifact:pmid-28459099
- type: cites
  target: source_artifact:pmid-33168018
measurementContexts:
- wearable_activity_summary
- manual_log
unit: minutes/day
interpretationFrame:
  principle: Compare within-person trends using the same device, logging rule, and baseline/intervention windows.
  caveat: Consumer device, phone carry, gait, placement, illness, travel, weather, and routine changes can distort day-to-day interpretation.
biomarker:
  shortName: walking minutes
  displayName: Walking Bout Minutes
  unit: minutes/day
  valuePrecision: 0
  direction:
    desired: mixed_or_contextual
    label: contextual; more is not always better
    nuance: Bout minutes help explain how the floor was achieved, while the core protocol remains total daily steps.
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

Walking bout minutes can distinguish errands and all-day accumulation from planned walks. Use it as context, not as a required dose unless testing a separate bout-based variant.
