---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct07333404-2026-04-25
slug: sources/intermittent-pneumatic-compression/clinicaltrials-gov-nct07333404-2026-04-25
title: "Combined tDCS and Pneumatic Compression for Recovery After a 10K Run"
summary: "Current, pending, registry, and preprint context source for the pneumatic compression pants research package. Role: context-only; directness: direct_protocol. Duplicate NCT07333404 registry rows normalized to one ClinicalTrials.gov snapshot key. Deduped from 3 candidate rows across consumer-device-aliases, direct-sports-recovery, registries-preprints-current. Current/pending context only; do not count as completed efficacy evidence. Rights unclear; verify before adding downloadable artifacts."
status: draft
quality: usable
categories:
  - intermittent-pneumatic-compression
relations:

  -
    type: related_protocol
    target: protocol_variant:intermittent-pneumatic-compression/pneumatic-compression-pants
  -
    type: parent_family
    target: experiment_family:intermittent-pneumatic-compression
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    url: "https://clinicaltrials.gov/study/NCT07333404"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT07333404"
source:
  kind: other
  title: "Combined tDCS and Pneumatic Compression for Recovery After a 10K Run"
  url: "https://clinicaltrials.gov/study/NCT07333404"
researchEvidence:
  designKind: crossover_trial
  designLabel: "crossover"
  populationLabel: "See source extraction; use role/directness metadata rather than assuming consumer-pants generalization."
  aggregateRole: context
evidenceBucket: "Current, pending, registry, and preprint context"
directness: "direct_protocol"
claimUse: "context-only"
murphV1Priority: "medium"
pdfRightsStatus: "unknown"
---

This source is included for **Current, pending, registry, and preprint context**.

**Findings:** Not yet recruiting; hasResults false. The registry describes 20 minutes of sequential lower-limb Normatec pneumatic compression with adjustable pressure 20-100 mmHg after a 10K run; also tested alone and simultaneously with 20 minutes of 2 mA tDCS compared with tDCS-only condition, combined tDCS plus PC condition, and passive rest control. Planned endpoints include MVIC with quadriceps EMG, heart rate variability, Stroop cognitive performance, Total Quality Recovery, Well-Being Questionnaire, vertical jump. No effect estimates posted; ClinicalTrials.gov hasResults is false and status is not yet recruiting.

**Why it matters:** This record is consumer-relevant because it names Normatec lower-limb pneumatic compression with a 20-minute, 20-100 mmHg protocol after endurance running, while also marking an evidence gap because results are pending.

**Potential experiment signals:** HRV, MVIC with EMG, Stroop reaction time/accuracy, TQR, WBQ, vertical jump, adverse-effect/discomfort screening.

**Protocol takeaway:** Use for pending-trial tracking, dose planning, and endpoint selection; do not treat as efficacy evidence.

**Claim use:** `context-only`. Not-yet-recruiting registry record with estimated enrollment and no results. Combined-modality arm can confound interpretation of pneumatic compression effects. Male master runner population is narrow. Protocol/SAP and ICF PDFs are uploaded to ClinicalTrials.gov, but redistribution rights are unclear. Population mismatch: Male master runners only; combined tDCS plus PC arm means any combined-arm results would not isolate pneumatic compression alone. Artifact rights status: unknown; use external registry links or manifest metadata only unless redistributable rights are confirmed.
