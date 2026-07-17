---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:pre-sleep-arousal
slug: biomarkers/pre-sleep-arousal
title: Pre-Sleep Arousal
summary: A manual subjective rating of how wired, keyed-up, panicky, or cognitively activated someone feels before sleep.
status: draft
quality: usable
aliases:
  - bedtime arousal
  - pre-bed arousal
  - cognitive arousal before sleep
  - feeling wired before sleep
categories:
  - sleep
  - pre-sleep
  - manual-measurement
  - subjective-rating
relations:
  -
    type: cites
    target: source_artifact:pmid-4004706
  -
    type: related_protocol
    target: protocol_variant:pre-sleep-downshift-practices/pre-sleep-resonance-breathing-and-meditation
measurementContexts:
  - evening_self_report
  - pre_sleep_log
unit: score
interpretationFrame:
  principle: Compare the same same-person rating setup across baseline and intervention nights rather than interpreting one score.
  caveat: This lightweight single-item 0-to-10 rating is not the validated 16-item Pre-Sleep Arousal Scale and has no diagnostic cutoff. Ratings are sensitive to stress, caffeine, alcohol, bedtime pressure, symptoms, sleep tracking anxiety, and the exact wording of the prompt.
biomarker:
  shortName: Pre-Sleep Arousal
  displayName: Pre-Sleep Arousal
  unit: score
  valuePrecision: 0
  direction:
    desired: lower
    label: Lower usually means less subjective activation before sleep.
    nuance: Interpret alongside sleep-onset estimates, next-day functioning, distress, and safety symptoms.
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 7
    minimumPoints: 3
    aggregation: median
  measurement:
    bestContext: Same-person evening log completed before lights-out or immediately after the pre-sleep routine.
    howToMeasure:
      - Choose a simple 0-to-10 rating before baseline and keep the wording fixed.
      - Record the rating near the same pre-bed point each night, before checking sleep scores the next morning.
      - Keep major confounders visible, including caffeine timing, alcohol, late exercise, bright screens, unusual stress, and medication changes.
    confounders:
      - acute stress
      - caffeine timing
      - alcohol
      - late exercise
      - bright screens
      - bedtime pressure
      - pain or illness
      - sleep-tracking anxiety
communityOutcomeSummary:
  state: coming_soon
  minimumCohortSize: 20
  placeholder: Community summaries will appear once enough opted-in pre-sleep downshift runs use a comparable rating scale.
---

A manual subjective rating of how wired, keyed-up, panicky, or cognitively activated someone feels before sleep. Murph uses a lightweight single-item rating for repeated same-person comparison; it is not the validated multi-item Pre-Sleep Arousal Scale and should not be used diagnostically or compared against a population cutoff.
