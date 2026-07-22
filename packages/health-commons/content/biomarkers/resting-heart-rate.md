---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:resting-heart-rate
slug: biomarkers/resting-heart-rate
title: Resting Heart Rate
summary: "Resting heart rate measures how often the heart beats during quiet rest, which can reflect fitness, recovery, illness, medication effects, and other changes over time."
status: field-testing
quality: usable
aliases:
  - RHR
  - resting pulse
categories:
  - cardiovascular
  - recovery
  - wearable-metric
measurementContexts:
  - overnight_wearable
  - morning_resting_manual
unit: bpm
interpretationFrame:
  principle: Trend beats a single value, and baseline-versus-intervention averages are more useful than a dramatic one-off reading.
  caveat: Device windows, smoothing, illness, alcohol, travel, and hard training can all move resting heart rate.
biomarker:
  shortName: RHR
  displayName: Resting Heart Rate
  unit: bpm
  valuePrecision: 0
  direction:
    desired: lower_or_stable
    label: Lower can be better, but context matters.
    nuance: Illness, under-recovery, alcohol, travel, dehydration, medication changes, and device changes can all raise resting heart rate temporarily.
  privateMetricBindings:
    -
      source: metric
      metricKey: resting-heart-rate
      role: primary
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 30
    minimumPoints: 5
    aggregation: median
  explainerCards:

    -
      title: What it is
      body: Resting heart rate is your pulse when your body is at rest. It is a trend signal, not a one-morning verdict.
    -
      title: Why people care
      body: "Reflects aerobic fitness, recovery load, stress, illness, alcohol, sleep disruption, and whether an experiment adds strain."
    -
      title: How to read it
      body: "Typical adult range: 60-100 bpm; lower trends matter when sleep, recovery, and training load are stable."
    -
      title: What moves it
      body: "Cardio training, sleep, alcohol, heat, illness, hard training, travel, dehydration, medications, stress, and device changes."
  measurement:
    bestContext: Overnight wearable readings or a consistent quiet morning resting measurement are best for self-comparison.
    howToMeasure:
      - Use the same device or method when comparing before and after windows.
      - Prefer 7-to-30-day medians or averages over one-off readings.
      - Keep illness, alcohol, travel, hard training, poor sleep, and device changes visible as context.
    confounders:
      - illness
      - alcohol
      - travel
      - unusually hard training
      - poor sleep
      - dehydration
      - medication changes
      - device changes
relations:

  -
    type: related_protocol
    target: protocol_variant:norwegian-4x4/norwegian-4x4
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
  -
    type: related_protocol
    target: protocol_variant:evening-light-reduction/red-light-glasses-before-bed
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
communityOutcomeSummary:
  state: coming_soon
  minimumCohortSize: 20
  placeholder: Early outcome summaries will appear here once enough opted-in experiment runs are available.
referenceGuidance:
  classification: conditional_numeric
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: reference_interval
      guidance: "The American Heart Association describes 60 through 100 beats per minute as a typical resting range for most adults, while trained athletes, medications, illness, and rhythm conditions can shift what is expected."
      applicability: "Applies to a resting measurement under comparable conditions while age, fitness, illness, medications, rhythm, and measurement method are considered."
      numericValues:
        - label: "Typical resting adult interval"
          unit: "bpm"
          lowerBound:
            value: 60
            inclusive: true
          upperBound:
            value: 100
            inclusive: true
      source:
        title: "Target Heart Rates Chart"
        organization: "American Heart Association"
        year: 2024
        sourceType: "academic_reference"
        url: "https://www.heart.org/en/healthy-living/fitness/fitness-basics/target-heart-rates"
---

Resting heart rate is useful because it is available on most consumer wearables and easier to explain than composite recovery scores.

For self-experiments, a useful read usually looks like this:

- compare a stable **baseline window** against a clearly defined **intervention window**,
- keep exercise load, bedtime, alcohol, illness, and travel notes visible,
- do not overreact to the morning after a stressful day or a poor night of sleep,
- prefer like-for-like device readings rather than mixing devices or measurement contexts.

Resting heart rate is not a complete picture of cardiovascular health. It is one clean consumer-facing marker for a bounded self-experiment and one input into a broader health story.
