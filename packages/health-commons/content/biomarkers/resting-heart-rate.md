---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:resting-heart-rate
slug: biomarkers/resting-heart-rate
title: Resting Heart Rate
summary: A resting pulse marker that can help users interpret recovery, fitness, illness, stress, and protocol response trends without treating one number as a verdict.
status: draft
quality: stub
aliases:
  - RHR
  - resting pulse
categories:
  - cardiovascular
  - recovery
measurementContexts:
  - overnight_wearable
  - morning_resting_manual
unit: bpm
interpretationFrame:
  principle: Trend beats a single value.
  caveat: Device windows and smoothing differ, so compare like with like.
---

Resting heart rate is a useful Murph v1 outcome because it is common across wearable providers and usually easier to explain than noisier recovery scores.
