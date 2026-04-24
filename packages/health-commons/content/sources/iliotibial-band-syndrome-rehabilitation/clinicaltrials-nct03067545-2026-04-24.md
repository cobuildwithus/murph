---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct03067545-2026-04-24
slug: sources/iliotibial-band-syndrome-rehabilitation/clinicaltrials-nct03067545-2026-04-24
title: "Do Simple Running Technique Changes Reduce Pain and Change Injury Causing Mechanics"
summary: "Merged 5 candidate row(s) from shard(s): direct-conservative-rehab-runners, external-clinical-protocols, gait-movement-retraining, load-management-return-to-run, outcome-measurement-and-adherence. Registry tracking on..."
status: draft
quality: usable
aliases:
  - "clinicaltrials-nct03067545-2026-04-24"
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
  title: "Do Simple Running Technique Changes Reduce Pain and Change Injury Causing Mechanics"
  citation: "Do Simple Running Technique Changes Reduce Pain and Change Injury Causing Mechanics"
  url: "https://clinicaltrials.gov/study/NCT03067545"
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: "rct"
  populationLabel: "adjacent_variant"
  durationLabel: "Not extracted in metadata pass"
  aggregateRole: primary
  cohortKey: "clinicaltrials-nct03067545-2026-04-24"
  notes:
    - "Metadata-pass extraction from the canonical source ledger; full-text effect details were not extracted in this pass."
protocolEvidence:
  -
    protocolKey: protocol_variant:iliotibial-band-syndrome-rehabilitation/it-band-syndrome-rehab-and-return-to-run
    groupId: context-and-variant-boundaries
    stance: context_only
    scope: adjacent_variant
    result: not_efficacy_evidence
    endpointKeys:
      - biomarker:lateral-knee-pain
    headline: "Merged 5 candidate row(s) from shard(s): direct-conservative-rehab-runners, external-clinical-protocols, gait-movement-retraining, load-management-return-to-..."
    implication: "Use for context, boundary, or safety framing rather than direct efficacy claims."
    caveat: "This source record preserves reducer classifications but does not replace source-level full-text extraction."
    displayPriority: 75
evidenceBucket: "clinical_trial_registry"
whyItMatters: "Merged 5 candidate row(s) from shard(s): direct-conservative-rehab-runners, external-clinical-protocols, gait-movement-retraining, load-management-return-to-run, outcome-measurement-and-adherence. Registry tracking only; do not use as efficacy evidence unless a linked publication/results record is extracted separately. Trial registry for running-technique change in runners with ITBS among other diagnoses; useful to trace unpublished or subgroup data."
potentialMurphEndpoints:
  - lateral knee pain
  - running tolerance
  - return-to-run progression
protocolTakeaway: "Relevant mainly for context, safety, or variant boundaries."
murphTakeaway: "Use conservatively with the canonical directness and claim-use labels."
studyDesign: "rct"
modality: "iliotibial band syndrome rehabilitation"
claimUse: context-only
murphV1Priority: Low
pdfRightsStatus: open_access
---

This source is included for **clinical_trial_registry**.

## Quick read

- **Source type:** rct.
- **Directness:** `adjacent_variant`.
- **Claim use:** `context-only`.
- **Priority:** `low`.

## Why it matters

Merged 5 candidate row(s) from shard(s): direct-conservative-rehab-runners, external-clinical-protocols, gait-movement-retraining, load-management-return-to-run, outcome-measurement-and-adherence. Registry tracking only; do not use as efficacy evidence unless a linked publication/results record is extracted separately. Trial registry for running-technique change in runners with ITBS among other diagnoses; useful to trace unpublished or subgroup data.

## Important limits

This page was generated from the canonical reducer ledger metadata pass. Do not cite unextracted sample sizes, effect sizes, or adverse-event rates from this page alone.
