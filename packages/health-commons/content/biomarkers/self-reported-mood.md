---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:self-reported-mood
slug: biomarkers/self-reported-mood
title: Self-Reported Mood
summary: A simple same-scale mood rating used to test short-horizon subjective changes without treating the score as a diagnosis.
status: field-testing
quality: usable
aliases:
- self-rated mood
- subjective mood
- wellbeing rating
categories:
- mood
- wellbeing
- self-report
- body-state
measurementContexts:
- morning_self_report
- pre_post_session_self_report
- daily_checkin
unit: score
interpretationFrame:
  principle: Compare the same person on the same scale, in the same timing context, across baseline and intervention windows.
  caveat: Self-reported mood is sensitive to sleep, illness, stress, social context, exercise, caffeine, alcohol, medications, expectation, and novelty. It is not a diagnosis or a substitute for mental-health care.
biomarker:
  shortName: Mood
  displayName: Self-Reported Mood
  unit: score
  valuePrecision: 0
  direction:
    desired: higher_or_stable
    label: Higher or stable can be better when safety and burden are acceptable.
    nuance: Read mood alongside stop conditions, recovery burden, sleep, and adherence. A mood lift that requires unsafe exposure is not a positive result.
  privateMetricBindings:
  - source: metric
    metricKey: mood
    role: primary
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 7
    minimumPoints: 5
    aggregation: median
  explainerCards:
  - title: What it is
    body: A same-scale mood rating, such as 0–10 or 1–5, recorded at a consistent time or before and after a protocol session.
  - title: Why people care
    body: Mood is often the most direct user-centered signal for short self-experiments, especially when clinical or wearable endpoints are indirect.
  - title: How to measure it
    body: Pick one scale, define the anchors, and keep timing stable. For pre/post sessions, log both values and the time gap.
  measurement:
    bestContext: Use the same scale and timing across baseline and intervention. For Cold Plunge, record mood before the session and again 30–180 minutes after the session.
    howToMeasure:
    - Choose one scale, such as 0 = worst mood and 10 = best mood, or a 1–5 check-in scale.
    - Record the value before the session and again at a consistent post-session time.
    - Keep notes on sleep, illness, alcohol, caffeine, hard training, acute stress, and major life events.
    - Do not compare scores across different scales unless they are explicitly transformed in the analysis plan.
    confounders:
    - sleep disruption
    - illness
    - acute stress
    - social context
    - exercise
    - caffeine
    - alcohol
    - medications
    - expectation
    - novelty
    - time of day
relations:
- type: related_protocol
  target: protocol_variant:cold-water-immersion/cold-plunge
---

## Bottom line

Self-reported mood is a simple same-scale check-in. It is useful when a protocol’s main question is whether the user feels better, worse, or unchanged in a short time window.

For Cold Plunge, mood should be read alongside safety and burden. A higher mood score is not a win if the session also caused uncontrolled gasping, chest symptoms, unsafe exit, prolonged cold stress, sleep disruption, or next-day recovery strain.

## How to use it

Pick one scale and keep it stable. A 0–10 scale is easiest:

- 0 = worst mood
- 5 = neutral or usual
- 10 = best mood

For pre/post protocols, log mood before the session and again at the same post-session delay each time. Do not switch between 0–10, 1–5, emoji scales, and free-text labels inside the same experiment unless the analysis plan says how to handle it.

## What can confound it

Mood can move because of sleep, illness, stress, social context, exercise, caffeine, alcohol, medications, weather, expectation, and novelty. Use notes to keep those visible.
