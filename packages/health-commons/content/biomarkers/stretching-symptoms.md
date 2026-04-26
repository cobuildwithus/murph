---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:stretching-symptoms
slug: biomarkers/stretching-symptoms
title: Stretching Symptoms
summary: A safety log for pain, neurologic symptoms, instability, strain-like symptoms, and symptom worsening during or after static stretching.
status: draft
quality: usable
aliases:
- stretching adverse symptoms
- pain during stretching
- stretching safety symptoms
categories:
- flexibility
- static-stretching
- manual-measurement
relations:
-
  type: related_protocol
  target: protocol_variant:static-stretching/at-home-static-stretching-for-flexibility
measurementContexts:
- safety_log
- symptom_log
unit: symptom_log
interpretationFrame:
  principle: Compare the same measurement setup across baseline and intervention rather than interpreting a single value.
  caveat: Manual flexibility measures are sensitive to setup, warm-up, pain, practice, and scoring choices.
biomarker:
  shortName: Stretching Symptoms
  displayName: Stretching Symptoms
  unit: symptom_log
  valuePrecision: 0
  direction:
    desired: lower_or_stable
    label: Fewer or stable symptoms is preferred; red-flag symptoms should stop the run.
    nuance: For static-stretching experiments, interpret this alongside adherence, symptoms, burden, and target-area choice.
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 7
    minimumPoints: 2
    aggregation: median
  measurement:
    bestContext: Same-person repeated home measurement using the same setup before and during the protocol.
    howToMeasure:
    - Record pain, neurologic symptoms, instability, strain-like sensations, or unusual symptoms during and after sessions.
    - Mark whether symptoms stopped when the stretch stopped or persisted.
    - Use protocol stop conditions when symptoms are sharp, radiating, neurologic, unstable, worsening, or strain-like.
    confounders:
    - acute injury
    - overpressure
    - unsupported balance
    - recent exercise
    - hypermobility
    - pregnancy/postpartum context
    - pain condition
communityOutcomeSummary:
  state: coming_soon
  minimumCohortSize: 20
  placeholder: Early Murph outcome summaries will appear here once enough opted-in static-stretching runs are available.
---

A safety log for pain, neurologic symptoms, instability, strain-like symptoms, and symptom worsening during or after static stretching.
