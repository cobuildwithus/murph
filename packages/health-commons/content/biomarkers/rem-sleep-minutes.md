---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:rem-sleep-minutes
slug: biomarkers/rem-sleep-minutes
title: REM Sleep Minutes
summary: A wearable-estimated REM-stage duration signal best treated as sleep-architecture context; useful for personal trends, too noisy to treat as a standalone nightly score.
status: field-testing
quality: usable
aliases:
  - REM sleep
  - rapid eye movement sleep
  - REM duration
  - REM minutes
categories:
  - sleep
  - wearable-metric
  - sleep-architecture
measurementContexts:
  - overnight_wearable
  - polysomnography
  - sleep_diary_context
unit: minutes
interpretationFrame:
  principle: Treat REM minutes as a trend-with-context marker, not a target to maximize every night.
  caveat: Consumer devices infer REM from movement, heart-rate, and related sensor patterns; validation studies show useful sleep/wake detection but substantially weaker agreement for stage totals such as REM.
biomarker:
  shortName: REM
  displayName: REM Sleep Minutes
  unit: minutes
  valuePrecision: 0
  direction:
    desired: mixed_or_contextual
    label: Enough REM opportunity matters; more is not automatically better.
    nuance: REM is concentrated later in the night, so low REM often reflects curtailed sleep, early wake time, fragmentation, alcohol, medications, sleep apnea, circadian disruption, or device classification changes rather than a simple deficit to hack.
  privateMetricBindings:

    -
      source: browser_vault_metric
      domain: sleep
      metric: remMinutes
      unit: minutes
      preferred: true
    -
      source: browser_vault_signal_summary
      accessor: sleep.remMinutes
      unit: minutes
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 30
    minimumPoints: 5
    aggregation: median
  explainerCards:

    -
      title: What it is
      body: REM sleep is a recurring sleep stage marked in the lab by rapid eye movements, low muscle tone, and an activated EEG pattern. Consumer wearables usually report an inferred REM duration for each sleep episode.
    -
      title: Why people care
      body: REM is tied to dreaming, emotion processing, memory-related physiology, and autonomic changes. Cohort studies link lower PSG-measured REM percentage with adverse outcomes, but those findings are associations, not proof that chasing a higher wearable REM number improves health.
    -
      title: How to read it
      body: Read REM alongside total sleep time, sleep efficiency, awakenings, bedtime, wake time, and subjective sleep quality. A stable multi-night shift is more meaningful than a single low or high REM night.
    -
      title: What moves it
      body: Short sleep opportunity, early alarms, alcohol, some medications, sleep apnea, CPAP initiation, withdrawal from REM-suppressing substances, stress, circadian disruption, illness, and device algorithm changes can all move the number.
  measurement:
    bestContext: Use the same wearable across a baseline and intervention window, preferably with at least a week of nights and notes on sleep opportunity, alcohol, medications, travel, illness, and sleep-disordered-breathing context.
    howToMeasure:
      - Keep the same device, firmware family, and dominant sleep record source when comparing baseline to intervention windows.
      - Prefer 7-to-30-day medians over one-night values because REM is later-night weighted and sensitive to fragmentation.
      - Interpret REM minutes together with total sleep minutes and REM percent; a higher REM total after simply sleeping longer is different from a cleaner sleep-architecture shift.
      - Flag nights with alcohol, unusual medication changes, cannabis or sedative changes, CPAP changes, illness, travel, shift work, naps, or very early alarms.
      - Treat persistent very low REM, dream-enactment behavior, severe snoring, witnessed apneas, or disabling sleepiness as reasons to discuss clinical sleep evaluation rather than self-optimizing from wearable data.
    confounders:
      - short sleep opportunity
      - early alarm
      - alcohol
      - cannabis or substance withdrawal
      - antidepressants or REM-suppressing medications
      - sleep apnea or breathing disruption
      - CPAP initiation
      - stress
      - circadian misalignment
      - travel or jet lag
      - illness or fever
      - fragmented sleep
      - naps
      - device or algorithm change
