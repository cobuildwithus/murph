---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:albertahealthservices-provincial-knee-primary-care-clinical-pathway-2026-01
slug: sources/iliotibial-band-syndrome-rehabilitation/albertahealthservices-provincial-knee-primary-care-clinical-pathway-2026-01
title: "Provincial Knee Primary Care Clinical Pathway"
summary: "Merged 1 candidate row(s) from shard(s): differential-diagnosis-safety. Use for differential diagnosis, escalation, imaging, or red-flag routing rather than protocol efficacy. Current pathway with explicit red/yellow..."
status: draft
quality: usable
aliases:
  - "albertahealthservices-provincial-knee-primary-care-clinical-pathway-2026-01"
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
  title: "Provincial Knee Primary Care Clinical Pathway"
  citation: "Provincial Knee Primary Care Clinical Pathway"
  url: "https://www.albertahealthservices.ca/assets/info/aph/if-aph-prov-knee-primary-care-pathway.pdf"
researchEvidence:
  designKind: guideline
  designLabel: "guideline"
  populationLabel: "safety_boundary"
  durationLabel: "Not extracted in metadata pass"
  aggregateRole: primary
  cohortKey: "albertahealthservices-provincial-knee-primary-care-clinical-pathway-2026-01"
  notes:
    - "Metadata-pass extraction from the canonical source ledger; full-text effect details were not extracted in this pass."
protocolEvidence:
  -
    protocolKey: protocol_variant:iliotibial-band-syndrome-rehabilitation/it-band-syndrome-rehab-and-return-to-run
    groupId: safety-escalation
    stance: safety_boundary
    scope: general_guideline
    result: not_efficacy_evidence
    endpointKeys:
      - biomarker:lateral-knee-pain
    headline: "Merged 1 candidate row(s) from shard(s): differential-diagnosis-safety. Use for differential diagnosis, escalation, imaging, or red-flag routing rather than..."
    implication: "Use for context, boundary, or safety framing rather than direct efficacy claims."
    caveat: "This source record preserves reducer classifications but does not replace source-level full-text extraction."
    displayPriority: 55
evidenceBucket: "differential_diagnosis_and_safety_boundary"
whyItMatters: "Merged 1 candidate row(s) from shard(s): differential-diagnosis-safety. Use for differential diagnosis, escalation, imaging, or red-flag routing rather than protocol efficacy. Current pathway with explicit red/yellow flags and lateral knee pain differentials; useful for protocol exclusion and referral language."
potentialMurphEndpoints:
  - lateral knee pain
  - running tolerance
  - return-to-run progression
protocolTakeaway: "Relevant mainly for context, safety, or variant boundaries."
murphTakeaway: "Use conservatively with the canonical directness and claim-use labels."
studyDesign: "guideline"
modality: "iliotibial band syndrome rehabilitation"
claimUse: safety-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **differential_diagnosis_and_safety_boundary**.

## Quick read

- **Source type:** guideline.
- **Directness:** `safety_boundary`.
- **Claim use:** `safety-only`.
- **Priority:** `medium`.

## Why it matters

Merged 1 candidate row(s) from shard(s): differential-diagnosis-safety. Use for differential diagnosis, escalation, imaging, or red-flag routing rather than protocol efficacy. Current pathway with explicit red/yellow flags and lateral knee pain differentials; useful for protocol exclusion and referral language.

## Important limits

This page was generated from the canonical reducer ledger metadata pass. Do not cite unextracted sample sizes, effect sizes, or adverse-event rates from this page alone.
