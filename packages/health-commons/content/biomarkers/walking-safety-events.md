---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:walking-safety-events
slug: biomarkers/walking-safety-events
title: Walking Safety Events
summary: Falls, near-falls, cardiopulmonary symptoms, foot or skin problems, heat symptoms, or other safety events during the experiment.
status: draft
quality: usable
aliases:
- walking adverse events
- falls near falls
- safety symptoms
categories:
- safety
- walking
- self-report
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: cites
  target: source_artifact:pmid-15921486
- type: cites
  target: source_artifact:pmid-17521443
- type: cites
  target: source_artifact:pmid-26289360
- type: cites
  target: source_artifact:doi-10.1016-j.bjpt.2023.100500
- type: cites
  target: source_artifact:doi-10.1016-j.diabres.2021.108733
measurementContexts:
- manual_log
- symptom_log
unit: events
interpretationFrame:
  principle: Compare within-person trends using the same device, logging rule, and baseline/intervention windows.
  caveat: Consumer device, phone carry, gait, placement, illness, travel, weather, and routine changes can distort day-to-day interpretation.
biomarker:
  shortName: walking adverse events
  displayName: Walking Safety Events
  unit: events
  valuePrecision: 0
  direction:
    desired: lower_or_stable
    label: zero or fewer safety events
    nuance: Safety events override adherence and step-count gains.
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

Walking safety events are the protocol’s safety backstop. Chest symptoms, faintness, severe dizziness, falls, foot wounds, and heat-illness symptoms should pause the experiment and trigger appropriate guidance.
