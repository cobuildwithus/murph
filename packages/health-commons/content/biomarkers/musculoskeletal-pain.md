---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:musculoskeletal-pain
slug: biomarkers/musculoskeletal-pain
title: Musculoskeletal Pain
summary: Self-rated pain, soreness, or body-region discomfort tracked as a safety and burden outcome.
status: draft
quality: usable
aliases:
- pain rating
- joint pain
- walking soreness
categories:
- safety
- walking
- self-report
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: cites
  target: source_artifact:pmid-17521443
- type: cites
  target: source_artifact:pmid-26289360
- type: cites
  target: source_artifact:pmid-22843637
- type: cites
  target: source_artifact:pmid-25012720
measurementContexts:
- manual_log
- symptom_rating
unit: 0-10 rating
interpretationFrame:
  principle: Compare within-person trends using the same device, logging rule, and baseline/intervention windows.
  caveat: Consumer device, phone carry, gait, placement, illness, travel, weather, and routine changes can distort day-to-day interpretation.
biomarker:
  shortName: pain rating
  displayName: Musculoskeletal Pain
  unit: 0-10 rating
  valuePrecision: 0
  direction:
    desired: lower_or_stable
    label: stable or lower; worsening pain is a downshift signal
    nuance: Pain is a safety and feasibility outcome; pushing through worsening pain is a failed implementation.
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

Track pain or soreness daily during a step-floor experiment, especially in feet, ankles, knees, hips, shins, and back.
