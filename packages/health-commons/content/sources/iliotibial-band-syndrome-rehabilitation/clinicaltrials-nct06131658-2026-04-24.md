---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct06131658-2026-04-24
slug: sources/iliotibial-band-syndrome-rehabilitation/clinicaltrials-nct06131658-2026-04-24
title: "Effects of Functional Motor Control on Pain, Flexibility, Lower Extremity Function With Iliotibial Band Syndrome"
summary: "Merged 1 candidate row(s) from shard(s): snowball-gap-fill. Registry tracking only; do not use as efficacy evidence unless a linked publication/results record is extracted separately. Direct runner motor-control trial..."
status: draft
quality: usable
aliases:
  - "clinicaltrials-nct06131658-2026-04-24"
categories:
  - iliotibial-band-syndrome-rehabilitation
relations:
  -
    type: related_protocol
    target: protocol_variant:iliotibial-band-syndrome-rehabilitation/it-band-syndrome-rehab-and-return-to-run
  -
    type: parent_family
    target: experiment_family:iliotibial-band-syndrome-rehabilitation
source:
  kind: web_page
  title: "Effects of Functional Motor Control on Pain, Flexibility, Lower Extremity Function With Iliotibial Band Syndrome"
  citation: "Effects of Functional Motor Control on Pain, Flexibility, Lower Extremity Function With Iliotibial Band Syndrome"
  url: "https://clinicaltrials.gov/study/NCT06131658"
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: "randomized_trial_registry"
  populationLabel: "direct_protocol"
  durationLabel: "Not extracted in metadata pass"
  aggregateRole: primary
  cohortKey: "clinicaltrials-nct06131658-2026-04-24"
  notes:
    - "Metadata-pass extraction from the canonical source ledger; full-text effect details were not extracted in this pass."
protocolEvidence:
  -
    protocolKey: protocol_variant:iliotibial-band-syndrome-rehabilitation/it-band-syndrome-rehab-and-return-to-run
    groupId: direct-runner-rehab
    stance: context_only
    scope: direct_protocol
    result: not_efficacy_evidence
    endpointKeys:
      - biomarker:lateral-knee-pain
    headline: "Merged 1 candidate row(s) from shard(s): snowball-gap-fill. Registry tracking only; do not use as efficacy evidence unless a linked publication/results recor..."
    implication: "Use for context, boundary, or safety framing rather than direct efficacy claims."
    caveat: "This source record preserves reducer classifications but does not replace source-level full-text extraction."
    displayPriority: 55
evidenceBucket: "clinical_trial_registry"
whyItMatters: "Merged 1 candidate row(s) from shard(s): snowball-gap-fill. Registry tracking only; do not use as efficacy evidence unless a linked publication/results record is extracted separately. Direct runner motor-control trial registry; preserve but do not extract efficacy until results are available."
potentialMurphEndpoints:
  - lateral knee pain
  - running tolerance
  - return-to-run progression
protocolTakeaway: "Relevant mainly for context, safety, or variant boundaries."
murphTakeaway: "Use conservatively with the canonical directness and claim-use labels."
studyDesign: "randomized_trial_registry"
modality: "iliotibial band syndrome rehabilitation"
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **clinical_trial_registry**.

## Quick read

- **Source type:** randomized_trial_registry.
- **Directness:** `direct_protocol`.
- **Claim use:** `context-only`.
- **Priority:** `medium`.

## Why it matters

Merged 1 candidate row(s) from shard(s): snowball-gap-fill. Registry tracking only; do not use as efficacy evidence unless a linked publication/results record is extracted separately. Direct runner motor-control trial registry; preserve but do not extract efficacy until results are available.

## Important limits

This page was generated from the canonical reducer ledger metadata pass. Do not cite unextracted sample sizes, effect sizes, or adverse-event rates from this page alone.
