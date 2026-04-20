---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:hrv-rmssd
slug: biomarkers/hrv-rmssd
title: HRV / RMSSD
summary: A heart-rate-variability marker used as a recovery and autonomic signal, with strong device and context caveats.
status: draft
quality: usable
aliases:
  - HRV
  - RMSSD
categories:
  - recovery
  - autonomic
  - wearable-metric
relations:
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
measurementContexts:
  - overnight_wearable
  - morning_resting_manual
unit: ms
interpretationFrame:
  principle: Personal baseline matters more than cross-person comparison.
  caveat: HRV is sensitive to alcohol, illness, stress, measurement timing, training load, and device algorithms.
---

HRV can be useful, but Murph protocol pages should avoid promising fixed HRV deltas unless supported by the exact experiment design.

For the dry-sauna v1 experiment, HRV is an exploratory secondary marker. It may move for some people, but the current page should set expectations that HRV can be noisy or unchanged even when a protocol is worth repeating.