relations:

  -
    type: related_protocol
    target: protocol_variant:evening-light-reduction/red-light-glasses-before-bed
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
  -
    type: related_protocol
    target: protocol_variant:norwegian-4x4/norwegian-4x4
  -
    type: cites
    target: source_artifact:aasm-scoring-manual-v3
  -
    type: cites
    target: source_artifact:ncbi-sleep-physiology-rem
  -
    type: cites
    target: source_artifact:pmid-33378539
  -
    type: cites
    target: source_artifact:pmid-37917155
  -
    type: cites
    target: source_artifact:pmid-38276327
  -
    type: cites
    target: source_artifact:pmid-39460013
  -
    type: cites
    target: source_artifact:pmid-32628261
  -
    type: cites
    target: source_artifact:doi-10.3389-fcvm.2022.771280
protocolRanking:
  version: deterministic-v0
  scoreFormula: evidenceWeight * 3 + biomarkerRelevance * 3 + wearableMeasurability * 2 - burdenPenalty - safetyCautionPenalty + communityOutcomeConfidence
  candidates:

    -
      protocolKey: protocol_variant:evening-light-reduction/red-light-glasses-before-bed
      expectedDirection: up_or_stable
      relationship: secondary_biomarker
      mechanism: Evening light reduction may improve circadian timing and sleep opportunity. REM is later-night weighted, so the most plausible benefit is indirect; more consistent bedtime, fewer late-night light delays, or less curtailed final-cycle sleep.
      scoring:
        evidenceWeight: 3
        biomarkerRelevance: 3
        wearableMeasurability: 5
        burdenPenalty: 1
        safetyCautionPenalty: 1
      display:
        confidence: medium
        burdenLabel: Low
        cautionLabel: Low
    -
      protocolKey: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
      expectedDirection: mixed_or_contextual
      relationship: secondary_biomarker
      mechanism: Heat exposure may change relaxation, thermoregulation, and sleep continuity for some people, but REM minutes are not the direct target and can move in either direction if total sleep, wake time, or fragmentation changes.
      scoring:
        evidenceWeight: 2
        biomarkerRelevance: 2
        wearableMeasurability: 5
        burdenPenalty: 2
        safetyCautionPenalty: 2
      display:
        confidence: low
        burdenLabel: Moderate
        cautionLabel: Moderate
    -
      protocolKey: protocol_variant:norwegian-4x4/norwegian-4x4
      expectedDirection: mixed_or_contextual
      relationship: related_protocol
      mechanism: High-intensity training may support sleep through fitness and stress regulation when recovery is adequate, but it can also suppress or fragment sleep when dose, timing, or fatigue are poorly matched. Use REM as a recovery-context signal, not the success metric.
      scoring:
        evidenceWeight: 2
        biomarkerRelevance: 1
        wearableMeasurability: 5
        burdenPenalty: 4
        safetyCautionPenalty: 3
      display:
        confidence: low
        burdenLabel: High
        cautionLabel: Higher
communityOutcomeSummary:
  state: coming_soon
  minimumCohortSize: 20
  placeholder: Early Murph outcome summaries will appear here once enough opted-in runs include consistent REM sleep estimates and contextual sleep notes.
---

REM sleep minutes are useful because they give a simple view of one part of sleep architecture that many people already see in their wearable dashboards.

Murph should keep this marker intentionally conservative. REM is biologically real when scored from polysomnography, but consumer devices infer it. The practical question is not “did I maximize REM last night?” The better question is whether an intervention produced a repeatable, context-aware change in REM opportunity without worsening total sleep, sleep continuity, recovery, or daytime function.

A useful REM read usually looks like this:

- compare a stable **baseline window** against a clearly defined **intervention window**,
- keep total sleep time and wake time visible because REM tends to be concentrated later in the sleep episode,
- flag alcohol, medication changes, CPAP changes, travel, illness, unusual stress, and very early alarms,
- avoid treating a single low-REM night as failure or a single high-REM night as success,
- escalate possible clinical patterns — dream enactment, severe snoring, witnessed apneas, or persistent disabling sleepiness — to proper sleep evaluation.

For Murph experiments, REM should usually be a **secondary context marker**. It can strengthen a sleep story when it moves alongside better sleep duration, efficiency, subjective restfulness, and daytime function, but it should not carry the whole verdict by itself.
