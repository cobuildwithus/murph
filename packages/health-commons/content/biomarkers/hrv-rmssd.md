---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:hrv-rmssd
slug: biomarkers/hrv-rmssd
title: HRV / RMSSD
summary: A heart-rate-variability marker used as a recovery and autonomic signal, with strong device and context caveats.
status: draft
quality: stub
aliases:
  - HRV
  - RMSSD
categories:
  - recovery
  - autonomic
measurementContexts:
  - overnight_wearable
  - morning_resting_manual
unit: ms
interpretationFrame:
  principle: Personal baseline matters more than cross-person comparison.
  caveat: HRV is sensitive to alcohol, illness, stress, measurement timing, and device algorithms.
---

HRV can be useful, but Murph protocol pages should avoid promising fixed HRV deltas unless supported by the exact experiment design.
