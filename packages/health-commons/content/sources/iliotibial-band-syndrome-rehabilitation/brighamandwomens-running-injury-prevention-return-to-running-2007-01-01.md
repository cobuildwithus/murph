---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:brighamandwomens-running-injury-prevention-return-to-running-2007-01-01
slug: sources/iliotibial-band-syndrome-rehabilitation/brighamandwomens-running-injury-prevention-return-to-running-2007-01-01
title: Running Injury Prevention Tips & Return to Running Program
summary: 'Merged 1 candidate row(s) from shard(s): external-clinical-protocols. External clinical template; may inform implementation comparison but is not efficacy proof. Adjacent institutional return-to-run source with explicit symptom-response rules and phased walk/jog progression patterns.'
status: draft
quality: usable
aliases:
- brighamandwomens-running-injury-prevention-return-to-running-2007-01-01
categories:
- iliotibial-band-syndrome-rehabilitation
- external_clinical_protocol
relations:
- type: related_protocol
  target: protocol_variant:iliotibial-band-syndrome-rehabilitation/it-band-syndrome-rehab-and-return-to-run
- type: parent_family
  target: experiment_family:iliotibial-band-syndrome-rehabilitation
source:
  kind: guideline
  title: Running Injury Prevention Tips & Return to Running Program
  authors: "Brigham and Women's Hospital Department of Rehabilitation Services"
  journal: "Brigham and Women's Hospital"
  citation: Running Injury Prevention Tips & Return to Running Program
  url: https://www.brighamandwomens.org/assets/bwh/patients-and-families/rehabilitation-services/pdfs/le-running-injury-prevention-tips-and-return-to-running-program-bwh.pdf
researchEvidence:
  designKind: guideline
  designLabel: guideline
  populationLabel: direct protocol
  durationLabel: Not extracted in local fallback
  aggregateRole: synthesis
  cohortKey: brighamandwomens-running-injury-prevention-return-to-running-2007-01-01
  notes:
  - Local fallback extraction from the canonical source ledger; full-text effect details were not extracted in this pass.
  - 'Reducer priority: medium; claim-use label: context-only; directness label: direct_protocol.'
evidenceBucket: external_clinical_protocol
whyItMatters: 'Merged 1 candidate row(s) from shard(s): external-clinical-protocols. External clinical template; may inform implementation comparison but is not efficacy proof. Adjacent institutional return-to-run source with explicit symptom-response rules and phased walk/jog progression patterns.'
potentialMurphEndpoints:
- lateral knee pain
- pain-free running duration
- graded return-to-run tolerance
- rehab adherence
- stop-condition events
protocolTakeaway: Use as an implementation template or boundary source, not as proof that the Murph protocol is effective.
murphTakeaway: Use conservatively with the canonical directness and claim-use labels; avoid unextracted sample sizes, effect sizes, adverse-event rates, or timelines.
studyDesign: guideline
modality: iliotibial band syndrome rehabilitation
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: permission_required
---

This source is included for **external clinical protocol**.

## Quick read

- **Source type:** guideline.
- **Directness:** `direct_protocol`.
- **Claim use:** `context-only`.
- **Priority:** `medium`.
- **Rights posture:** `permission_required` in the ledger; no PDF is committed from this source page.

## Why it matters

Merged 1 candidate row(s) from shard(s): external-clinical-protocols. External clinical template; may inform implementation comparison but is not efficacy proof. Adjacent institutional return-to-run source with explicit symptom-response rules and phased walk/jog progression patterns.

## How Murph should use it

Use as an implementation template or boundary source, not as proof that the Murph protocol is effective.

## Important limits

This page was generated from the normalized local fallback source-page drafts and the canonical reducer ledger after the large extraction prompts did not return full source-extraction artifacts. It preserves source keys, directness, claim-use labels, priorities, and reducer notes, but it does **not** support adding sample sizes, effect sizes, adverse-event rates, or source-level results that are not otherwise extracted.

## Plain-language takeaway

Keep this source in its assigned evidence bucket and do not let it make the return-to-run protocol stronger than the extracted record supports.
