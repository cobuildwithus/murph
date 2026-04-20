---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:sleep-efficiency
slug: biomarkers/sleep-efficiency
title: Sleep Efficiency
summary: A sleep-continuity marker that estimates the percentage of time in bed spent asleep, with device and context caveats.
status: draft
quality: usable
aliases:
  - sleep efficiency percentage
categories:
  - sleep
  - wearable-metric
relations:
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
measurementContexts:
  - overnight_wearable
unit: percent
interpretationFrame:
  principle: Look for stable trend changes, not one-night perfection.
  caveat: Device estimates can be affected by time in bed, awakenings, sensor placement, illness, alcohol, and travel.
---

Sleep efficiency is a secondary Murph marker for protocols that may change relaxation, thermoregulation, or recovery. It should be interpreted with bedtime, wake time, and subjective sleep quality.
