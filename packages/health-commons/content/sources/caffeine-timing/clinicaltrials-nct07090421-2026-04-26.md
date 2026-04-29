---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct07090421-2026-04-26
slug: sources/caffeine-timing/clinicaltrials-nct07090421-2026-04-26
title: 'Caffeine Dose: Performance and Recovery'
summary: Registry record for an interventional caffeine-dose performance and recovery study in trained male university rowers, comparing placebo with 3, 6, and 9 mg/kg evening caffeine and measuring rowing performance, sleep quality, and daytime sleepiness.
status: draft
quality: usable
aliases:
- 'Caffeine Dose: Performance and Recovery'
- source_artifact:clinicaltrials-nct07090421-2026-04-26
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: other
  title: 'Caffeine Dose: Performance and Recovery'
  authors: 'ClinicalTrials.gov; sponsor/investigator: Ulas Can YILDIRIM'
  year: 2026
  journal: ClinicalTrials.gov
  citation: 'ClinicalTrials.gov; sponsor/investigator: Ulas Can YILDIRIM. Caffeine Dose: Performance and Recovery. ClinicalTrials.gov. 2026. NCT07090421.'
  url: https://clinicaltrials.gov/study/NCT07090421
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: NCT07090421
    titleHash: 4088f6a56101945ffe2dca8aae9f647fcfbfadae2e9ba1fa76870ef9ba17c56a
    url: https://clinicaltrials.gov/study/NCT07090421
  canonicalUrl: https://clinicaltrials.gov/study/NCT07090421
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Trial registry record for randomized interventional crossover caffeine-dose study
  populationLabel: Trained male university rowers, per registry context.
  durationLabel: Four evening rowing test conditions with follow-up sleep quality and daytime alertness/sleepiness endpoints.
  aggregateRole: primary
  cohortKey: clinicaltrials-nct07090421-2026-04-26
  notes:
  - 'Intervention or exposure: Placebo and low-, moderate-, and high-dose evening caffeine conditions (3, 6, and 9 mg/kg) before rowing performance testing.'
  - 'Comparator or control: Placebo condition within the registry protocol.'
  - 'Endpoints: 2000-m rowing ergometer performance, power, heart rate, sleep quality, and daytime sleepiness/wakefulness scores.'
  - 'Effect or direction: Registry context only; do not use as completed efficacy evidence unless linked publication is separately extracted.'
  - 'Adverse events or safety notes: Registry endpoints include recovery/sleep tradeoff signals; adverse-event results were not extracted from the registry record alone.'
  - 'Population mismatch: Trained male rowers and evening performance testing, not a general 14-day caffeine curfew.'
  - 'Limitations: Registry record; may summarize planned or registered endpoints and status but is not a peer-reviewed completed study extraction by itself.'
evidenceBucket: daytime_function_performance
whyItMatters: Shows that evening caffeine dose-performance-recovery tradeoffs remain an active/recent research question with sleep and daytime sleepiness endpoints.
potentialMurphEndpoints:
- rowing performance
- sleep quality
- daytime sleepiness
- heart rate
- power output
protocolTakeaway: 'Context-only: useful for protocol landscape and endpoint design; not evidence that the caffeine-curfew dose reset works.'
murphTakeaway: 'Consider rower-style endpoint pairing: performance dose response plus sleep/recovery next day.'
studyDesign: rct
modality: trial registry / evening caffeine dose study
claimUse: context-only
sourceFindings:
- findingId: finding:clinicaltrials-nct07090421-2026-04-26-registry-endpoints
  sourceKey: source_artifact:clinicaltrials-nct07090421-2026-04-26
  extractedFromArtifactId: art_clinicaltrials_nct07090421_2026_04_26_html
  findingKind: context
  population: Trained male university rowers per registry context.
  exposure: Placebo, 3 mg/kg, 6 mg/kg, and 9 mg/kg evening caffeine conditions before rowing ergometer testing.
  outcome: Rowing performance, sleep quality, and daytime sleepiness/wakefulness endpoints.
  summary: The registry describes an interventional caffeine-dose study designed to balance rowing performance with recovery, sleep quality, and daytime alertness or sleepiness outcomes.
  evidenceUse:
  - context
  - adjacent_variant
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **daytime_function_performance**.

**Findings:** The registry describes an interventional caffeine-dose study designed to balance rowing performance with recovery, sleep quality, and daytime alertness or sleepiness outcomes.

**Why it matters:** Shows that evening caffeine dose-performance-recovery tradeoffs remain an active/recent research question with sleep and daytime sleepiness endpoints.

**Potential experiment signals:** rowing performance, sleep quality, daytime sleepiness, heart rate, power output.

**Protocol takeaway:** Context-only: useful for protocol landscape and endpoint design; not evidence that the caffeine-curfew dose reset works.

**Claim use:** `context-only`.
