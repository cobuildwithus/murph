---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:sleep-quality
slug: biomarkers/sleep-quality
title: Subjective Sleep Quality
summary: A low-burden self-report sleep outcome that captures how restorative or disrupted sleep felt, best interpreted as a repeated personal trend rather than a diagnostic measure.
status: draft
hidden: true
quality: usable
aliases:
  - sleep quality
  - subjective sleep quality
  - PSQI-style sleep quality
  - sleep rating
  - restorative sleep
categories:
  - sleep
  - self-report
  - recovery
  - sleep-diary
relations:

  -
    type: related_protocol
    target: protocol_variant:morning-light-exposure/morning-outdoor-light-exposure
  -
    type: cites
    target: source_artifact:pmid-28786887
  -
    type: cites
    target: source_artifact:doi-10.31086-tjgeri.2020.147
  -
    type: cites
    target: source_artifact:pmid-19560724
  -
    type: cites
    target: source_artifact:pmid-41053799
  -
    type: cites
    target: source_artifact:pmid-39077837
measurementContexts:
  - morning_self_report
  - sleep_diary
  - psqi_style_questionnaire
  - wearable_context
unit: score
interpretationFrame:
  principle: Compare repeated same-scale ratings against your own baseline, and interpret them alongside bedtime, wake time, sleep duration, symptoms, and confounders.
  caveat: Murph experiment sessions use a lightweight 0-to-10 rating where 0 is worst possible and 10 is best possible; this is not a diagnostic questionnaire. Mood, stress, expectations, illness, alcohol, pain, and what happened after waking can move the rating.
biomarker:
  shortName: Sleep quality
  displayName: Subjective Sleep Quality
  unit: score
  valuePrecision: 0
  direction:
    desired: higher_or_stable
    label: Better or stable sleep quality is the goal.
    nuance: Use the same 0-to-10 wording where higher means better. Keep legacy ratings and PSQI global scores separate unless a documented conversion exists.
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 7
    minimumPoints: 5
    aggregation: median
  explainerCards:

    -
      title: What it is
      body: Subjective sleep quality is a quick rating of how well you slept or how restored you felt. It is not the same as a sleep-stage estimate.
    -
      title: Why it matters
      body: Morning-light evidence often uses sleep-quality or sleep-problem questionnaires, so a consistent daily rating is closer to the source outcomes than consumer sleep-stage metrics.
    -
      title: How to read it
      body: Use one stable scale; higher ratings matter when timing, alertness, and confounder notes also improve.
    -
      title: What moves it
      body: Light timing, sleep opportunity, stress, alcohol, illness, pain, travel, and expectation effects can all move a subjective sleep-quality score.
  measurement:
    bestContext: Record the rating soon after waking, before the day changes your memory of the night.
    howToMeasure:
      - Ask the same 0-to-10 question every morning, where 0 is worst possible and 10 is best possible.
      - Optionally pair the rating with a short note such as rested, restless, woke often, hard to fall asleep, or woke too early.
      - Keep the scale stable across baseline and intervention; do not switch questionnaires mid-experiment.
    confounders:
      - stress
      - alcohol
      - illness
      - pain
      - travel
      - sleep debt
      - new medication
      - new exercise
      - expectation effects
communityOutcomeSummary:
  state: insufficient_data
  minimumCohortSize: 30
  placeholder: No community outcome is available yet for Morning Outdoor Light Exposure and subjective sleep quality.
---

Subjective sleep quality is a practical primary outcome for morning-light experiments because it is low-burden and close to the outcomes used in the closest outdoor/natural-light sources.

Use it as a **same-person trend**, not a diagnosis. A useful Murph log can be as simple as: “How was your sleep quality last night, from 0 (worst possible) to 10 (best possible)?” plus bedtime, final wake time, morning alertness, and a short confounder note.

For Morning Outdoor Light Exposure, subjective sleep quality should be interpreted alongside exposure adherence, sleep timing, evening-light changes, symptoms, UV/heat constraints, and whether the exposure was truly outdoors rather than through a window.
