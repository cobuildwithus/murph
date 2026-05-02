---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:stretching-adherence-sessions
slug: biomarkers/stretching-adherence-sessions
title: Stretching Adherence Sessions
summary: A count of planned static-stretching sessions completed during a protocol run.
status: draft
quality: usable
aliases:
- stretching sessions completed
- adherence sessions
- completed stretch sessions
categories:
- flexibility
- static-stretching
- manual-measurement
relations:
-
  type: related_protocol
  target: protocol_variant:static-stretching/at-home-static-stretching-for-flexibility
measurementContexts:
- manual_log
- implementation
unit: sessions
interpretationFrame:
  principle: Compare the same measurement setup across baseline and intervention rather than interpreting a single value.
  caveat: Manual flexibility measures are sensitive to setup, warm-up, pain, practice, and scoring choices.
biomarker:
  shortName: Stretching Adherence Sessions
  displayName: Stretching Adherence Sessions
  unit: sessions
  valuePrecision: 0
  direction:
    desired: higher_or_stable
    label: Higher adherence makes interpretation easier, but more is not automatically safer or better.
    nuance: For static-stretching experiments, interpret this alongside adherence, symptoms, burden, and target-area choice.
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 7
    minimumPoints: 2
    aggregation: median
  measurement:
    bestContext: Same-person repeated home measurement using the same setup before and during the protocol.
    howToMeasure:
    - Record whether each planned session happened.
    - Also log holds completed and total hold seconds so exposure is not reduced to a yes/no check.
    - Record missed-session reasons without treating them as failure.
    confounders:
    - travel
    - schedule friction
    - soreness
    - pain
    - boredom
    - routine length
    - competing training
communityOutcomeSummary:
  state: coming_soon
  minimumCohortSize: 20
  placeholder: Early outcome summaries will appear here once enough opted-in static-stretching runs are available.
---

A count of planned static-stretching sessions completed during a protocol run.
