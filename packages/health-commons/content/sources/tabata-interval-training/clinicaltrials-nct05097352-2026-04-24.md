---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct05097352-2026-04-24
slug: sources/tabata-interval-training/clinicaltrials-nct05097352-2026-04-24
title: Effects of a Short-term Exercise Intervention on Sleep in Women Exposed to Trauma: A Randomized Controlled Trial
summary: ClinicalTrials.gov registry context for a supervised HIIT trial in women exposed to trauma, included only as a recovery and stress-sensitive-population safety boundary; it is not Tabata 20/10 evidence.
status: draft
quality: usable
aliases:
  - NCT05097352
  - HIIT sleep trauma trial
categories:
  - tabata-interval-training
relations:
  -
    type: related_protocol
    target: protocol_variant:tabata-interval-training/tabata-20-10-interval-training
  -
    type: parent_family
    target: experiment_family:tabata-interval-training
canonicalMetadata:
  canonicalIdBasis: url
  url: https://clinicaltrials.gov/study/NCT05097352
  sourceKind: trial_registry
sourceKind: trial_registry
source:
  kind: other
  title: Effects of a Short-term Exercise Intervention on Sleep in Women Exposed to Trauma: A Randomized Controlled Trial
  authors: University of Georgia / ClinicalTrials.gov record
  year: 2021
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT05097352
  citation: ClinicalTrials.gov. Effects of a Short-term Exercise Intervention on Sleep in Women Exposed to Trauma: A Randomized Controlled Trial. NCT05097352. Accessed April 24, 2026. https://clinicaltrials.gov/study/NCT05097352.
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Trial registry record for short-term HIIT versus waitlist
  populationLabel: Women exposed to trauma
  durationLabel: Six-week short-term exercise intervention
  cohortKey: clinicaltrials-nct05097352-2026-04-24
  aggregateRole: context
protocolEvidence:
  -
    protocolKey: protocol_variant:tabata-interval-training/tabata-20-10-interval-training
    groupId: clinicaltrials-nct05097352-2026-04-24
    stance: safety_boundary
    scope: clinical_supervised
    result: not_efficacy_evidence
    endpointKeys:
      - biomarker:sleep-quality
      - biomarker:hrv-rmssd
    headline: Registry-only HIIT context for sleep, HRV, and trauma exposure; not a Tabata protocol source.
    implication: Useful only for safety-boundary thinking about high-intensity exercise in stress-sensitive populations.
    caveat: Do not merge any linked publication results into this registry source page; extract publications under separate source keys.
    displayPriority: 75
evidenceBucket: trial_registry_context
whyItMatters: It flags that recovery, sleep, HRV, and trauma exposure can be relevant safety boundaries for high-intensity interval work.
potentialMurphEndpoints:
  - sleep quality
  - heart-rate variability
  - resting heart rate
  - trauma-related stress
  - recovery tolerance
protocolTakeaway: Use as safety-only context; it does not support Tabata 20/10 efficacy or dose claims.
murphTakeaway: Use to remind that stress-sensitive populations may require clinical screening and conservative progression before high-intensity work.
studyDesign: ClinicalTrials.gov registry record for randomized controlled short-term HIIT study.
modality: Supervised high-intensity interval training versus waitlist
directness: safety_boundary
claimUse: safety-only
murphV1Priority: Medium
pdfRightsStatus: unknown
sourceExtractionBatch: 12-source-extraction-009
---
This source is included for **trial_registry_context**.

**Findings:**
- The registry context links HIIT to sleep and autonomic-recovery endpoints in women exposed to trauma.
- The source is not a Tabata 20/10 intervention record and should not be used for Tabata efficacy claims.

**Why it matters:** It flags that recovery, sleep, HRV, and trauma exposure can be relevant safety boundaries for high-intensity interval work.

**Potential experiment signals:** sleep quality, heart-rate variability, resting heart rate, trauma-related stress, recovery tolerance.

**Protocol takeaway:** Use as safety-only context; it does not support Tabata 20/10 efficacy or dose claims.

**Limitations and boundaries:**
- Participant count and posted outcome details are not extracted from the registry in this batch.
- Population is stress-sensitive and clinically distinct from general recreational users.
- Any linked publications require separate source extraction before outcome synthesis.

**Claim use:** `safety-only`.
