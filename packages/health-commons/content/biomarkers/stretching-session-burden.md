---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:stretching-session-burden
slug: biomarkers/stretching-session-burden
title: Stretching Session Burden
summary: A user-rated hassle, time burden, or friction score for the stretching session.
status: draft
quality: usable
aliases:
- stretching burden
- session hassle
- routine friction
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
- implementation
unit: 0-10
interpretationFrame:
  principle: Compare the same measurement setup across baseline and intervention rather than interpreting a single value.
  caveat: Manual flexibility measures are sensitive to setup, warm-up, pain, practice, and scoring choices.
biomarker:
  shortName: Stretching Session Burden
  displayName: Stretching Session Burden
  unit: 0-10
  valuePrecision: 0
  direction:
    desired: lower_or_stable
    label: Lower burden usually makes the routine easier to sustain.
    nuance: For static-stretching experiments, interpret this alongside adherence, symptoms, burden, and target-area choice.
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 7
    minimumPoints: 2
    aggregation: median
  measurement:
    bestContext: Same-person repeated home measurement using the same setup before and during the protocol.
    howToMeasure:
    - Rate the session burden from 0 to 10 after each session or weekly.
    - Note whether burden came from time, discomfort, setup, boredom, uncertainty, or reminders.
    - Use burden to interpret adherence and decide whether to simplify the routine.
    confounders:
    - routine complexity
    - number of target areas
    - time pressure
    - symptoms
    - reminders
    - perceived benefit
communityOutcomeSummary:
  state: coming_soon
  minimumCohortSize: 20
  placeholder: Early outcome summaries will appear here once enough opted-in static-stretching runs are available.
---

A user-rated hassle, time burden, or friction score for the stretching session.
