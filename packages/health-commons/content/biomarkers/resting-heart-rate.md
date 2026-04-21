---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:resting-heart-rate
slug: biomarkers/resting-heart-rate
title: Resting Heart Rate
summary: A widely available resting pulse trend that can make short experiments easier to interpret, especially when compared against your own baseline.
status: field-testing
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
  -
    type: cites
    target: source_artifact:pmid-32814462
  -
    type: cites
    target: source_artifact:pmid-29269746
  -
    type: cites
    target: source_artifact:pmid-31331560
  -
    type: cites
    target: source_artifact:pmid-34622026
measurementContexts:
  - overnight_wearable
  - morning_resting_manual
unit: bpm
interpretationFrame:
  principle: Trend beats a single value, and baseline-versus-intervention averages are more useful than a dramatic one-off reading.
  caveat: Device windows, smoothing, illness, alcohol, travel, and hard training can all move resting heart rate.
---

Resting heart rate is a useful dry-sauna signal because it is available on most consumer wearables and easier to explain than composite recovery scores.

A useful read usually looks like this:

- compare a stable **7-day baseline average** against the **14-day intervention average**,
- keep exercise load, bedtime, alcohol, and illness notes visible,
- do not overreact to the morning after a stressful day or a poor night of sleep,
- prefer like-for-like device readings rather than mixing devices or measurement contexts.

Resting heart rate is not a complete picture of cardiovascular health. It is simply one of the cleanest consumer-facing markers for a first bounded self-experiment.
