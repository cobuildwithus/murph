---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:sedentary-time
slug: biomarkers/sedentary-time
title: Sedentary Time
summary: Estimated daily sedentary minutes or sitting time used as context for activity-pattern changes.
status: draft
quality: usable
aliases:
- sitting time
- sedentary minutes
- sedentary behavior
categories:
- activity
- wearable-metric
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: cites
  target: source_artifact:pmid-22866941
- type: cites
  target: source_artifact:pmid-25112481
- type: cites
  target: source_artifact:pmid-26334900
measurementContexts:
- wearable_activity_summary
- self_report
unit: minutes/day
interpretationFrame:
  principle: Compare within-person trends using the same device, logging rule, and baseline/intervention windows.
  caveat: Consumer device, phone carry, gait, placement, illness, travel, weather, and routine changes can distort day-to-day interpretation.
biomarker:
  shortName: sitting time
  displayName: Sedentary Time
  unit: minutes/day
  valuePrecision: 0
  direction:
    desired: lower_or_stable
    label: lower or stable, without crowding out recovery
    nuance: A step floor may reduce sedentary time, but sedentary-time interventions are not the same as a total-step-floor dose.
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
protocolRanking:
  version: daily-step-floor-draft-2026-04-28
  scoreFormula: Protocol-specific ranking uses relevance to Daily Step Floor decision-making, measurement feasibility, burden, and safety caution.
  candidates:
  - protocolKey: protocol_variant:daily-step-floor/daily-step-floor
    expectedDirection: down_or_stable
    relationship: secondary_biomarker
    mechanism: A step floor may reduce sedentary time, but sedentary-time interventions are not the same as a total-step-floor dose.
    scoring:
      evidenceWeight: 3
      biomarkerRelevance: 3
      wearableMeasurability: 5
      burdenPenalty: 1
      safetyCautionPenalty: 1
    display:
      confidence: medium
      burdenLabel: low
      cautionLabel: context
---

Sedentary time is a context marker. It can help interpret whether a higher step count came from shorter sitting blocks, but it is not the canonical dose.
