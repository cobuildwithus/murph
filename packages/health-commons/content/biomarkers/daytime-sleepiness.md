---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:daytime-sleepiness"
slug: "biomarkers/daytime-sleepiness"
title: "Daytime Sleepiness"
summary: "A subjective or scale-based daytime impairment signal used to detect whether a sleep-timing experiment is helping or becoming unsafe."
status: "draft"
quality: "usable"
aliases:
  - "sleepiness"
  - "daytime alertness"
  - "Epworth sleepiness"
  - "Karolinska sleepiness"
  - "morning impairment"
categories:
  - "sleep"
  - "sleep-regularity"
  - "self-experiment-metric"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:consistent-wake-time/consistent-wake-time"
  -
    type: "cites"
    target: "source_artifact:pmid-22294820"
  -
    type: "cites"
    target: "source_artifact:pmid-33864369"
  -
    type: "cites"
    target: "source_artifact:pmid-37684151"
  -
    type: "cites"
    target: "source_artifact:pmid-24497651"
  -
    type: "cites"
    target: "source_artifact:pmid-26414989"
  -
    type: "cites"
    target: "source_artifact:pmid-30239905"
  -
    type: "cites"
    target: "source_artifact:aaafoundation-acute-sleep-deprivation-crash-risk-2016-12-01"
measurementContexts:
  - "manual_rating"
  - "validated_questionnaire"
  - "daily_checkin"
unit: "score"
interpretationFrame:
  principle: "Compare repeated baseline and intervention windows rather than single nights."
  caveat: "Use diary context and safety notes when device detection, naps, illness, travel, or schedule constraints distort the metric."
biomarker:
  shortName: "Daytime Sleepiness"
  displayName: "Daytime Sleepiness"
  unit: "score"
  valuePrecision: 0
  direction:
    desired: "lower"
    label: "Lower sleepiness is generally better when it reflects adequate sleep and safe alertness."
    nuance: "Persistent excessive sleepiness, drowsy driving, or unsafe impairment is a safety boundary, not a metric to optimize casually."
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 7
    minimumPoints: 5
    aggregation: "median"
  measurement:
    bestContext: "Use the same diary and/or wearable method across baseline and intervention."
    howToMeasure:
      - "Record the relevant sleep field daily, ideally immediately after waking or during the morning log."
      - "Use the same device and diary wording across baseline and intervention."
      - "Tag nights with illness, travel, caregiving interruptions, shift work, late alcohol, unusual caffeine, or device missingness."
      - "Interpret changes beside total sleep time and daytime sleepiness so regularity does not hide unsafe sleep loss."
    confounders:
      - "device changes"
      - "missing nights"
      - "naps"
      - "illness"
      - "travel"
      - "shift work"
      - "caregiving"
      - "stress"
      - "alcohol"
      - "caffeine"
      - "light exposure"
---

Daytime Sleepiness is included for the Consistent Wake Time protocol because the run needs a measurable sleep-timing or safety signal.

For Consistent Wake Time, daytime sleepiness is both an outcome and a stop-rule signal. Worsening sleepiness should outweigh adherence.

This page is not a diagnostic definition. It is a practical Health Commons measurement page for repeated self-experiment windows.
