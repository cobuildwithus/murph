---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:daily-step-count
slug: biomarkers/daily-step-count
title: Daily Step Count
summary: Total daily steps from one consistent phone, wearable, or pedometer source.
status: draft
quality: usable
aliases:
- daily steps
- steps per day
- step count
categories:
- activity
- walking
- wearable-metric
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: cites
  target: source_artifact:pmid-18029834
- type: cites
  target: source_artifact:pmid-19791652
- type: cites
  target: source_artifact:pmid-33036635
measurementContexts:
- phone_step_counter
- wearable_step_counter
- pedometer
unit: steps/day
interpretationFrame:
  principle: Compare within-person trends using the same device, logging rule, and baseline/intervention windows.
  caveat: Consumer device, phone carry, gait, placement, illness, travel, weather, and routine changes can distort day-to-day interpretation.
biomarker:
  shortName: daily steps
  displayName: Daily Step Count
  unit: steps/day
  valuePrecision: 0
  direction:
    desired: higher_or_stable
    label: higher, if symptoms and recovery stay stable
    nuance: The primary signal is whether total steps rise versus baseline without worsening safety or recovery.
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
    expectedDirection: up_or_stable
    relationship: primary_biomarker
    mechanism: The primary signal is whether total steps rise versus baseline without worsening safety or recovery.
    scoring:
      evidenceWeight: 4
      biomarkerRelevance: 5
      wearableMeasurability: 5
      burdenPenalty: 1
      safetyCautionPenalty: 1
    display:
      confidence: medium
      burdenLabel: low
      cautionLabel: context
---

Daily step count is the primary outcome for Daily Step Floor. Treat it as a within-person trend, not as a cross-device absolute.
