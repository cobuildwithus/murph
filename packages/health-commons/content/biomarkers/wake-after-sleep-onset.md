---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:wake-after-sleep-onset
slug: biomarkers/wake-after-sleep-onset
title: Wake After Sleep Onset
summary: The estimated total minutes awake after first falling asleep and before the final awakening, used as a repeated sleep-maintenance diary signal rather than a diagnostic or minute-perfect measure.
status: field-testing
quality: usable
aliases:
  - WASO
  - wake after sleep onset minutes
  - time awake during the night
  - middle of the night awake time
categories:
  - sleep
  - sleep-maintenance
  - sleep-diary
  - self-report
relations:
  - type: cites
    target: source_artifact:pmid-22294820
  - type: cites
    target: source_artifact:pmid-33164742
  - type: cites
    target: source_artifact:pmid-29734997
  - type: cites
    target: source_artifact:pmid-28162150
  - type: cites
    target: source_artifact:pmid-26414989
measurementContexts:
  - morning_self_report
  - sleep_diary
  - wearable_context
unit: minutes
interpretationFrame:
  principle: Compare repeated same-person morning estimates across several nights and interpret them beside sleep quality and daytime function.
  caveat: Clock checking, uncertain memory, quiet wakefulness, device algorithms, pain, illness, alcohol, stress, and environmental interruptions can move the estimate.
biomarker:
  shortName: WASO
  displayName: Wake After Sleep Onset
  unit: minutes
  valuePrecision: 0
  privateMetricBindings:
    - source: metric
      metricKey: wake-after-sleep-onset
      role: primary
      unit: minutes
  direction:
    desired: lower_or_stable
    label: Lower or stable awake time can be useful when sleep opportunity and daytime function are preserved.
    nuance: Do not optimize a single-night number or treat zero as a universal target; the lived impact and the cause of waking matter more.
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 7
    minimumPoints: 3
    aggregation: median
  measurement:
    bestContext: Record one rough total soon after waking, without repeatedly checking the clock overnight.
    howToMeasure:
      - Estimate the total minutes awake after first falling asleep and before the final awakening; keep time spent awake after the final awakening separate.
      - Use the same diary wording and rough-estimation method across the comparison window.
      - Pair the estimate with remembered awakenings, subjective sleep quality, daytime sleepiness, and a brief disruption note.
      - Keep wearable awake-time estimates separate as context when they disagree with lived experience.
    confounders:
      - clock checking
      - uncertain recall
      - device changes
      - pain or illness
      - alcohol
      - stress
      - nocturia
      - partner or caregiving interruption
      - noise or temperature
communityOutcomeSummary:
  state: insufficient_data
  minimumCohortSize: 30
  placeholder: No comparable community outcome is available yet for wake after sleep onset.
---

Wake after sleep onset (WASO) is the estimated total time spent awake after initially falling asleep and before the final awakening. Time spent awake after the final awakening is a separate terminal-wakefulness or early-waking signal. Keeping those measures separate helps distinguish sleep-maintenance and early-waking problems from trouble falling asleep at the beginning of the night.

The useful signal is a repeated personal pattern, especially when it moves with sleep quality or daytime function. A consumer wearable can support the diary, but it may misclassify motionless wakefulness and should not be used to rule out a sleep disorder.

Persistent or impairing awakenings, dangerous daytime sleepiness, drowsy driving, witnessed breathing pauses or gasping, or unusual nighttime behaviors belong in a clinical conversation rather than an outcome score alone.
