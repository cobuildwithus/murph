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
  caveat: "Murph experiment sessions use a lightweight 0-to-10 rating where 0 is fully alert and 10 is struggling to stay awake; it is not the Epworth or Karolinska scale. Use context and safety notes when naps, illness, travel, or schedule constraints distort the metric."
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
    bestContext: "Use the same 0-to-10 diary question at a comparable daytime point across baseline and intervention."
    howToMeasure:
      - "Ask how sleepy the person felt during the day from 0 (fully alert) to 10 (struggling to stay awake), and keep the wording and timing stable."
      - "Record drowsy driving, sleep attacks, or safety-sensitive impairment separately; no score makes those safe."
      - "Tag nights with illness, travel, caregiving interruptions, shift work, late alcohol, unusual caffeine, or device missingness."
      - "Interpret changes beside total sleep time and sleep opportunity so regularity does not hide unsafe sleep loss."
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

Murph experiment sessions use one stable question: “How sleepy were you during the day, from 0 (fully alert) to 10 (struggling to stay awake)?” This is a repeated same-person signal, not a diagnostic scale. Drowsy driving, sleep attacks, or unsafe impairment override the score and require appropriate safety action.
