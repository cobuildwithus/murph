---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:deep-sleep-minutes
slug: biomarkers/deep-sleep-minutes
title: Deep Sleep
summary: Time spent in slow-wave sleep each night, where the brain's deepest electrical slowdown drives growth-hormone release, tissue repair, and waste clearance that lighter stages do not match.
status: field-testing
quality: usable
aliases:
  - deep sleep
  - slow-wave sleep
  - SWS
  - N3 sleep
  - delta sleep
  - deep sleep duration
categories:
  - sleep
  - recovery
  - sleep-architecture
  - wearable-metric
measurementContexts:
  - overnight_wearable
  - polysomnography_eeg
  - sleep_diary_context
unit: minutes
interpretationFrame:
  principle: Treat deep sleep minutes as a directional, low-confidence wearable sleep-stage trend and only promote it when it agrees with sleep duration, sleep efficiency, wake-after-sleep-onset, subjective restoration, and confounder notes.
  caveat: Wrist and finger wearables infer N3 without scalp EEG; deep sleep can be misclassified, especially with fragmented sleep, illness, alcohol, age-related EEG-amplitude changes, sleep apnea, or device changes.
biomarker:
  shortName: Deep sleep
  displayName: Deep Sleep
  unit: minutes
  valuePrecision: 0
  direction:
    desired: higher_or_stable
    label: More can be useful, but stable sufficient deep sleep alongside good continuity is the target.
    nuance: Do not chase deep sleep minutes at the expense of total sleep, regular timing, or feeling restored. A higher number from a wearable is not automatically a healthier night.
  privateMetricBindings:

    -
      source: browser_vault_metric
      domain: sleep
      metric: deepMinutes
      unit: minutes
      preferred: true
    -
      source: browser_vault_signal_summary
      accessor: sleep.deepMinutes
      unit: minutes
  trendDefaults:
    latestWindowDays: 14
    comparisonWindowDays: 30
    minimumPoints: 7
    aggregation: median
  explainerCards:

    -
      title: What it is
      body: Deep sleep minutes are a device's estimate of time spent in N3 / slow-wave sleep, the EEG-defined non-REM stage dominated by slow waves.
    -
      title: Why people care
      body: Slow-wave sleep is linked to sleep depth, memory and learning biology, cardiometabolic physiology, and emerging glymphatic-clearance hypotheses, but those links do not make a consumer stage estimate diagnostic.
    -
      title: How to read it
      body: Compare your own repeated windows on the same device. A useful signal is a persistent 14-to-30-day shift that travels with better sleep continuity or subjective restoration.
    -
      title: What moves it
      body: Total sleep opportunity, earlier-night sleep, alcohol, illness, sleep apnea, fragmented sleep, late caffeine, late intense exercise, heat timing, stress, age, and device algorithms can all move the number.
  measurement:
    bestContext: Same-device overnight wearable data is best for self-tracking; polysomnography with EEG is the reference method when a clinical sleep question needs an answer.
    howToMeasure:
      - Use the same wearable and algorithm version when comparing baseline and intervention windows.
      - Prefer 14-day medians against a prior 30-day baseline; ignore one-night spikes unless they repeat.
      - Read deep sleep beside total sleep time, sleep efficiency, awakenings, wake-after-sleep-onset, timing regularity, and subjective restoration.
      - Tag confounders such as alcohol, illness, hard training, sauna or hot-bath timing, late caffeine, travel, device changes, and possible sleep apnea symptoms.
      - Escalate to clinical sleep testing rather than wearable-stage chasing when low deep sleep is paired with excessive sleepiness, loud snoring, witnessed apneas, insomnia, parasomnias, or safety-sensitive fatigue.
    confounders:
      - alcohol
      - illness
      - sleep apnea symptoms
      - fragmented sleep
      - short sleep opportunity
      - irregular bedtime
      - late caffeine
      - late intense exercise
      - sauna or hot-bath timing
      - travel
      - stress
      - age
      - naps
      - device or algorithm changes
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
    target: source_artifact:doi-10.1093-sleep-zsaf063
  -
    type: cites
    target: source_artifact:pmid-21876072
  -
    type: cites
    target: source_artifact:pmid-29087522
  -
    type: cites
    target: source_artifact:pmid-37917155-deep-sleep
  -
    type: cites
    target: source_artifact:pmid-39460013-deep-sleep
  -
    type: cites
    target: source_artifact:doi-10.1038-s41598-025-93774-z
  -
    type: cites
    target: source_artifact:pmid-41325105
