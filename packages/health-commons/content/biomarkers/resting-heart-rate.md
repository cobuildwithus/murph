---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:resting-heart-rate
slug: biomarkers/resting-heart-rate
title: Resting Heart Rate
summary: A resting pulse marker that can help users interpret recovery, fitness, illness, stress, and protocol response trends without treating one number as a verdict.
status: draft
quality: usable
aliases:
  - RHR
  - resting pulse
categories:
  - cardiovascular
  - recovery
  - wearable-metric
relations:
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
measurementContexts:
  - overnight_wearable
  - morning_resting_manual
unit: bpm
interpretationFrame:
  principle: Trend beats a single value.
  caveat: Device windows and smoothing differ, so compare like with like.
---

Resting heart rate is the primary Murph v1 endpoint for the dry-sauna experiment because it is widely available across wearable providers and usually easier to explain than noisier recovery scores.

Murph should compare RHR against the user's own baseline, annotate confounders such as illness, alcohol, heavy training, travel, and poor sleep, and avoid treating a single morning value as a verdict.
