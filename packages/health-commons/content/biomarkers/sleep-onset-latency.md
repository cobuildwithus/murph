---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:sleep-onset-latency
slug: biomarkers/sleep-onset-latency
title: Sleep Onset Latency
summary: A sleep-onset marker estimating how long it takes to fall asleep after attempting sleep, best interpreted as a trend with diary context rather than a perfect wearable truth.
status: draft
quality: usable
aliases:
  - SOL
  - time to fall asleep
  - sleep latency
categories:
  - sleep
  - wearable-metric
relations:

  -
    type: related_protocol
    target: protocol_variant:evening-light-reduction/red-light-glasses-before-bed
measurementContexts:
  - overnight_wearable
  - sleep_diary
unit: minutes
interpretationFrame:
  principle: Compare repeated baseline and intervention windows rather than one-night changes.
  caveat: Wearables and actigraphy can misclassify quiet wakefulness, reading in bed, meditation, alcohol-related sleep fragmentation, and irregular bedtimes.
biomarker:
  unit: minutes
  direction:
    desired: lower_or_stable
    label: Lower or stable can be better when bedtime and wake time stay consistent.
    nuance: Reading, meditation, alcohol, irregular schedules, and wearable sleep/wake classification can make latency look better or worse than it felt.
---

Sleep onset latency is the practical signal for red-light glasses before bed because the experiment is meant to change the last part of the evening, not the entire sleep architecture.

For personal experiments, pair any wearable estimate with a one-tap subjective estimate. The useful question is whether falling asleep felt easier often enough to be worth repeating.
