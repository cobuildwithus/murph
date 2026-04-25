---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:wake-time-variability"
slug: "biomarkers/wake-time-variability"
title: "Wake-Time Variability"
summary: "A sleep-timing regularity marker summarizing how much final wake or rise time varies across repeated nights."
status: "draft"
quality: "usable"
aliases:
  - "wake time SD"
  - "wake-time standard deviation"
  - "rise-time variability"
  - "wake-window adherence"
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
measurementContexts:
  - "sleep_diary"
  - "overnight_wearable"
  - "actigraphy"
unit: "minutes"
interpretationFrame:
  principle: "Compare repeated baseline and intervention windows rather than single nights."
  caveat: "Use diary context and safety notes when device detection, naps, illness, travel, or schedule constraints distort the metric."
biomarker:
  shortName: "Wake-Time Variability"
  displayName: "Wake-Time Variability"
  unit: "minutes"
  valuePrecision: 0
  direction:
    desired: "lower"
    label: "Lower variability is usually the target when enough sleep is preserved."
    nuance: "Lower is not automatically better if it comes from chronic short sleep, unsafe early waking, or ignoring recovery needs."
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
  privateMetricBindings:
    -
      source: "browser_vault_metric"
      domain: "sleep"
      metric: "wakeTime"
      unit: "local_time"
      preferred: true
    -
      source: "browser_vault_signal_summary"
      accessor: "sleep.finalWakeTime"
      unit: "local_time"
---

Wake-Time Variability is included for the Consistent Wake Time protocol because the run needs a measurable sleep-timing or safety signal.

For Consistent Wake Time, lower wake-time variability is the primary behavior signal. Interpret it beside total sleep time, daytime sleepiness, and exception logs.

This page is not a diagnostic definition. It is a practical Health Commons measurement page for repeated self-experiment windows.
