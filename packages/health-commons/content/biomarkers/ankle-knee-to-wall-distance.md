---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:ankle-knee-to-wall-distance
slug: biomarkers/ankle-knee-to-wall-distance
title: Ankle Knee-to-Wall Distance
summary: A low-equipment ankle dorsiflexion measure that records how far the foot can be from a wall while the knee reaches the wall and the heel stays down.
status: draft
quality: usable
aliases:
- knee-to-wall distance
- weight-bearing lunge distance
- ankle dorsiflexion lunge test
categories:
- flexibility
- static-stretching
- manual-measurement
relations:
-
  type: related_protocol
  target: protocol_variant:static-stretching/at-home-static-stretching-for-flexibility
measurementContexts:
- home_manual
- ankle_dorsiflexion
unit: cm
interpretationFrame:
  principle: Compare the same measurement setup across baseline and intervention rather than interpreting a single value.
  caveat: Manual flexibility measures are sensitive to setup, warm-up, pain, practice, and scoring choices.
biomarker:
  shortName: Ankle Knee-to-Wall Distance
  displayName: Ankle Knee-to-Wall Distance
  unit: cm
  valuePrecision: 1
  direction:
    desired: higher
    label: Higher distance usually means more weight-bearing ankle dorsiflexion in the same setup.
    nuance: For static-stretching experiments, interpret this alongside adherence, symptoms, burden, and target-area choice.
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 7
    minimumPoints: 2
    aggregation: median
  measurement:
    bestContext: Same-person repeated home measurement using the same setup before and during the protocol.
    howToMeasure:
    - Use the same wall, foot angle, side, and heel-down rule each time.
    - Move the foot back until the knee can just touch the wall without the heel lifting.
    - Record distance from big toe or chosen foot landmark to the wall using the same landmark every time.
    confounders:
    - foot angle
    - heel lift
    - side tested
    - wall distance method
    - calf warm-up
    - footwear
    - recent walking or running
communityOutcomeSummary:
  state: coming_soon
  minimumCohortSize: 20
  placeholder: Early outcome summaries will appear here once enough opted-in static-stretching runs are available.
---

A low-equipment ankle dorsiflexion measure that records how far the foot can be from a wall while the knee reaches the wall and the heel stays down.
