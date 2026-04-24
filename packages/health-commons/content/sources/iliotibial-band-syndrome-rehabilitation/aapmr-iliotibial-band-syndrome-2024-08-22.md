---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:aapmr-iliotibial-band-syndrome-2024-08-22
slug: sources/iliotibial-band-syndrome-rehabilitation/aapmr-iliotibial-band-syndrome-2024-08-22
title: "Iliotibial Band Syndrome"
summary: "Merged 1 candidate row(s) from shard(s): external-clinical-protocols. External clinical template; may inform implementation comparison but is not efficacy proof. Professional-society clinical reference with cited evid..."
status: draft
quality: usable
aliases:
  - "aapmr-iliotibial-band-syndrome-2024-08-22"
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
  kind: guideline
  title: "Iliotibial Band Syndrome"
  citation: "Iliotibial Band Syndrome"
  url: "https://now.aapmr.org/iliotibial-band-syndrome/"
researchEvidence:
  designKind: guideline
  designLabel: "guideline"
  populationLabel: "direct_protocol"
  durationLabel: "Not extracted in metadata pass"
  aggregateRole: primary
  cohortKey: "aapmr-iliotibial-band-syndrome-2024-08-22"
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
    headline: "Merged 1 candidate row(s) from shard(s): external-clinical-protocols. External clinical template; may inform implementation comparison but is not efficacy pr..."
    implication: "Use for context, boundary, or safety framing rather than direct efficacy claims."
    caveat: "This source record preserves reducer classifications but does not replace source-level full-text extraction."
    displayPriority: 55
evidenceBucket: "external_clinical_protocol"
whyItMatters: "Merged 1 candidate row(s) from shard(s): external-clinical-protocols. External clinical template; may inform implementation comparison but is not efficacy proof. Professional-society clinical reference with cited evidence base, update history, and explicit gaps in standardized care."
potentialMurphEndpoints:
  - lateral knee pain
  - running tolerance
  - return-to-run progression
protocolTakeaway: "Relevant mainly for context, safety, or variant boundaries."
murphTakeaway: "Use conservatively with the canonical directness and claim-use labels."
studyDesign: "guideline"
modality: "iliotibial band syndrome rehabilitation"
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: permission_required
---

This source is included for **external_clinical_protocol**.

## Quick read

- **Source type:** guideline.
- **Directness:** `direct_protocol`.
- **Claim use:** `context-only`.
- **Priority:** `medium`.

## Why it matters

Merged 1 candidate row(s) from shard(s): external-clinical-protocols. External clinical template; may inform implementation comparison but is not efficacy proof. Professional-society clinical reference with cited evidence base, update history, and explicit gaps in standardized care.

## Important limits

This page was generated from the canonical reducer ledger metadata pass. Do not cite unextracted sample sizes, effect sizes, or adverse-event rates from this page alone.
