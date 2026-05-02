---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:toe-touch-distance
slug: biomarkers/toe-touch-distance
title: Toe-Touch Distance
summary: A low-equipment posterior-chain reach measure used to track whether fingertips move closer to or past the floor over repeated tests.
status: draft
quality: usable
aliases:
- fingertips-to-floor distance
- toe touch
- forward bend reach
- standing toe-touch distance
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
- posterior_chain_reach
unit: cm
interpretationFrame:
  principle: Compare the same measurement setup across baseline and intervention rather than interpreting a single value.
  caveat: Manual flexibility measures are sensitive to setup, warm-up, pain, practice, and scoring choices.
biomarker:
  shortName: Toe-Touch Distance
  displayName: Toe-Touch Distance
  unit: cm
  valuePrecision: 1
  direction:
    desired: lower
    label: Lower distance to the floor usually means more reach; negative or past-floor scoring should be documented consistently.
    nuance: For static-stretching experiments, interpret this alongside adherence, symptoms, burden, and target-area choice.
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 7
    minimumPoints: 2
    aggregation: median
  measurement:
    bestContext: Same-person repeated home measurement using the same setup before and during the protocol.
    howToMeasure:
    - Stand with feet in the same position each time and knees in the same locked or softly bent rule you chose at baseline.
    - Reach slowly toward the floor without bouncing and record the distance from fingertips to floor, or how far beyond the floor/step you reached if using a negative score.
    - Use the same time of day, warm-up state, footwear, surface, and scoring direction throughout the run.
    confounders:
    - warm-up state
    - time of day
    - footwear
    - knee bend
    - spine rounding
    - recent exercise
    - soreness
    - measurement direction
communityOutcomeSummary:
  state: coming_soon
  minimumCohortSize: 20
  placeholder: Early outcome summaries will appear here once enough opted-in static-stretching runs are available.
---

A low-equipment posterior-chain reach measure used to track whether fingertips move closer to or past the floor over repeated tests.
