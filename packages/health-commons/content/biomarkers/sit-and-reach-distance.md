---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:sit-and-reach-distance
slug: biomarkers/sit-and-reach-distance
title: Sit-and-Reach Distance
summary: A seated reach measure often used as a practical proxy for hamstring or posterior-chain flexibility when the setup is repeated consistently.
status: draft
quality: usable
aliases:
- sit and reach
- chair sit-and-reach
- seated reach test
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
- hamstring_reach
- posterior_chain_reach
unit: cm
interpretationFrame:
  principle: Compare the same measurement setup across baseline and intervention rather than interpreting a single value.
  caveat: Manual flexibility measures are sensitive to setup, warm-up, pain, practice, and scoring choices.
biomarker:
  shortName: Sit-and-Reach Distance
  displayName: Sit-and-Reach Distance
  unit: cm
  valuePrecision: 1
  direction:
    desired: higher
    label: Higher reach usually means more posterior-chain reach in the same setup.
    nuance: For static-stretching experiments, interpret this alongside adherence, symptoms, burden, and target-area choice.
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 7
    minimumPoints: 2
    aggregation: median
  measurement:
    bestContext: Same-person repeated home measurement using the same setup before and during the protocol.
    howToMeasure:
    - Use the same box, ruler, wall, or chair setup each time.
    - Keep knees, foot position, and reach instructions the same across baseline and intervention.
    - Record the best or average of repeated attempts only if you use the same rule every time.
    confounders:
    - box or ruler setup
    - knee position
    - spine rounding
    - hip position
    - practice effect
    - warm-up state
    - recent exercise
communityOutcomeSummary:
  state: coming_soon
  minimumCohortSize: 20
  placeholder: Early Murph outcome summaries will appear here once enough opted-in static-stretching runs are available.
---

A seated reach measure often used as a practical proxy for hamstring or posterior-chain flexibility when the setup is repeated consistently.
