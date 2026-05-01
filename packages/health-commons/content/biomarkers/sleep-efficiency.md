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
biomarker:
  unit: percent
  direction:
    desired: higher_or_stable
    label: Higher or stable can be better when time in bed and schedule are consistent.
    nuance: Wearables can misclassify quiet wakefulness, and sleep efficiency can rise for the wrong reason if time in bed is cut too aggressively.
---

Sleep efficiency can be a useful secondary signal for experiments that may change relaxation, thermoregulation, or recovery.

For the dry-sauna protocol, treat sleep efficiency as **context**, not as a guaranteed mechanism. If it moves in the expected direction alongside better subjective sleep or lower resting heart rate, that can strengthen the personal story. If it does not move, the protocol may still be useful.
