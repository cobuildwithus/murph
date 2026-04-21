---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:hrv-rmssd
slug: biomarkers/hrv-rmssd
title: HRV / RMSSD
summary: A recovery and autonomic signal that can be interesting when it repeats, but is noisy enough to treat as context rather than proof.
status: field-testing
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
  -
    type: cites
    target: source_artifact:pmid-31331560
  -
    type: cites
    target: source_artifact:pmid-25432420
  -
    type: cites
    target: source_artifact:pmid-34622026
  -
    type: cites
    target: source_artifact:pmid-40611569
measurementContexts:
  - overnight_wearable
  - morning_resting_manual
unit: ms
interpretationFrame:
  principle: Personal baseline matters more than cross-person comparison.
  caveat: HRV is sensitive to sleep, illness, alcohol, stress, measurement timing, training load, and device algorithms.
---

HRV can be interesting for dry sauna, but it works better as an **exploratory secondary marker** than as the main verdict.

Why the caution:

- some acute physiology papers make HRV look promising,
- repeated heat-acclimation work suggests adaptation can happen over weeks,
- but a modern multi-arm randomized trial showed **no reliable HRV improvement** from regular post-exercise sauna bathing.

That means a null HRV result should not automatically count as a protocol failure, and a positive HRV result should be checked against confounders before it is promoted into a stronger claim.
