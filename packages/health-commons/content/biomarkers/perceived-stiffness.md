---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:perceived-stiffness
slug: biomarkers/perceived-stiffness
title: Perceived Stiffness
summary: A subjective tightness or stiffness rating that helps interpret a flexibility run without treating sensation as the same thing as measured ROM.
status: draft
quality: usable
aliases:
- tightness rating
- stiffness score
- perceived tightness
categories:
- flexibility
- static-stretching
- manual-measurement
relations:
-
  type: related_protocol
  target: protocol_variant:static-stretching/at-home-static-stretching-for-flexibility
measurementContexts:
- self_rating
- symptom_log
unit: 0-10
interpretationFrame:
  principle: Compare the same measurement setup across baseline and intervention rather than interpreting a single value.
  caveat: Manual flexibility measures are sensitive to setup, warm-up, pain, practice, and scoring choices.
biomarker:
  shortName: Perceived Stiffness
  displayName: Perceived Stiffness
  unit: 0-10
  valuePrecision: 0
  direction:
    desired: lower_or_stable
    label: Lower may feel better, but stiffness should be interpreted separately from ROM.
    nuance: For static-stretching experiments, interpret this alongside adherence, symptoms, burden, and target-area choice.
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 7
    minimumPoints: 2
    aggregation: median
  measurement:
    bestContext: Same-person repeated home measurement using the same setup before and during the protocol.
    howToMeasure:
    - Rate the target area from 0 to 10 before or after each session using the same anchor wording.
    - Keep the rating separate from the objective ROM measurement.
    - Note soreness, sleep, stress, illness, and training load when stiffness changes.
    confounders:
    - soreness
    - sleep
    - stress
    - illness
    - training load
    - hydration
    - expectations
communityOutcomeSummary:
  state: coming_soon
  minimumCohortSize: 20
  placeholder: Early Murph outcome summaries will appear here once enough opted-in static-stretching runs are available.
---

A subjective tightness or stiffness rating that helps interpret a flexibility run without treating sensation as the same thing as measured ROM.
