---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:continuous-glucose
slug: biomarkers/continuous-glucose
title: Continuous Glucose
summary: An optional glucose-monitoring signal for fasting experiments, useful when already available or clinician-directed but not a safety clearance by itself.
status: draft
quality: usable
aliases:
  - interstitial glucose
  - glucose during fasting
categories:
  - glucose
  - metabolic-health
  - consumer-device
  - fasting
relations:

  -
    type: related_protocol
    target: protocol_variant:prolonged-fasting/prolonged-fasting-24-72-hours
measurementContexts:
  - continuous_glucose_monitor
  - glucometer_if_clinician_directed
unit: mg/dL or mmol/L
interpretationFrame:
  principle: Look for time-below-range, symptoms, and clinician-defined action thresholds rather than treating lower glucose as automatically better during fasting.
  caveat: Diabetes, hypoglycemia history, SGLT2 inhibitors, insulin, and insulin secretagogues are clinician-guided boundaries.
biomarker:
  shortName: CGM glucose
  displayName: Continuous Glucose
  unit: mg/dL or mmol/L
  valuePrecision: 1
  direction:
    desired: mixed_or_contextual
    label: Contextual, not simply lower.
    nuance: During fasting, lower glucose can be a risk signal, especially with symptoms or glucose-lowering medication.
  trendDefaults:
    latestWindowDays: 1
    comparisonWindowDays: 7
    minimumPoints: 8
    aggregation: median
  measurement:
    bestContext: Use only if a CGM or glucose meter is already part of the user’s normal or clinician-directed monitoring.
    howToMeasure:
      - Keep device, units, sensor warm-up status, and symptoms visible.
      - Do not use CGM alone to make medication decisions.
      - Record any clinician-defined low-glucose, high-glucose, ketone, or sick-day action thresholds separately.
    confounders:
      - sensor error
      - compression low
      - exercise
      - illness
      - dehydration
      - medication change
      - alcohol
      - sleep disruption
---

Continuous glucose can help document acute response and safety context, but it must not be used to make medication changes inside a Murph-run fasting experiment.
