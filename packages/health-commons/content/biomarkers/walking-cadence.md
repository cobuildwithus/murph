---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:walking-cadence
slug: biomarkers/walking-cadence
title: Walking Cadence
summary: Walking intensity proxy expressed as steps per minute, used only as secondary context for Daily Step Floor.
status: draft
quality: usable
aliases:
- cadence
- steps per minute
- walking intensity
categories:
- activity
- walking
- wearable-metric
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: cites
  target: source_artifact:pmid-19362695
- type: cites
  target: source_artifact:pmid-28459099
- type: cites
  target: source_artifact:pmid-30654810
- type: cites
  target: source_artifact:pmid-33168018
- type: cites
  target: source_artifact:pmid-34556146
measurementContexts:
- wearable_activity_summary
- accelerometer
unit: steps/min
interpretationFrame:
  principle: Compare within-person trends using the same device, logging rule, and baseline/intervention windows.
  caveat: Consumer device, phone carry, gait, placement, illness, travel, weather, and routine changes can distort day-to-day interpretation.
biomarker:
  shortName: cadence
  displayName: Walking Cadence
  unit: steps/min
  valuePrecision: 0
  direction:
    desired: mixed_or_contextual
    label: contextual; cadence is not the canonical floor
    nuance: Cadence prescriptions change the intervention into a cadence/MVPA variant.
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

Walking cadence can help interpret intensity, but Daily Step Floor should not require a cadence threshold unless the experiment is explicitly forked into a cadence or MVPA-bout protocol.