claims:

  -
    claimId: n3-eeg-definition
    type: evidence_scope
    text: Laboratory N3 / slow-wave sleep is an EEG-scored state, not a direct wrist or ring measurement; wearables estimate it from proxies such as movement, heart rate, heart-rate variability, temperature, and proprietary algorithms.
    strength: high
    sourceKeys:
      - source_artifact:doi-10.1093-sleep-zsaf063
    caveats:
      - AASM-style stage labels are 30-second epoch summaries; they simplify continuous sleep-depth physiology.
      - Age, sex, electrode placement, and EEG amplitude thresholds can change how N3 is scored even in laboratory data.
  -
    claimId: wearable-stage-noise
    type: design_guardrail
    text: Consumer wearables often detect sleep versus wake better than they classify specific stages, so Murph should treat deep sleep minutes as trend context rather than a clinical endpoint.
    strength: high
    sourceKeys:
      - source_artifact:pmid-37917155-deep-sleep
      - source_artifact:pmid-39460013-deep-sleep
      - source_artifact:doi-10.1038-s41598-025-93774-z
    caveats:
      - Some devices perform better in healthy-lab samples than in clinical or fragmented-sleep populations.
      - Algorithm updates can change apparent trends without physiology changing.
  -
    claimId: blood-pressure-association
    type: association_not_causation
    text: Prospective cohort evidence links lower slow-wave sleep with higher incident hypertension risk, but this does not prove that deliberately increasing a wearable deep-sleep score lowers blood pressure.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-21876072
      - source_artifact:pmid-29087522
    caveats:
      - Cohort associations can be confounded by age, sleep apnea, total sleep time, cardiometabolic risk, medications, and sleep fragmentation.
      - For a self-test, morning blood pressure and resting heart rate are stronger primary endpoints than wearable deep-sleep minutes.
  -
    claimId: glymphatic-hypothesis-boundary
    type: mechanistic
    text: NREM slow-wave physiology is a plausible part of brain-restoration and glymphatic-clearance biology, but current human methods are not strong enough to infer glymphatic clearance from consumer deep-sleep minutes.
    strength: low
    sourceKeys:
      - source_artifact:pmid-41325105
    caveats:
      - Glymphatic clearance is an active research area with rodent, imaging, and physiology evidence; it is not a consumer-wearable biomarker.
      - Subjective restoration can diverge from EEG-defined slow-wave activity.
  -
    claimId: interpret-with-broader-sleep
    type: design_guardrail
    text: A deep-sleep trend is most actionable when it is consistent with broader sleep markers and the person's notes; isolated stage changes should not drive protocol conclusions.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-37917155-deep-sleep
      - source_artifact:doi-10.1038-s41598-025-93774-z
    caveats:
      - Prioritize total sleep time, sleep efficiency, bedtime regularity, wake-after-sleep-onset, and next-day functioning when these disagree with the stage estimate.
protocolRanking:
  version: deterministic-v0
  scoreFormula: evidenceWeight * 3 + biomarkerRelevance * 3 + wearableMeasurability * 2 - burdenPenalty - safetyCautionPenalty + communityOutcomeConfidence
  candidates:

    -
      protocolKey: protocol_variant:evening-light-reduction/red-light-glasses-before-bed
      expectedDirection: up_or_stable
      relationship: secondary_biomarker
      mechanism: Evening light reduction may indirectly support earlier, less-fragmented sleep. Because N3 tends to be concentrated earlier in the night, timing and continuity improvements may show up as a better deep-sleep trend, but the wearable stage itself remains noisy.
      scoring:
        evidenceWeight: 3
        biomarkerRelevance: 3
        wearableMeasurability: 3
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
      mechanism: A well-timed heat-and-cool-down routine may improve relaxation and sleep continuity for some people, while sessions that are too hot, too late, dehydrating, or poorly tolerated can worsen sleep. Track deep sleep only as a secondary signal.
      scoring:
        evidenceWeight: 2
        biomarkerRelevance: 2
        wearableMeasurability: 3
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
      mechanism: Regular exercise can improve sleep health overall, but high-intensity work can acutely disrupt sleep when scheduled late or layered onto under-recovery. Use deep sleep as context beside RHR, HRV, total sleep, and training load.
      scoring:
        evidenceWeight: 3
        biomarkerRelevance: 2
        wearableMeasurability: 3
        burdenPenalty: 4
        safetyCautionPenalty: 3
      display:
        confidence: low
        burdenLabel: High
        cautionLabel: Higher
communityOutcomeSummary:
  state: coming_soon
  minimumCohortSize: 30
  placeholder: Early Murph outcome summaries for deep sleep will appear once enough opted-in runs have same-device sleep-stage data and privacy thresholds are met.
---

Deep sleep minutes are useful only when Murph keeps the measurement boundary clear: this page is about a **consumer-wearable estimate** of N3 / slow-wave sleep duration, not a direct laboratory measurement of slow-wave activity or glymphatic clearance.

## Bottom line

Use deep sleep minutes as a **secondary sleep architecture signal**. It can make a self-experiment more interesting when the trend repeats across many nights, but it should not override the broader sleep story. A strong read needs agreement across total sleep time, sleep efficiency, wake-after-sleep-onset, bedtime regularity, subjective restoration, and relevant confounder notes.

## Why Murph includes it

People ask about deep sleep because it feels intuitive: the number appears on many devices, and the underlying N3 / slow-wave literature is tied to sleep depth, memory and learning biology, blood-pressure associations, and brain-restoration hypotheses. Murph can support that curiosity while preventing overclaiming.

## Measurement hierarchy

1. **Clinical question:** use polysomnography or clinician-directed sleep testing.
2. **Personal trend question:** use the same wearable, same finger or wrist placement, same device family, and same algorithm window.
3. **Protocol verdict:** treat the deep-sleep number as secondary. Prefer outcomes that are less algorithm-dependent, such as total sleep, sleep efficiency, morning blood pressure, resting heart rate, HRV trend, and next-day functioning.

## What makes a trend convincing

A deep-sleep change is more credible when it persists across a 14-day median, is compared with at least a 30-day baseline, does not coincide with a device change, and is accompanied by fewer awakenings or better next-day restoration. It is less credible when it appears after alcohol, illness, travel, a late workout, a late sauna or hot bath, short sleep opportunity, or a device/algorithm update.

## Safety and escalation

Do not use this page to self-diagnose a sleep disorder. Persistent low deep sleep paired with excessive daytime sleepiness, loud snoring, witnessed apneas, insomnia, parasomnias, morning headaches, resistant hypertension, or safety-sensitive fatigue is a reason to seek clinical sleep guidance rather than optimize a wearable stage chart.
