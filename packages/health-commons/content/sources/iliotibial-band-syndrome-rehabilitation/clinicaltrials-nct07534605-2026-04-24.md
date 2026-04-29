---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct07534605-2026-04-24
slug: sources/iliotibial-band-syndrome-rehabilitation/clinicaltrials-nct07534605-2026-04-24
title: Effects of Ultrasound Therapy in Iliotibial Band Syndrome
summary: 'Merged 1 candidate row(s) from shard(s): snowball-gap-fill. Registry tracking only; do not use as efficacy evidence unless a linked publication/results record is extracted separately. Passive modality registry with exercise cointervention; should remain adjunct/passive evidence, not active return-to-run evidence.'
status: draft
quality: usable
aliases:
- clinicaltrials-nct07534605-2026-04-24
categories:
- iliotibial-band-syndrome-rehabilitation
- clinical_trial_registry
relations:
- type: related_protocol
  target: protocol_variant:iliotibial-band-syndrome-rehabilitation/it-band-syndrome-rehab-and-return-to-run
- type: parent_family
  target: experiment_family:iliotibial-band-syndrome-rehabilitation
source:
  kind: web_page
  title: Effects of Ultrasound Therapy in Iliotibial Band Syndrome
  citation: Effects of Ultrasound Therapy in Iliotibial Band Syndrome
  url: https://clinicaltrials.gov/study/NCT07534605
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: randomized trial registry
  populationLabel: adjacent variant
  durationLabel: Not extracted in local fallback
  aggregateRole: context
  cohortKey: clinicaltrials-nct07534605-2026-04-24
  notes:
  - Local fallback extraction from the canonical source ledger; full-text effect details were not extracted in this pass.
  - 'Reducer priority: low; claim-use label: context-only; directness label: adjacent_variant.'
evidenceBucket: clinical_trial_registry
whyItMatters: 'Merged 1 candidate row(s) from shard(s): snowball-gap-fill. Registry tracking only; do not use as efficacy evidence unless a linked publication/results record is extracted separately. Passive modality registry with exercise cointervention; should remain adjunct/passive evidence, not active return-to-run evidence.'
potentialMurphEndpoints:
- lateral knee pain
- pain-free running duration
- graded return-to-run tolerance
- rehab adherence
- stop-condition events
protocolTakeaway: Use to track research activity only; registry-only entries are not efficacy evidence without linked results.
murphTakeaway: Use conservatively with the canonical directness and claim-use labels; avoid unextracted sample sizes, effect sizes, adverse-event rates, or timelines.
studyDesign: randomized_trial_registry
modality: iliotibial band syndrome rehabilitation
claimUse: context-only
murphV1Priority: Low
pdfRightsStatus: unknown
---

This source is included for **clinical trial registry context**.

## Quick read

- **Source type:** randomized_trial_registry.
- **Directness:** `adjacent_variant`.
- **Claim use:** `context-only`.
- **Priority:** `low`.
- **Rights posture:** `unknown` in the ledger; no PDF is committed from this source page.

## Why it matters

Merged 1 candidate row(s) from shard(s): snowball-gap-fill. Registry tracking only; do not use as efficacy evidence unless a linked publication/results record is extracted separately. Passive modality registry with exercise cointervention; should remain adjunct/passive evidence, not active return-to-run evidence.

## How Murph should use it

Use to track research activity only; registry-only entries are not efficacy evidence without linked results.

## Important limits

This page was generated from the normalized local fallback source-page drafts and the canonical reducer ledger after the large extraction prompts did not return full source-extraction artifacts. It preserves source keys, directness, claim-use labels, priorities, and reducer notes, but it does **not** support adding sample sizes, effect sizes, adverse-event rates, or source-level results that are not otherwise extracted.

## Plain-language takeaway

Keep this source in its assigned evidence bucket and do not let it make the return-to-run protocol stronger than the extracted record supports.
