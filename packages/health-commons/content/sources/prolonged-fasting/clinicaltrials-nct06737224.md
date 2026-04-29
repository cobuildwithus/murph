---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct06737224
slug: sources/prolonged-fasting/clinicaltrials-nct06737224
title: The Impact of a 48-hour Fast with or Without Exercise on Immune Cell Metabolism and Glycemic Control in Healthy Active Adults
summary: Trial registry for a randomized crossover study testing whether exercise modifies immunometabolic and glycemic responses to a 48-hour fast in healthy active adults; no posted results were extracted.
status: draft
quality: usable
aliases:
- The Impact of a 48-hour Fast with or Without Exercise on Immune Cell Metabolism and Glycemic Control in Healthy Active Adults
- NCT06737224
categories:
- prolonged-fasting
relations:
- type: related_protocol
  target: protocol_variant:prolonged-fasting/prolonged-fasting-24-72-hours
- type: parent_family
  target: experiment_family:prolonged-fasting
source:
  kind: other
  title: The Impact of a 48-hour Fast with or Without Exercise on Immune Cell Metabolism and Glycemic Control in Healthy Active Adults
  authors: ClinicalTrials.gov registry record
  year: 2025
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov registry record. The Impact of a 48-hour Fast with or Without Exercise on Immune Cell Metabolism and Glycemic Control in Healthy Active Adults. ClinicalTrials.gov. 2025. NCT06737224.
  url: https://clinicaltrials.gov/study/NCT06737224
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: NCT06737224
    titleHash: af245c2a0a517bbf70ca11e6112b3273abdd28b732f84efff517a665c0d977bc
    url: https://clinicaltrials.gov/study/NCT06737224
  canonicalUrl: https://clinicaltrials.gov/study/NCT06737224
researchEvidence:
  designKind: crossover_trial
  designLabel: randomized crossover trial registry
  populationLabel: Healthy active adults, 19–35 years, physically active, BMI <=30, screened for fasting/exercise contraindications
  durationLabel: Two 48-hour fast periods separated by washout
  aggregateRole: primary
  cohortKey: clinicaltrials-nct06737224
  participantCount: 15
  participantCountKind: reported
evidenceBucket: direct protocol and dose evidence
whyItMatters: Defines a contemporary, closely matched 48-hour human protocol with exercise as an implementation modifier, but registry data are not efficacy evidence.
potentialMurphEndpoints:
- immune cell bioenergetics
- immune cell function
- whole-body glycemic control
- continuous glucose monitoring
- standardized-meal responses
protocolTakeaway: Use as context for protocol design and outcome selection only until peer-reviewed results are available.
murphTakeaway: Good template for tracking CGM and immune/metabolic endpoints across fasting-only and fasting-plus-exercise variants; not a result source.
studyDesign: randomized crossover trial registry
modality: water-only / zero-calorie fasting with exercise comparator
claimUse: context-only
sourceFindings:
- findingId: finding:nct06737224-48h-fast-exercise-registry
  sourceKey: source_artifact:clinicaltrials-nct06737224
  extractedFromArtifactId: art_clinicaltrials_nct06737224
  findingKind: context
  population: Healthy active adults, 19–35 years, physically active, BMI <=30, screened for fasting/exercise contraindications
  exposure: 'Two 48-hour fast conditions: fasting only and fasting plus daily 60-minute cycling exercise'
  outcome: registered immunometabolic and glycemic outcomes
  summary: NCT06737224 registers a randomized crossover 48-hour fast in healthy active adults, comparing fasting alone with fasting plus cycling exercise and measuring immune-cell metabolism/function and glycemic control; no outcomes were posted in the extracted record.
  evidenceUse:
  - context
  - measurement
murphV1Priority: Medium
pdfRightsStatus: open_access
extractionNotes:
  batchId: batch-001
  interventionOrExposure: 'Two 48-hour fast conditions: fasting only and fasting plus daily 60-minute cycling exercise'
  comparatorOrControl: Within-participant comparison of 48-hour fasting alone versus 48-hour fasting with exercise; no completed outcome results posted in the extracted record
  durationOrFollowUp: Two 48-hour fast periods separated by washout
  endpoints:
  - immune cell bioenergetics
  - immune cell function
  - whole-body glycemic control
  - continuous glucose monitoring
  - standardized-meal responses
  effectEstimatesOrDirection: NCT06737224 registers a randomized crossover 48-hour fast in healthy active adults, comparing fasting alone with fasting plus cycling exercise and measuring immune-cell metabolism/function and glycemic control; no outcomes were posted in the extracted record.
  adverseEventsOrSafetyNotes: Registry exclusions and supervised exercise/fasting procedures imply safety screening, but the extracted registry record does not provide adverse-event results.
  limitations: Registry-only source; planned or ongoing protocol information cannot support outcome claims.
  populationMismatch: Healthy, young, physically active adults; may not generalize to older adults, sedentary adults, diabetes, pregnancy, underweight, eating-disorder risk, or medication use.
  directnessToProtocol: direct_protocol
  claimUseBoundary: context-only
  artifactRightsStatus: open_access
---

This source is included for **direct protocol and dose evidence**.

**Findings:** NCT06737224 registers a randomized crossover 48-hour fast in healthy active adults, comparing fasting alone with fasting plus cycling exercise and measuring immune-cell metabolism/function and glycemic control; no outcomes were posted in the extracted record.

**Why it matters:** Defines a contemporary, closely matched 48-hour human protocol with exercise as an implementation modifier, but registry data are not efficacy evidence.

**Potential experiment signals:** immune cell bioenergetics, immune cell function, whole-body glycemic control, continuous glucose monitoring, standardized-meal responses.

**Protocol takeaway:** Use as context for protocol design and outcome selection only until peer-reviewed results are available.

**Claim use:** `context-only`.

**Study design and directness:** randomized crossover trial registry. Directness to Prolonged Fasting (24–72 Hours): `direct_protocol`.

**Comparator/control:** Within-participant comparison of 48-hour fasting alone versus 48-hour fasting with exercise; no completed outcome results posted in the extracted record

**Duration/follow-up:** Two 48-hour fast periods separated by washout

**Adverse events or safety notes:** Registry exclusions and supervised exercise/fasting procedures imply safety screening, but the extracted registry record does not provide adverse-event results.

**Limitations:** Registry-only source; planned or ongoing protocol information cannot support outcome claims.

**Population mismatch:** Healthy, young, physically active adults; may not generalize to older adults, sedentary adults, diabetes, pregnancy, underweight, eating-disorder risk, or medication use.

**Artifact/rights note:** Rights status `open_access`. Do not commit copyrighted PDFs; use metadata/external-link candidates unless redistribution rights are explicitly confirmed.
