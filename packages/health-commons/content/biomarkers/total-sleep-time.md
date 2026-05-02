---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:total-sleep-time"
slug: "biomarkers/total-sleep-time"
title: "Total Sleep Time"
summary: "A sleep-duration guardrail estimating how many minutes were spent asleep during the main sleep episode or 24-hour period."
status: "draft"
quality: "usable"
aliases:
  - "sleep duration"
  - "TST"
  - "total sleep duration"
  - "minutes asleep"
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
    target: "source_artifact:pmid-26039963"
  -
    type: "cites"
    target: "source_artifact:pmid-27250809"
  -
    type: "cites"
    target: "source_artifact:pmid-29073398"
measurementContexts:
  - "sleep_diary"
  - "overnight_wearable"
  - "actigraphy"
  - "polysomnography"
unit: "minutes"
interpretationFrame:
  principle: "Compare repeated baseline and intervention windows rather than single nights."
  caveat: "Use diary context and safety notes when device detection, naps, illness, travel, or schedule constraints distort the metric."
biomarker:
  shortName: "Total Sleep Time"
  displayName: "Total Sleep Time"
  unit: "minutes"
  valuePrecision: 0
  direction:
    desired: "higher_or_stable"
    label: "Enough and stable sleep is the target, not maximal sleep at all costs."
    nuance: "A consistent wake target should not reduce total sleep time or sleep opportunity enough to worsen functioning."
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
      source: metric
      metricKey: total-sleep-minutes
      role: primary
---

Total Sleep Time is included for the Consistent Wake Time protocol because the run needs a measurable sleep-timing or safety signal.

For Consistent Wake Time, total sleep time is a safety and interpretation guardrail. A lower wake-time variability score is not a clean success when total sleep time drops materially.

This page is not a diagnostic definition. It is a practical Health Commons measurement page for repeated self-experiment windows.
