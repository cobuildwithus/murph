---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:resting-heart-rate
slug: biomarkers/resting-heart-rate
title: Resting Heart Rate
summary: How many times the heart beats per minute at full rest, where a lower count usually means the heart pumps more blood per beat and needs fewer contractions to do the same job.
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
      source: browser_vault_metric
      domain: recovery
      metric: restingHeartRate
      unit: bpm
      preferred: true
    -
      source: browser_vault_signal_summary
      accessor: recovery.restingHeartRate
      unit: bpm
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 30
    minimumPoints: 5
    aggregation: median
  explainerCards:

    -
      title: What it is
      body: Resting heart rate is your pulse when your body is at rest. Murph treats it as a trend signal, not a one-morning verdict.
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
protocolRanking:
  version: deterministic-v0
  scoreFormula: evidenceWeight * 3 + biomarkerRelevance * 3 + wearableMeasurability * 2 - burdenPenalty - safetyCautionPenalty + communityOutcomeConfidence
  candidates:

    -
      protocolKey: protocol_variant:norwegian-4x4/norwegian-4x4
      expectedDirection: down
      relationship: primary_biomarker
      mechanism: Aerobic adaptation is the clearest overall route to a lower resting pulse over time, though under-recovery can temporarily push RHR up.
      scoring:
        evidenceWeight: 5
        biomarkerRelevance: 5
        wearableMeasurability: 5
        burdenPenalty: 4
        safetyCautionPenalty: 3
      display:
        confidence: high
        burdenLabel: High
        cautionLabel: Higher
    -
      protocolKey: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
      expectedDirection: down_or_stable
      relationship: secondary_biomarker
      mechanism: Repeated heat exposure can train cardiovascular and recovery responses, but RHR is more context-sensitive here than with direct aerobic training.
      scoring:
        evidenceWeight: 3
        biomarkerRelevance: 4
        wearableMeasurability: 5
        burdenPenalty: 2
        safetyCautionPenalty: 2
      display:
        confidence: medium
        burdenLabel: Moderate
        cautionLabel: Moderate
    -
      protocolKey: protocol_variant:evening-light-reduction/red-light-glasses-before-bed
      expectedDirection: mixed_or_contextual
      relationship: secondary_biomarker
      mechanism: Evening light reduction may indirectly lower overnight strain if sleep timing or sleep quality improves, but RHR is not the primary endpoint.
      scoring:
        evidenceWeight: 2
        biomarkerRelevance: 2
        wearableMeasurability: 5
        burdenPenalty: 1
        safetyCautionPenalty: 1
      display:
        confidence: low
        burdenLabel: Low
        cautionLabel: Low
communityOutcomeSummary:
  state: coming_soon
  minimumCohortSize: 20
  placeholder: Early Murph outcome summaries will appear here once enough opted-in experiment runs are available.
---

Resting heart rate is useful because it is available on most consumer wearables and easier to explain than composite recovery scores.

For Murph experiments, a useful read usually looks like this:

- compare a stable **baseline window** against a clearly defined **intervention window**,
- keep exercise load, bedtime, alcohol, illness, and travel notes visible,
- do not overreact to the morning after a stressful day or a poor night of sleep,
- prefer like-for-like device readings rather than mixing devices or measurement contexts.

Resting heart rate is not a complete picture of cardiovascular health. It is one clean consumer-facing marker for a bounded self-experiment and one input into a broader health story.
