---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct04514640-2026-04-27
slug: sources/pre-sleep-downshift-practices/clinicaltrials-nct04514640-2026-04-27
title: Calm + Oura Sleep Study
summary: "Trial-registry context for Calm + Oura Sleep Study; included for source identity, protocol details, endpoint planning, and claim-boundary tracking, not direct silent-bedtime efficacy."
status: draft
quality: usable
aliases:
  - A Quasi-experimental Study Testing a Mindfulness Meditation Mobile App on Sleep and Neurophysiological Outcomes Using the Oura Ring
  - NCT04514640
categories:
  - pre-sleep-downshift-practices
relations:

  -
    type: related_protocol
    target: protocol_variant:pre-sleep-downshift-practices/pre-sleep-silent-meditation
  -
    type: parent_family
    target: experiment_family:pre-sleep-downshift-practices
source:
  kind: other
  title: A Quasi-experimental Study Testing a Mindfulness Meditation Mobile App on Sleep and Neurophysiological Outcomes Using the Oura Ring
  authors: ClinicalTrials.gov
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. A Quasi-experimental Study Testing a Mindfulness Meditation Mobile App on Sleep and Neurophysiological Outcomes Using the Oura Ring. Identifier NCT04514640. Snapshot source key dated 2026-04-27.
  url: https://clinicaltrials.gov/study/nct04514640
sourceKind: trial_registry
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: nct04514640
    titleHash: 2c6a55660205535612a56b216e54f125db3921133aa649a160318bc0969620e2
    url: https://clinicaltrials.gov/study/nct04514640
  canonicalUrl: https://clinicaltrials.gov/study/nct04514640
researchEvidence:
  designKind: expert_protocol
  designLabel: Completed quasi-experimental app-plus-wearable registry record with randomized content arms
  participantCount: 72
  participantCountKind: reported
  populationLabel: Adult Calm/Oura employees in a convenience sample.
  durationLabel: 2-week baseline plus 4-week daily app intervention with continuous Oura and sleep-diary collection.
  aggregateRole: primary
  cohortKey: cohort-clinicaltrials-nct04514640-2026-04-27
  notes:
    - "Registry status: Completed."
    - "Directness to target protocol: adjacent_variant."
    - "Claim-use boundary: context-only."
    - No direct silent/unguided bedtime-only protocol claim should be derived from this source unless separately verified.
    - "Original extracted designKind: quasi_experimental_registry."
evidenceBucket: trial_registries_and_unresolved_protocols
whyItMatters: "This is timing-close for bedtime app-guided meditation and provides objective Oura endpoint context, while clearly separating guided app content from silent practice."
potentialMurphEndpoints:
  - sleep-onset latency
  - sleep efficiency
  - total sleep time
  - deep sleep minutes
  - nighttime awakenings
  - HRV
  - resting heart rate
  - pre-sleep arousal
  - fatigue/daytime sleepiness
protocolTakeaway: Use for adjacent app-guided/wearable measurement context only; do not treat bedtime Calm meditation or Sleep Stories as silent unguided meditation evidence.
murphTakeaway: "The record helps map 10-minute bedtime dose and wearable signals, but commercial app guidance and employee sampling are major boundaries."
studyDesign: Completed quasi-experimental registry record with randomized active app-content arms and no registry results posted.
modality: App-guided mindfulness and sleep-content variants paired with a consumer wearable.
directnessToProtocol: adjacent_variant
claimUse: context-only
limitations:
  - Convenience sample of Calm/Oura employees.
  - No registry-posted results in the extracted payload.
  - No no-treatment arm; arms compare active app content/timing variants.
  - "Guided app meditations and Sleep Stories are adjacent variants, not silent meditation."
populationMismatch: Employees/healthy volunteers rather than clinical or general public sample; commercial app-guided content rather than silent self-directed practice.
interventionOrExposure: "Calm app use once daily for at least 10 minutes according to randomized assignment: daytime general meditation, bedtime sleep meditation, or bedtime Sleep Stories; Oura ring data collected before, during, and after meditations and nightly."
comparatorOrControl: Different active Calm content/timing arms; no no-treatment arm.
durationOrFollowUp: 2-week baseline followed by 4-week intervention; sleep diaries and Oura objective data collected daily for 6 weeks.
endpoints:
  - Pittsburgh Sleep Diaries
  - Pre-Sleep Arousal Survey
  - Fatigue Severity Scale
  - Epworth Sleepiness Scale
  - Insomnia Severity Index
  - Oura sleep onset
  - Oura sleep efficiency
  - nighttime awakenings
  - total sleep time
  - REM/light/deep sleep
  - heart rate
  - heart rate variability
  - respiratory rate
effectEstimatesOrDirection: No registry-posted comparative effect estimate was available in the extracted source payload.
adverseEventsOrSafetyNotes: No registry adverse-event results were posted in the extracted payload.
sourceFindings:

  -
    findingId: finding:clinicaltrials-nct04514640-2026-04-27/registry-context
    sourceKey: source_artifact:clinicaltrials-nct04514640-2026-04-27
    extractedFromArtifactId: art-clinicaltrials-nct04514640-2026-04-27
    findingKind: context
    population: Adult Calm or Oura employees; healthy volunteers accepted.
    exposure: "Calm app use once daily for at least 10 minutes according to randomized assignment: daytime general meditation, bedtime sleep meditation, or bedtime Sleep Stories; Oura ring data collected before, during, and after meditations and nightly."
    outcome: App-guided bedtime/daytime intervention arms and wearable sleep/neurophysiology endpoints.
    summary: "Registry record for 72 adult Calm/Oura employees randomized among daytime meditation, bedtime sleep meditation, and bedtime Sleep Stories for at least 10 minutes/day with Oura sleep and HRV endpoints; useful as adjacent app-guided measurement context, not silent meditation evidence."
    evidenceUse:
      - adjacent_variant
      - measurement
      - context
murphV1Priority: High
pdfRightsStatus: not_applicable_registry
---
This source is included for **trial_registries_and_unresolved_protocols**.

**Findings:** Registry record for 72 adult Calm/Oura employees randomized among daytime meditation, bedtime sleep meditation, and bedtime Sleep Stories for at least 10 minutes/day with Oura sleep and HRV endpoints; useful as adjacent app-guided measurement context, not silent meditation evidence.

**Why it matters:** This is timing-close for bedtime app-guided meditation and provides objective Oura endpoint context, while clearly separating guided app content from silent practice.

**Potential experiment signals:** sleep-onset latency, sleep efficiency, total sleep time, deep sleep minutes, nighttime awakenings, HRV, resting heart rate, pre-sleep arousal, fatigue/daytime sleepiness.

**Protocol takeaway:** Use for adjacent app-guided/wearable measurement context only; do not treat bedtime Calm meditation or Sleep Stories as silent unguided meditation evidence.

**Claim use:** `context-only`.
