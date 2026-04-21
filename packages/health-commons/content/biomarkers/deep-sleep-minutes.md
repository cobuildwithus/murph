---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:deep-sleep-minutes
slug: biomarkers/deep-sleep-minutes
title: Deep Sleep Minutes
summary: A wearable-estimated sleep-stage marker that can be interesting, but is less reliable than broad sleep duration or continuity trends.
status: draft
quality: usable
aliases:
  - deep sleep
categories:
  - sleep
  - wearable-metric
relations:
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
measurementContexts:
  - overnight_wearable
unit: minutes
interpretationFrame:
  principle: Treat stage estimates as directional context, not exact physiology.
  caveat: Consumer wearables infer sleep stages and can disagree with one another.
---

Deep sleep minutes can be useful context, but they should not carry the whole verdict on whether a dry-sauna experiment worked.

If a strong deep-sleep signal repeats alongside other useful changes, it is worth noting. Broader sleep continuity and cardiovascular signals should still carry more weight.
