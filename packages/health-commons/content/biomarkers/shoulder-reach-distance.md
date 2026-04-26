---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:shoulder-reach-distance
slug: biomarkers/shoulder-reach-distance
title: Shoulder Reach Distance
summary: A repeated home shoulder reach measure for upper-body stretching runs, best interpreted only for the selected arm, side, and reach pattern.
status: draft
quality: usable
aliases:
- back scratch distance
- hand-behind-back reach
- shoulder reach
- wall slide reach
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
- upper_body_reach
unit: cm
interpretationFrame:
  principle: Compare the same measurement setup across baseline and intervention rather than interpreting a single value.
  caveat: Manual flexibility measures are sensitive to setup, warm-up, pain, practice, and scoring choices.
biomarker:
  shortName: Shoulder Reach Distance
  displayName: Shoulder Reach Distance
  unit: cm
  valuePrecision: 1
  direction:
    desired: mixed_or_contextual
    label: Direction depends on the chosen reach test; compare only the same side and same setup.
    nuance: For static-stretching experiments, interpret this alongside adherence, symptoms, burden, and target-area choice.
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 7
    minimumPoints: 2
    aggregation: median
  measurement:
    bestContext: Same-person repeated home measurement using the same setup before and during the protocol.
    howToMeasure:
    - Choose one shoulder reach pattern before starting, such as back-scratch distance, hand-behind-back reach, or a wall-slide endpoint.
    - Use the same side, posture, wall contact, clothing, and measurement direction each time.
    - Stop measuring if the shoulder is painful, unstable, recently injured, or neurologically symptomatic.
    confounders:
    - arm dominance
    - scapular motion
    - thoracic posture
    - pain history
    - wall contact
    - measurement direction
    - clothing
communityOutcomeSummary:
  state: coming_soon
  minimumCohortSize: 20
  placeholder: Early Murph outcome summaries will appear here once enough opted-in static-stretching runs are available.
---

A repeated home shoulder reach measure for upper-body stretching runs, best interpreted only for the selected arm, side, and reach pattern.
